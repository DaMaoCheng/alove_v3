import assert from "node:assert/strict";
import { closeDbPool, getDbPool } from "../server/db.js";
import { SERVER_CONFIG } from "../server/config.js";
import { createProductSearchAnalyticsReceipt } from "../server/product-search-analytics-receipt-service.js";
import { createToken, hashSecret, hashSessionToken } from "../server/security.js";
import { assertLocalMutatingSelfCheckEnvironment } from "./self-check-environment-guard.mjs";

await assertLocalMutatingSelfCheckEnvironment({ label: "product route HTTP self-check" });

const db = getDbPool();
const suffix = Date.now().toString(36);
const userId = `u_product_route_${suffix}`;
const adminUserId = `u_product_route_admin_${suffix}`;
const email = `product-route-${suffix}@example.local`;
const adminEmail = `product-route-admin-${suffix}@example.local`;
const token = createToken();
const adminToken = createToken();
const cookie = `${SERVER_CONFIG.authCookieName}=${encodeURIComponent(token)}`;
const adminCookie = `${SERVER_CONFIG.authCookieName}=${encodeURIComponent(adminToken)}`;
const baseUrl = SERVER_CONFIG.publicBaseUrl;

try {
  await db.execute(
    `INSERT INTO users (
       id, platform, platform_uid, locale, username, password_hash, nickname,
       email, email_verified_at, email_auth_provider, account_type, site_id,
       account_status, auth_token, token_expires_at, last_seen_at
     ) VALUES (?, 'web', ?, 'cn', ?, ?, 'Product Route Check', ?, NOW(3), 'email',
       'personal', 'site_fkk', 'active', ?, DATE_ADD(NOW(3), INTERVAL 1 HOUR), NOW(3))`,
    [userId, email, email, hashSecret("ProductRouteCheck1234"), email, hashSessionToken(token)]
  );
  await db.execute(
    `INSERT INTO users (
       id, platform, platform_uid, locale, username, password_hash, nickname,
       email, email_verified_at, email_auth_provider, account_type, site_id,
       account_status, auth_token, token_expires_at, last_seen_at
     ) VALUES (?, 'web', ?, 'cn', ?, ?, 'Product Route Admin Check', ?, NOW(3), 'email',
       'admin', 'site_gg', 'active', ?, DATE_ADD(NOW(3), INTERVAL 1 HOUR), NOW(3))`,
    [adminUserId, adminEmail, adminEmail, hashSecret("ProductRouteAdminCheck1234"), adminEmail, hashSessionToken(adminToken)]
  );

  const noOrigin = await fetch(`${baseUrl}/api/products/search?siteSlug=footballkituk&query=shirt`);
  assert.equal(noOrigin.status, 403, "guest product search without an Alove origin should be rejected");

  const crossSite = await fetch(`${baseUrl}/api/products/search?siteSlug=gogoalshop&query=shirt`, {
    headers: { cookie },
  });
  assert.equal(crossSite.status, 403, "ordinary accounts should not read a cross-site trusted catalog");

  const sameSite = await fetch(`${baseUrl}/api/products/search?siteSlug=footballkituk&query=shirt&limit=2`, {
    headers: { cookie },
  });
  const sameSitePayload = await sameSite.json();
  assert.equal(sameSite.status, 200, `same-site product search should return 200: ${JSON.stringify(sameSitePayload)}`);
  assert.ok(Array.isArray(sameSitePayload.items), "same-site product search should return an item list");
  assert.ok(
    sameSitePayload.items.every((item) => (item.sizes || []).every((size) => !("inventoryQuantity" in size))),
    "authenticated product search should not expose exact Admin inventory"
  );

  const kitshopResponse = await fetch(`${baseUrl}/api/kitshop?siteSlug=footballkituk`, {
    headers: { cookie },
  });
  const kitshopPayload = await kitshopResponse.json();
  assert.equal(kitshopResponse.status, 200, `same-site Kitshop should return 200: ${JSON.stringify(kitshopPayload)}`);
  assert.ok(
    (kitshopPayload.shelves || []).every((shelf) => (shelf.items || []).every((item) => (
      (item.sizes || []).every((size) => !("inventoryQuantity" in size))
    ))),
    "authenticated Kitshop should not expose exact Admin inventory"
  );

  if (sameSitePayload.items[0]) {
    const searchReceipt = sameSitePayload.items[0]?.analytics?.searchReceipt || "";
    assert.ok(searchReceipt, "authenticated product search results should include a server-issued analytics receipt");
    const analyticsResponse = await fetch(`${baseUrl}/api/analytics/product-events`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        eventType: "product_search_result_click",
        searchReceipt,
        source: "search_product_result",
      }),
    });
    assert.equal(analyticsResponse.status, 200, `a valid search result receipt should record: ${await analyticsResponse.text()}`);
    const tamperedAnalyticsResponse = await fetch(`${baseUrl}/api/analytics/product-events`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        eventType: "product_search_result_click",
        searchReceipt: `${searchReceipt}x`,
        source: "search_product_result",
      }),
    });
    assert.equal(tamperedAnalyticsResponse.status, 400, "a tampered search result receipt should be rejected");
    const [[recordedSearchClick]] = await db.execute(
      `SELECT site_id, site_slug, product_id
       FROM product_analytics_events
       WHERE event_type = 'product_search_result_click' AND user_id = ?
       ORDER BY created_at DESC
       LIMIT 1`,
      [userId]
    );
    assert.equal(recordedSearchClick.site_id, "site_fkk");
    assert.equal(recordedSearchClick.site_slug, "footballkituk");
    assert.ok(recordedSearchClick.product_id, "recorded search clicks should retain the trusted product identity");

    const resolvedResponse = await fetch(`${baseUrl}/api/products/resolve`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ siteSlug: "footballkituk", product: sameSitePayload.items[0] }),
    });
    const resolvedPayload = await resolvedResponse.json();
    assert.equal(resolvedResponse.status, 200, `same-site product resolve should return 200: ${JSON.stringify(resolvedPayload)}`);
    assert.equal("sourceItem" in resolvedPayload, false, "resolved responses should not expose the internal source item");
    assert.ok(
      (resolvedPayload.item?.sizes || []).every((size) => !("inventoryQuantity" in size)),
      "resolved responses should not expose exact Admin inventory"
    );
  }

  const adminCrossSiteReceipt = createProductSearchAnalyticsReceipt({
    userId: adminUserId,
    siteId: "site_fkk",
    siteSlug: "footballkituk",
    product: { id: "admin-cross-site-product", name: "Admin cross-site product", url: "https://footballkituk.com/products/admin-cross-site-product" },
  });
  const adminAnalyticsResponse = await fetch(`${baseUrl}/api/analytics/product-events`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: adminCookie },
    body: JSON.stringify({ eventType: "product_search_result_click", searchReceipt: adminCrossSiteReceipt }),
  });
  assert.equal(adminAnalyticsResponse.status, 200, `an administrator should record a signed cross-site search result: ${await adminAnalyticsResponse.text()}`);
  const [[adminSearchClick]] = await db.execute(
    `SELECT site_id, site_slug
     FROM product_analytics_events
     WHERE event_type = 'product_search_result_click' AND user_id = ?
     ORDER BY created_at DESC
     LIMIT 1`,
    [adminUserId]
  );
  assert.equal(adminSearchClick.site_id, "site_fkk");
  assert.equal(adminSearchClick.site_slug, "footballkituk");

  console.log("product route HTTP self-check passed");
} finally {
  await db.execute("DELETE FROM product_analytics_events WHERE user_id IN (?, ?)", [userId, adminUserId]).catch(() => {});
  await db.execute("DELETE FROM users WHERE id IN (?, ?)", [userId, adminUserId]).catch(() => {});
  await closeDbPool();
}
