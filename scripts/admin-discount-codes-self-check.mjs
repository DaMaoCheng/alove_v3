import assert from "node:assert/strict";
import { closeDbPool, getDbPool, initializeDatabase } from "../server/db.js";
import { createDiscountCode, listDiscountCodes, updateDiscountCode } from "../server/discount-code-service.js";
import { deriveDiscountCodeStatus, normalizeDiscountCodePayload } from "../server/discount-code-normalizers.js";
import { hashSecret } from "../server/security.js";
import { assertLocalMutatingSelfCheckEnvironment } from "./self-check-environment-guard.mjs";

await assertLocalMutatingSelfCheckEnvironment({ label: "admin discount codes self-check" });
await initializeDatabase();
await initializeDatabase();

const db = getDbPool();
const suffix = Date.now().toString(36);
const creatorId = `u_discount_${suffix}`;
const characterId = `creator_discount_${suffix}`;
const siteCode = `SITE${suffix}`.slice(0, 64).toUpperCase();
const creatorCode = `CREATOR${suffix}`.slice(0, 64).toUpperCase();
const createdIds = [];
const shopifyOptions = { resolveShopifyDiscountCodeImpl: resolveShopifyFixture };

try {
  const [[table]] = await db.execute(
    `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'discount_codes' LIMIT 1`,
  );
  assert.equal(table?.TABLE_NAME, "discount_codes", "discount code migration should create its table");
  const [shopifyColumns] = await db.execute(
    `SELECT COLUMN_NAME
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'discount_codes'
       AND COLUMN_NAME IN ('shopify_discount_id', 'shopify_discount_type', 'shopify_status', 'shopify_rule_json', 'shopify_synced_at')`,
  );
  assert.equal(shopifyColumns.length, 5, "discount code migration should add the Shopify rule snapshot columns");

  await db.execute(
    `INSERT INTO users (
       id, platform, platform_uid, locale, username, password_hash, nickname, email,
       email_verified_at, email_auth_provider, account_type, site_id, account_status, last_seen_at
     ) VALUES (?, 'web', ?, 'en', ?, ?, 'Discount Creator', ?, NOW(3), 'email', 'creator', 'site_fkk', 'active', NOW(3))`,
    [creatorId, creatorId, `${creatorId}@example.local`, hashSecret("DiscountCheck1234"), `${creatorId}@example.local`],
  );
  await db.execute(
    `INSERT INTO ai_characters (
       id, category_id, owner_uid, site_id, slug, name, visibility, character_status, source_type, source_ref
     ) VALUES (?, 'creator', ?, 'site_fkk', ?, 'Discount Creator Character', 'public', 'published', 'self-check', ?)`,
    [characterId, creatorId, `discount-creator-${suffix}`, `discount-code-self-check-${suffix}`],
  );

  const siteOwnedNormalized = normalizeDiscountCodePayload({
    code: siteCode,
    siteId: "site_fkk",
    ownershipType: "site",
    creatorUid: creatorId,
    offerDescription: "Site offer",
    validityMode: "indefinite",
  });
  assert.equal(siteOwnedNormalized.creatorUid, null, "site ownership must clear creator attribution");
  assert.equal(siteOwnedNormalized.endsAt, null, "indefinite validity must clear end time");

  const siteCreate = await createDiscountCode(null, siteOwnedNormalized, shopifyOptions);
  createdIds.push(siteCreate.item.id);
  assert.equal(siteCreate.item.code, siteCode);
  assert.equal(siteCreate.item.status, "active");
  assert.equal(siteCreate.item.ownershipType, "site");

  await assert.rejects(
    () => createDiscountCode(null, { ...siteOwnedNormalized, code: siteCode.toLowerCase() }, shopifyOptions),
    (error) => error?.statusCode === 409 && error?.publicCode === "DISCOUNT_CODE_DUPLICATE",
    "same-site codes must be case-insensitively unique",
  );

  const startsAt = new Date(Date.now() + 60 * 60 * 1000);
  const endsAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
  const creatorCreate = await createDiscountCode(null, {
    code: creatorCode,
    siteId: "site_fkk",
    ownershipType: "creator",
    creatorUid: creatorId,
    offerDescription: "Creator offer",
    validityMode: "fixed",
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
  }, shopifyOptions);
  createdIds.push(creatorCreate.item.id);
  assert.equal(creatorCreate.item.creatorUid, creatorId);
  assert.equal(creatorCreate.item.status, "scheduled");

  await assert.rejects(
    () => createDiscountCode(null, {
      code: `CROSS${suffix}`,
      siteId: "site_gg",
      ownershipType: "creator",
      creatorUid: creatorId,
      offerDescription: "Cross-site offer",
      validityMode: "indefinite",
    }, shopifyOptions),
    (error) => error?.publicCode === "DISCOUNT_CODE_CREATOR_INVALID",
    "creator ownership must reject cross-site accounts",
  );

  assert.throws(
    () => normalizeDiscountCodePayload({
      code: `TIME${suffix}`,
      siteId: "site_fkk",
      ownershipType: "site",
      offerDescription: "Invalid time",
      validityMode: "fixed",
      startsAt: endsAt.toISOString(),
      endsAt: startsAt.toISOString(),
    }),
    (error) => error?.publicCode === "DISCOUNT_CODE_TIME_RANGE_INVALID",
  );

  const updated = await updateDiscountCode(null, creatorCreate.item.id, {
    ownershipType: "site",
    isEnabled: false,
  }, shopifyOptions);
  assert.equal(updated.item.creatorUid, "");
  assert.ok(updated.item.startsAt, "Shopify-synced start time should remain authoritative");
  assert.ok(updated.item.endsAt, "Shopify-synced end time should remain authoritative");
  assert.equal(updated.item.status, "disabled");

  const filtered = await listDiscountCodes({ site: "site_fkk", ownershipType: "site", status: "disabled" });
  assert.ok(filtered.items.some((item) => item.id === creatorCreate.item.id));
  assert.equal(deriveDiscountCodeStatus({ isEnabled: true, endsAt: new Date(Date.now() - 1000) }), "expired");
  assert.equal(deriveDiscountCodeStatus({
    isEnabled: true,
    shopifyStatus: "SCHEDULED",
    startsAt: new Date(Date.now() - 1000),
    endsAt: new Date(Date.now() + 60_000),
  }), "active", "scheduled snapshots should derive active once their start time is reached");

  console.log("admin discount codes self-check passed");
} finally {
  if (createdIds.length) {
    await db.execute(`DELETE FROM discount_codes WHERE id IN (${createdIds.map(() => "?").join(",")})`, createdIds).catch(() => {});
  }
  await db.execute("DELETE FROM ai_characters WHERE id = ?", [characterId]).catch(() => {});
  await db.execute("DELETE FROM users WHERE id = ?", [creatorId]).catch(() => {});
  await closeDbPool();
}

async function resolveShopifyFixture(_site, code) {
  const normalizedCode = String(code || "").trim().toUpperCase();
  const scheduled = normalizedCode === creatorCode;
  return {
    shopifyDiscountId: `gid://shopify/DiscountCodeNode/${normalizedCode}`,
    code: normalizedCode,
    offerDescription: scheduled ? "Creator offer" : "Site offer",
    shopifyDiscountType: "percentage",
    shopifyStatus: scheduled ? "SCHEDULED" : "ACTIVE",
    validityMode: scheduled ? "fixed" : "indefinite",
    startsAt: scheduled ? startsAtIso() : "2026-07-01T00:00:00.000Z",
    endsAt: scheduled ? endsAtIso() : "",
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
  };
}

function startsAtIso() {
  return new Date(Date.now() + 60 * 60 * 1000).toISOString();
}

function endsAtIso() {
  return new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
}
