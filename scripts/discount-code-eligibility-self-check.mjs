import assert from "node:assert/strict";
import { closeDbPool, getDbPool, initializeDatabase } from "../server/db.js";
import { createDiscountCode } from "../server/discount-code-service.js";
import { resolveCharacterDiscountOffers } from "../server/discount-code-eligibility-service.js";
import { hashSecret } from "../server/security.js";
import { assertLocalMutatingSelfCheckEnvironment } from "./self-check-environment-guard.mjs";

await assertLocalMutatingSelfCheckEnvironment({ label: "discount code eligibility self-check" });
await initializeDatabase();
const db = getDbPool();
const suffix = Date.now().toString(36);
const creatorId = `u_offer_creator_${suffix}`;
const viewerId = `u_offer_viewer_${suffix}`;
const otherCreatorId = `u_offer_other_${suffix}`;
const crossSiteViewerId = `u_offer_cross_${suffix}`;
const creatorCharacterId = `creator_offer_${suffix}`;
const otherCharacterId = `creator_offer_other_${suffix}`;
const mascotCharacterId = `mascot_offer_${suffix}`;
const createdDiscountIds = [];

try {
  await insertUser(creatorId, "creator", "site_fkk", "Offer Creator");
  await insertUser(viewerId, "personal", "site_fkk", "Offer Viewer");
  await insertUser(otherCreatorId, "creator", "site_fkk", "Other Creator");
  await insertUser(crossSiteViewerId, "personal", "site_gg", "Cross Site Viewer");
  await insertCharacter(creatorCharacterId, "creator", creatorId, "Offer Creator Character");
  await insertCharacter(otherCharacterId, "creator", otherCreatorId, "Other Creator Character");
  await insertCharacter(mascotCharacterId, "mascot", null, "FKK Mascot");

  const creatorCodeA = await createCode(`CREATORA${suffix}`, "creator", creatorId, "20% OFF");
  const creatorCodeB = await createCode(`CREATORB${suffix}`, "creator", creatorId, "30% OFF");
  const otherCreatorCode = await createCode(`OTHER${suffix}`, "creator", otherCreatorId, "Other creator offer");
  const siteCodeA = await createCode(`SITEA${suffix}`, "site", null, "10% OFF");
  const siteCodeB = await createCode(`SITEB${suffix}`, "site", null, "15% OFF");
  const expiredCode = await createCode(`EXPIRED${suffix}`, "site", null, "Expired offer", {
    startsAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
    endsAt: new Date(Date.now() - 60 * 60 * 1000),
  });
  const disabledCode = await createCode(`DISABLED${suffix}`, "site", null, "Disabled offer", { isEnabled: false });
  createdDiscountIds.push(creatorCodeA, creatorCodeB, otherCreatorCode, siteCodeA, siteCodeB, expiredCode, disabledCode);

  const creatorOffers = await resolveCharacterDiscountOffers(db, {
    userId: viewerId,
    characterId: creatorCharacterId,
    siteId: "site_fkk",
  });
  assert.deepEqual(
    creatorOffers.offers.map((item) => item.code).sort(),
    [expectedCode("CREATORA"), expectedCode("CREATORB")].sort(),
    "a public creator character should expose its own active creator codes to the chatting user",
  );

  const ownerOffers = await resolveCharacterDiscountOffers(db, {
    userId: creatorId,
    characterId: creatorCharacterId,
    siteId: "site_fkk",
  });
  assert.deepEqual(
    ownerOffers.offers.map((item) => item.code).sort(),
    [expectedCode("CREATORA"), expectedCode("CREATORB")].sort(),
    "creator character should resolve all current codes owned by its creator",
  );
  assert.ok(ownerOffers.offers.every((item) => item.ownershipType === "creator"));
  assert.ok(ownerOffers.offers.every((item) => !("notes" in item) && !("creatorUid" in item) && !("displayLabel" in item)));
  assert.ok(ownerOffers.offers.every((item) => item.pricingPreview?.type === "percentage"), "trusted Shopify pricing preview should enter the safe offer DTO");

  const mascotOffers = await resolveCharacterDiscountOffers(db, {
    userId: viewerId,
    characterId: mascotCharacterId,
    siteId: "site_fkk",
    limit: 20,
  });
  const mascotCodes = mascotOffers.offers.map((item) => item.code);
  assert.ok(mascotCodes.includes(expectedCode("SITEA")), "mascot should resolve the first active site code created by this self-check");
  assert.ok(mascotCodes.includes(expectedCode("SITEB")), "mascot should resolve the second active site code created by this self-check");
  assert.ok(!mascotCodes.includes(expectedCode("EXPIRED")), "mascot should exclude the expired site code created by this self-check");
  assert.ok(!mascotCodes.includes(expectedCode("DISABLED")), "mascot should exclude the disabled site code created by this self-check");
  assert.ok(mascotOffers.offers.every((item) => item.ownershipType === "site"));

  await db.execute(
    "UPDATE discount_codes SET shopify_synced_at = DATE_SUB(NOW(3), INTERVAL 1 HOUR) WHERE id = ?",
    [expiredCode],
  );
  const extendedOffers = await resolveCharacterDiscountOffers(db, {
    userId: viewerId,
    characterId: mascotCharacterId,
    siteId: "site_fkk",
    limit: 20,
    resolveShopifyDiscountCodeImpl: async (_site, code) => ({
      shopifyDiscountId: `gid://shopify/DiscountCodeNode/${code}`,
      code,
      offerDescription: "Extended offer",
      shopifyDiscountType: "percentage",
      shopifyStatus: "ACTIVE",
      validityMode: "fixed",
      startsAt: new Date(Date.now() - 60_000).toISOString(),
      endsAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      rule: {
        type: "percentage",
        value: 10,
        currencyCode: "",
        appliesOnEachItem: false,
        minimumRequirement: null,
        targetScope: { type: "all" },
        customerContext: "DiscountBuyerSelectionAll",
        pricePreviewEligible: true,
      },
    }),
  });
  assert.ok(
    extendedOffers.offers.some((item) => item.code === expectedCode("EXPIRED")),
    "a stale locally expired snapshot must still refresh when Shopify extends the discount",
  );

  const otherOwnerOffers = await resolveCharacterDiscountOffers(db, {
    userId: otherCreatorId,
    characterId: otherCharacterId,
    siteId: "site_fkk",
  });
  assert.deepEqual(otherOwnerOffers.offers.map((item) => item.code), [expectedCode("OTHER")]);

  await assert.rejects(
    () => resolveCharacterDiscountOffers(db, {
      userId: viewerId,
      characterId: mascotCharacterId,
      siteId: "site_gg",
    }),
    (error) => error?.publicCode === "DISCOUNT_CODE_SITE_MISMATCH",
    "a role cannot be queried through another site",
  );

  await assert.rejects(
    () => resolveCharacterDiscountOffers(db, {
      userId: crossSiteViewerId,
      characterId: mascotCharacterId,
      siteId: "",
    }),
    (error) => error?.publicCode === "DISCOUNT_CODE_SITE_MISMATCH",
    "omitting the requested site must not let a cross-site viewer read role codes",
  );

  await db.execute("UPDATE users SET site_id = 'site_gg' WHERE id = ?", [creatorId]);
  const staleCreatorOffers = await resolveCharacterDiscountOffers(db, {
    userId: viewerId,
    characterId: creatorCharacterId,
    siteId: "site_fkk",
  });
  assert.deepEqual(staleCreatorOffers.offers, [], "creator owner moved to another site must invalidate old role codes");
  await db.execute("UPDATE users SET site_id = 'site_fkk' WHERE id = ?", [creatorId]);

  const noGuestOffers = await resolveCharacterDiscountOffers(db, {
    userId: "",
    characterId: mascotCharacterId,
    siteId: "site_fkk",
  });
  assert.deepEqual(noGuestOffers.offers, [], "guest/no-user context must not resolve codes");

  console.log("discount code eligibility self-check passed");
} finally {
  if (createdDiscountIds.length) {
    await db.execute(`DELETE FROM discount_codes WHERE id IN (${createdDiscountIds.map(() => "?").join(",")})`, createdDiscountIds).catch(() => {});
  }
  await db.execute("DELETE FROM ai_characters WHERE id IN (?, ?, ?)", [creatorCharacterId, otherCharacterId, mascotCharacterId]).catch(() => {});
  await db.execute("DELETE FROM users WHERE id IN (?, ?, ?, ?)", [creatorId, viewerId, otherCreatorId, crossSiteViewerId]).catch(() => {});
  await closeDbPool();
}

async function insertUser(id, accountType, siteId, nickname) {
  await db.execute(
    `INSERT INTO users (
       id, platform, platform_uid, locale, username, password_hash, nickname, email,
       email_verified_at, email_auth_provider, account_type, site_id, account_status, last_seen_at
     ) VALUES (?, 'web', ?, 'en', ?, ?, ?, ?, NOW(3), 'email', ?, ?, 'active', NOW(3))`,
    [id, id, `${id}@example.local`, hashSecret("OfferCheck1234"), nickname, `${id}@example.local`, accountType, siteId],
  );
}

async function insertCharacter(id, categoryId, ownerUid, name) {
  await db.execute(
    `INSERT INTO ai_characters (
       id, category_id, owner_uid, site_id, slug, name, visibility, character_status, source_type, source_ref
     ) VALUES (?, ?, ?, 'site_fkk', ?, ?, 'public', 'published', 'self-check', ?)`,
    [id, categoryId, ownerUid, `${id}-${suffix}`, name, `discount-eligibility-${suffix}`],
  );
}

async function createCode(code, ownershipType, creatorUid, offerDescription, options = {}) {
  const result = await createDiscountCode(null, {
    code,
    siteId: "site_fkk",
    ownershipType,
    creatorUid: creatorUid || "",
    offerDescription,
    validityMode: options.startsAt || options.endsAt ? "fixed" : "indefinite",
    startsAt: options.startsAt?.toISOString?.() || options.startsAt || "",
    endsAt: options.endsAt?.toISOString?.() || options.endsAt || "",
    isEnabled: options.isEnabled ?? true,
  }, {
    resolveShopifyDiscountCodeImpl: async (_site, selectedCode) => ({
      shopifyDiscountId: `gid://shopify/DiscountCodeNode/${selectedCode}`,
      code: String(selectedCode || "").toUpperCase(),
      offerDescription,
      shopifyDiscountType: "percentage",
      shopifyStatus: "ACTIVE",
      validityMode: options.endsAt ? "fixed" : "indefinite",
      startsAt: options.startsAt?.toISOString?.() || options.startsAt || "2026-07-01T00:00:00.000Z",
      endsAt: options.endsAt?.toISOString?.() || options.endsAt || "",
      rule: {
        type: "percentage",
        value: 10,
        currencyCode: "",
        appliesOnEachItem: false,
        minimumRequirement: null,
        targetScope: { type: "all" },
        customerContext: "DiscountBuyerSelectionAll",
        pricePreviewEligible: true,
      },
    }),
  });
  return result.item.id;
}

function expectedCode(prefix) {
  return `${prefix}${suffix}`.toUpperCase();
}
