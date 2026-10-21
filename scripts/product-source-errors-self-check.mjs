import assert from "node:assert/strict";
import { createProductSourceError, normalizeProductSourceError, PRODUCT_SOURCE_ERROR_CODE, validateProductSourceErrorCode } from "../server/product-source-error-service.js";
import { resolveShopifyMarketContext, clearShopifyMarketContextCacheForTest } from "../server/shopify-market-context-service.js";
import { fetchShopifyAdminProducts } from "../server/product-source-shopify-admin-service.js";
import { searchSiteProducts } from "../server/product-search-public-service.js";
import { toGuestSafeProductSearchResult } from "../server/guest-product-sanitizer.js";
import { getDbPool, closeDbPool } from "../server/db.js";
import { encryptSecret } from "../server/security.js";
import { SERVER_CONFIG } from "../server/config.js";

const secret = "PRIVATE_TOKEN_MUST_NOT_APPEAR";
const endpoint = "https://error-self-check.myshopify.com/admin/api/2026-04/graphql.json";
const source = "shopify-admin://error-self-check.myshopify.com?version=2026-04";
const marketPayload = { data: { markets: { nodes: [{ status: "ACTIVE", regions: { nodes: [{ code: "HU", currency: { currencyCode: "HUF" } }] } }] } } };
const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const resolve = (overrides = {}) => resolveShopifyMarketContext({ endpoint, token: secret, currency: "USD", fetchImpl: async () => response(marketPayload), ...overrides });
let checks = 0;
const check = async (label, callback) => { await callback(); checks += 1; };
const db = getDbPool();
const originalExecute = db.execute;
const originalFetch = globalThis.fetch;
const originalWarn = console.warn;
const warnings = [];
let mode = "market";
let siteCurrency = "USD";
const encryptedToken = encryptSecret(secret, SERVER_CONFIG.productApi.secretKey);

try {
  console.warn = (...values) => warnings.push(values);
  db.execute = async (sql) => {
    assert.match(String(sql), /FROM sites/);
    return [[{ id: "site_errors", slug: "errors", name: "Errors", currency: siteCurrency, product_api_url: mode === "unconfigured" ? "" : source, product_access_token_encrypted: encryptedToken }]];
  };
  globalThis.fetch = async (_url, options = {}) => {
    const query = JSON.parse(options.body || "{}").query || "";
    if (mode === "timeout") throw new DOMException(secret, "AbortError");
    if (mode === "network") throw Object.assign(new TypeError(`fetch failed ${secret}`), { cause: { code: "ECONNRESET" } });
    if (mode === "malformed") return response({ unexpected: secret });
    if (mode === "auth") return response({ error: secret }, 401);
    if (mode === "limit") return response({ error: secret }, 429);
    if (/AioveMarkets/.test(query)) return response(marketPayload);
    if (mode === "graphql") return response({ errors: [{ message: `${secret} upstream private details`, extensions: { code: "ACCESS_DENIED" } }] });
    return response({ data: { products: { nodes: [] } } });
  };

  await check("currency mismatch is typed and does not silently switch currency", async () => {
    clearShopifyMarketContextCacheForTest();
    await assert.rejects(() => resolve(), (error) => error.code === "market_currency_mismatch" && !error.message.includes(secret));
  });
  await check("configured HUF resolves the Hungarian market", async () => {
    clearShopifyMarketContextCacheForTest();
    assert.deepEqual(await resolve({ currency: "HUF" }), { countryCode: "HU", currency: "HUF" });
  });
  await check("multiple countries remain an error", async () => {
    clearShopifyMarketContextCacheForTest();
    await assert.rejects(() => resolve({ currency: "EUR", fetchImpl: async () => response({ data: { markets: { nodes: [{ status: "ACTIVE", regions: { nodes: [{ code: "DE", currency: { currencyCode: "EUR" } }, { code: "FR", currency: { currencyCode: "EUR" } }] } }] } } }) }), { code: "market_country_ambiguous" });
  });
  await check("absent credentials are explicit", async () => {
    await assert.rejects(() => fetchShopifyAdminProducts(source, {}, { encryptedAccessToken: "invalid-ciphertext", throwOnError: true }), { code: "credentials_unavailable" });
  });
  for (const [error, expected] of [
    [{ statusCode: 403, message: secret }, "auth_failed"],
    [{ message: `Product API HTTP 429 ${secret}` }, "rate_limited"],
    [{ name: "AbortError", message: secret }, "timeout"],
    [{ cause: { code: "ENOTFOUND" }, message: secret }, "source_network"],
    [{ name: "TypeError", message: `fetch failed ${secret}` }, "source_network"],
    [{ status: 502, name: secret, message: secret }, "source_internal"],
  ]) await check(expected, async () => {
    const result = normalizeProductSourceError(error, { provider: "shopify" });
    assert.equal(result.code, expected);
    assert.deepEqual(Object.keys(result), ["code", "provider", "statusCode"]);
    assert.ok(!JSON.stringify(result).includes(secret));
  });
  await check("invalid metadata is discarded", async () => {
    assert.equal(validateProductSourceErrorCode(secret), "");
    assert.deepEqual(normalizeProductSourceError({ code: secret, provider: secret, statusCode: 10000 }), { code: "source_internal", provider: "", statusCode: 0 });
    assert.equal(createProductSourceError(secret, { provider: secret }).code, "source_internal");
  });
  for (const [nextMode, currency, expected] of [["market", "USD", "market_currency_mismatch"], ["auth", "HUF", "auth_failed"], ["limit", "HUF", "rate_limited"], ["graphql", "HUF", "auth_failed"], ["unconfigured", "HUF", "source_unconfigured"], ["timeout", "HUF", "timeout"], ["network", "HUF", "source_network"], ["malformed", "HUF", "source_internal"]]) {
    await check(`public search ${expected}`, async () => {
      clearShopifyMarketContextCacheForTest(); mode = nextMode; siteCurrency = currency;
      const result = await searchSiteProducts({ siteSlug: "errors", query: "Messi jersey", strictSite: true });
      assert.equal(result.searchOutcome, "source_error");
      assert.equal(result.sourceErrorCode, expected);
      assert.deepEqual(result.items, []);
      const safe = toGuestSafeProductSearchResult({ ...result, rawError: secret });
      assert.equal(safe.sourceErrorCode, expected);
      assert.ok(!JSON.stringify(safe).includes(secret));
      assert.ok(!JSON.stringify(warnings).includes(secret), "raw error details must not enter Shopify/public search logs");
    });
  }
  await check("guest sanitizer rejects a forged error code", async () => {
    const result = toGuestSafeProductSearchResult({ sourceErrorCode: secret, sourceErrorProvider: secret, sourceErrorStatus: secret });
    assert.equal(result.sourceErrorCode, "");
    assert.ok(!JSON.stringify(result).includes(secret));
  });
  assert.equal(Object.keys(PRODUCT_SOURCE_ERROR_CODE).length, 9);
  console.log(`Product source errors self-check passed (${checks} checks; isolated responses, no external requests)`);
} finally {
  db.execute = originalExecute;
  globalThis.fetch = originalFetch;
  console.warn = originalWarn;
  clearShopifyMarketContextCacheForTest();
  await closeDbPool();
}
