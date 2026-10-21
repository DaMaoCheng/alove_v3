import assert from "node:assert/strict";
import { closeDbPool, getDbPool } from "../server/db.js";
import { SERVER_CONFIG } from "../server/config.js";
import { createDiscountCode } from "../server/discount-code-service.js";
import { hashSecret, hashSessionToken, createToken } from "../server/security.js";
import { assertLocalMutatingSelfCheckEnvironment } from "./self-check-environment-guard.mjs";

await assertLocalMutatingSelfCheckEnvironment({ label: "product discount offers HTTP self-check" });
const db = getDbPool();
const suffix = Date.now().toString(36);
const viewerId = `u_product_offer_viewer_${suffix}`;
const creatorId = `u_product_offer_creator_${suffix}`;
const characterId = `creator_product_offer_${suffix}`;
const sessionId = `session_product_offer_${suffix}`;
const messageId = `message_product_offer_${suffix}`;
const authToken = createToken();
const cookie = `${SERVER_CONFIG.authCookieName}=${encodeURIComponent(authToken)}`;
const discountIds = [];
let originalProductApiUrl = null;

try {
  const [[site]] = await db.execute("SELECT product_api_url FROM sites WHERE id = 'site_fkk' LIMIT 1");
  originalProductApiUrl = site?.product_api_url ?? null;
  await db.execute("UPDATE sites SET product_api_url = '' WHERE id = 'site_fkk'");
  await insertUser(viewerId, "personal", "site_fkk", "Product Offer Viewer", authToken);
  await insertUser(creatorId, "creator", "site_fkk", "Product Offer Creator");
  await db.execute(
    `INSERT INTO ai_characters (
       id, category_id, owner_uid, site_id, slug, name, visibility, character_status, source_type, source_ref
     ) VALUES (?, 'creator', ?, 'site_fkk', ?, 'Product Offer Character', 'public', 'published', 'self-check', ?)`,
    [characterId, creatorId, `product-offer-${suffix}`, `product-offer-http-${suffix}`],
  );
  await db.execute(
    `INSERT INTO chat_sessions (
       id, internal_uid, character_id, session_title, session_status, source_type, source_ref, last_message_at
     ) VALUES (?, ?, ?, 'Product offer self-check', 'active', 'user', 'self-check', NOW(3))`,
    [sessionId, viewerId, characterId],
  );
  await db.execute(
    `INSERT INTO chat_messages (
       id, session_id, character_id, sender_type, sender_label, content_type, text_content,
       product_payload_json, display_order, delivery_status, source_type, source_ref
     ) VALUES (?, ?, ?, 'character', 'Product Offer Character', 'product', 'Self-check product', ?, 10, 'sent', 'ai', 'self-check')`,
    [messageId, sessionId, characterId, JSON.stringify({ productId: `product-${suffix}`, name: "Self-check product" })],
  );
  const first = await createDiscountCode(null, {
    code: `HTTPA${suffix}`,
    siteId: "site_fkk",
    ownershipType: "creator",
    creatorUid: creatorId,
    offerDescription: "20% OFF",
    validityMode: "indefinite",
  }, shopifyFixtureOptions("20% OFF", "percentage"));
  const second = await createDiscountCode(null, {
    code: `HTTPB${suffix}`,
    siteId: "site_fkk",
    ownershipType: "creator",
    creatorUid: creatorId,
    offerDescription: "Free shipping",
    validityMode: "indefinite",
  }, shopifyFixtureOptions("Free shipping", "free_shipping"));
  discountIds.push(first.item.id, second.item.id);

  const formal = await request("/api/products/resolve", {
    headers: { cookie },
    body: {
      siteSlug: "footballkituk",
      characterId,
      messageId,
      product: {
        productId: `product-${suffix}`,
        name: "Self-check product",
        url: "https://footballkituk.com/products/self-check",
      },
    },
  });
  assert.equal(formal.response.status, 200, `formal resolve should return 200: ${JSON.stringify(formal.payload)}`);
  assert.deepEqual(
    formal.payload.item.discountOffers.map((offer) => offer.code).sort(),
    [`HTTPA${suffix}`, `HTTPB${suffix}`].map((value) => value.toUpperCase()).sort(),
    "formal product resolve should return the current role-scoped offers",
  );
  assert.ok(formal.payload.item.discountOffers.every((offer) => !("notes" in offer) && !("creatorUid" in offer)));
  const percentageOffer = formal.payload.item.discountOffers.find((offer) => offer.code === `HTTPA${suffix}`.toUpperCase());
  const shippingOffer = formal.payload.item.discountOffers.find((offer) => offer.code === `HTTPB${suffix}`.toUpperCase());
  assert.equal(percentageOffer?.pricingPreview?.type, "percentage");
  assert.equal("pricingPreview" in (shippingOffer || {}), false, "complex discount types must not expose fake price previews");

  const mismatchedContext = await request("/api/products/resolve", {
    headers: { cookie },
    body: {
      siteSlug: "footballkituk",
      characterId: "mascot_template",
      messageId,
      product: { productId: `product-${suffix}`, name: "Self-check product" },
    },
  });
  assert.equal(mismatchedContext.response.status, 403, "a character unrelated to the product message must be rejected");
  assert.equal(mismatchedContext.payload.code, "DISCOUNT_CODE_CONTEXT_FORBIDDEN");

  const guest = await request("/api/products/resolve", {
    headers: {
      origin: "http://127.0.0.1:4173",
      referer: "http://127.0.0.1:4173/footballkituk/chat",
    },
    body: {
      siteSlug: "footballkituk",
      characterId,
      product: {
        productId: `product-${suffix}`,
        name: "Self-check product",
        url: "https://footballkituk.com/products/self-check",
      },
    },
  });
  assert.equal(guest.response.status, 200, `guest resolve should return 200: ${JSON.stringify(guest.payload)}`);
  assert.equal("discountOffers" in (guest.payload.item || {}), false, "guest response must omit discount offers");
  assert.doesNotMatch(JSON.stringify(guest.payload), new RegExp(`HTTPA${suffix}|HTTPB${suffix}`, "i"));

  console.log("product discount offers HTTP self-check passed");
} finally {
  if (originalProductApiUrl !== null) {
    await db.execute("UPDATE sites SET product_api_url = ? WHERE id = 'site_fkk'", [originalProductApiUrl]).catch(() => {});
  }
  if (discountIds.length) {
    await db.execute(`DELETE FROM discount_codes WHERE id IN (${discountIds.map(() => "?").join(",")})`, discountIds).catch(() => {});
  }
  await db.execute("DELETE FROM ai_characters WHERE id = ?", [characterId]).catch(() => {});
  await db.execute("DELETE FROM chat_messages WHERE id = ?", [messageId]).catch(() => {});
  await db.execute("DELETE FROM chat_sessions WHERE id = ?", [sessionId]).catch(() => {});
  await db.execute("DELETE FROM users WHERE id IN (?, ?)", [viewerId, creatorId]).catch(() => {});
  await closeDbPool();
}

function shopifyFixtureOptions(offerDescription, type) {
  return {
    resolveShopifyDiscountCodeImpl: async (_site, code) => ({
      shopifyDiscountId: `gid://shopify/DiscountCodeNode/${code}`,
      code: String(code || "").toUpperCase(),
      offerDescription,
      shopifyDiscountType: type,
      shopifyStatus: "ACTIVE",
      validityMode: "indefinite",
      startsAt: "2026-07-01T00:00:00.000Z",
      endsAt: "",
      rule: {
        type,
        value: type === "percentage" ? 20 : 0,
        currencyCode: "",
        appliesOnEachItem: false,
        minimumRequirement: null,
        targetScope: { type: "all" },
        customerContext: "DiscountBuyerSelectionAll",
        pricePreviewEligible: type === "percentage",
      },
    }),
  };
}

async function request(path, { headers = {}, body = null } = {}) {
  const response = await fetch(`${SERVER_CONFIG.publicBaseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body || {}),
  });
  return { response, payload: await response.json() };
}

async function insertUser(id, accountType, siteId, nickname, token = "") {
  await db.execute(
    `INSERT INTO users (
       id, platform, platform_uid, locale, username, password_hash, nickname, email,
       email_verified_at, email_auth_provider, account_type, site_id, account_status,
       auth_token, token_expires_at, last_seen_at
     ) VALUES (?, 'web', ?, 'en', ?, ?, ?, ?, NOW(3), 'email', ?, ?, 'active', ?, DATE_ADD(NOW(3), INTERVAL 1 HOUR), NOW(3))`,
    [
      id,
      id,
      `${id}@example.local`,
      hashSecret("ProductOfferHttp1234"),
      nickname,
      `${id}@example.local`,
      accountType,
      siteId,
      token ? hashSessionToken(token) : null,
    ],
  );
}
