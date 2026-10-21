import assert from "node:assert/strict";
import { closeDbPool, getDbPool } from "../server/db.js";
import { SERVER_CONFIG } from "../server/config.js";
import { createToken, hashSecret, hashSessionToken } from "../server/security.js";
import { assertLocalMutatingSelfCheckEnvironment } from "./self-check-environment-guard.mjs";

await assertLocalMutatingSelfCheckEnvironment({ label: "admin discount codes HTTP self-check" });

const db = getDbPool();
const suffix = Date.now().toString(36);
const baseUrl = SERVER_CONFIG.publicBaseUrl;
const adminEmail = SERVER_CONFIG.security.superAdminEmails[0] || "admin@aiove.local";
const adminId = `u_discount_http_admin_${suffix}`;
const creatorId = `u_discount_http_creator_${suffix}`;
const characterId = `creator_discount_http_${suffix}`;
const token = createToken();
const cookie = `${SERVER_CONFIG.authCookieName}=${encodeURIComponent(token)}`;
const code = `HTTP${suffix}`.toUpperCase();
const unavailableSiteId = `site_discount_http_${suffix}`;
let restoreAdmin = null;
let discountCodeId = "";

try {
  const unauthorized = await fetch(`${baseUrl}/api/admin/discount-codes`);
  assert.equal(unauthorized.status, 401, "discount-code list must reject unauthenticated callers");
  const unauthorizedSearch = await fetch(`${baseUrl}/api/admin/discount-codes/shopify-search?siteId=site_fkk&query=TE`);
  assert.equal(unauthorizedSearch.status, 401, "Shopify discount search must reject unauthenticated callers");

  restoreAdmin = await ensureSuperAdminSession();
  await createCreatorFixture();
  await db.execute(
    `INSERT INTO sites (id, name, slug, site_status, is_default, product_api_url)
     VALUES (?, 'Discount HTTP Empty Site', ?, 'active', 0, NULL)`,
    [unavailableSiteId, `discount-http-empty-${suffix}`],
  );

  const options = await request("/api/admin/discount-codes/options");
  assert.equal(options.response.status, 200, "admin options should return 200");
  assert.ok(options.payload.sites.some((site) => site.id === "site_fkk"), "options should include active FKK site");
  assert.ok(options.payload.creators.some((creator) => creator.id === creatorId), "options should include active creator with a creator character");

  const unavailableSearch = await request(`/api/admin/discount-codes/shopify-search?siteId=${encodeURIComponent(unavailableSiteId)}&query=TE`);
  assert.equal(unavailableSearch.response.status, 400, "site without Shopify source must fail closed");
  assert.equal(unavailableSearch.payload.code, "SHOPIFY_DISCOUNT_SOURCE_UNAVAILABLE");

  const unavailableCreate = await request("/api/admin/discount-codes", {
    method: "POST",
    body: payload({ siteId: unavailableSiteId }),
  });
  assert.equal(unavailableCreate.response.status, 400, "create must not accept an unverified manual code");
  assert.equal(unavailableCreate.payload.code, "SHOPIFY_DISCOUNT_SOURCE_UNAVAILABLE");

  discountCodeId = `discount_http_${suffix}`;
  await db.execute(
    `INSERT INTO discount_codes (
       id, site_id, code, ownership_type, creator_uid, offer_description,
       validity_mode, starts_at, ends_at, is_enabled, notes,
       shopify_discount_id, shopify_discount_type, shopify_status, shopify_rule_json, shopify_synced_at
     ) VALUES (?, 'site_fkk', ?, 'creator', ?, 'HTTP self-check offer',
       'indefinite', NOW(3), NULL, 1, NULL,
       'gid://shopify/DiscountCodeNode/http', 'percentage', 'ACTIVE', ?, NOW(3))`,
    [discountCodeId, code, creatorId, JSON.stringify({
      type: "percentage",
      value: 10,
      targetScope: { type: "all" },
      customerContext: "DiscountBuyerSelectionAll",
      pricePreviewEligible: true,
    })],
  );

  const rejectedUpdate = await request(`/api/admin/discount-codes/${encodeURIComponent(discountCodeId)}`, {
    method: "PATCH",
    body: { siteId: unavailableSiteId, code, ownershipType: "site", isEnabled: false },
  });
  assert.equal(rejectedUpdate.response.status, 400, "update must revalidate against the selected Shopify site");
  assert.equal(rejectedUpdate.payload.code, "SHOPIFY_DISCOUNT_SOURCE_UNAVAILABLE");

  const filtered = await request(`/api/admin/discount-codes?site=site_fkk&ownershipType=creator&status=active&query=${encodeURIComponent(code)}`);
  assert.equal(filtered.response.status, 200, "filtered list should return 200");
  assert.equal(filtered.payload.items.length, 1, "filtered list should return the trusted snapshot fixture once");
  assert.equal(filtered.payload.items[0].id, discountCodeId);
  assert.equal(filtered.payload.items[0].shopifyDiscountType, "percentage");

  console.log("admin discount codes HTTP self-check passed");
} finally {
  await db.execute("DELETE FROM discount_codes WHERE id = ? OR code = ?", [discountCodeId || "__none__", code]).catch(() => {});
  await db.execute("DELETE FROM ai_characters WHERE id = ?", [characterId]).catch(() => {});
  await db.execute("DELETE FROM users WHERE id = ?", [creatorId]).catch(() => {});
  await db.execute("DELETE FROM sites WHERE id = ?", [unavailableSiteId]).catch(() => {});
  if (typeof restoreAdmin === "function") await restoreAdmin();
  await closeDbPool();
}

function payload(overrides = {}) {
  return {
    code,
    siteId: "site_fkk",
    ownershipType: "site",
    creatorUid: "",
    offerDescription: "HTTP self-check offer",
    validityMode: "indefinite",
    isEnabled: true,
    ...overrides,
  };
}

async function request(path, { method = "GET", body = null } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { ...(body ? { "content-type": "application/json" } : {}), cookie },
    body: body ? JSON.stringify(body) : null,
  });
  return { response, payload: await response.json() };
}

async function createCreatorFixture() {
  await db.execute(
    `INSERT INTO users (
       id, platform, platform_uid, locale, username, password_hash, nickname, email,
       email_verified_at, email_auth_provider, account_type, site_id, account_status, last_seen_at
     ) VALUES (?, 'web', ?, 'cn', ?, ?, 'Discount HTTP Creator', ?, NOW(3), 'email', 'creator', 'site_fkk', 'active', NOW(3))`,
    [creatorId, creatorId, `${creatorId}@example.local`, hashSecret("DiscountHttpCreator1234"), `${creatorId}@example.local`],
  );
  await db.execute(
    `INSERT INTO ai_characters (
       id, category_id, owner_uid, site_id, slug, name, visibility, character_status, source_type, source_ref
     ) VALUES (?, 'creator', ?, 'site_fkk', ?, 'Discount HTTP Character', 'public', 'published', 'self-check', ?)`,
    [characterId, creatorId, `discount-http-${suffix}`, `discount-http-${suffix}`],
  );
}

async function ensureSuperAdminSession() {
  const [[existing]] = await db.execute(
    "SELECT id, account_type, account_status, auth_token, token_expires_at FROM users WHERE email = ? LIMIT 1",
    [adminEmail],
  );
  const tokenHash = hashSessionToken(token);
  if (existing?.id) {
    await db.execute(
      "UPDATE users SET account_type = 'admin', account_status = 'active', auth_token = ?, token_expires_at = DATE_ADD(NOW(3), INTERVAL 1 HOUR) WHERE id = ?",
      [tokenHash, existing.id],
    );
    return async () => {
      await db.execute(
        "UPDATE users SET account_type = ?, account_status = ?, auth_token = ?, token_expires_at = ? WHERE id = ?",
        [existing.account_type, existing.account_status, existing.auth_token, existing.token_expires_at, existing.id],
      ).catch(() => {});
    };
  }
  await db.execute(
    `INSERT INTO users (
       id, platform, platform_uid, locale, username, password_hash, nickname, email,
       email_verified_at, email_auth_provider, account_type, site_id, account_status,
       auth_token, token_expires_at, last_seen_at
     ) VALUES (?, 'web', ?, 'cn', ?, ?, 'Discount HTTP Admin', ?, NOW(3), 'email', 'admin', 'site_fkk',
       'active', ?, DATE_ADD(NOW(3), INTERVAL 1 HOUR), NOW(3))`,
    [adminId, adminEmail, adminEmail, hashSecret("DiscountHttpAdmin1234"), adminEmail, tokenHash],
  );
  return async () => {
    await db.execute("DELETE FROM users WHERE id = ?", [adminId]).catch(() => {});
  };
}
