import assert from "node:assert/strict";
import {
  clearShopifyMarketContextCacheForTest,
  resolveShopifyMarketContext,
} from "../server/shopify-market-context-service.js";

clearShopifyMarketContextCacheForTest();
let calls = 0;
const marketContext = await resolveShopifyMarketContext({
  endpoint: "https://market-self-check.myshopify.com/admin/api/2026-04/graphql.json",
  token: "self-check-token",
  currency: "GBP",
  fetchImpl: async (_url, options) => {
    calls += 1;
    const body = JSON.parse(options.body || "{}");
    assert.match(body.query, /^query\s+AioveMarkets/m, "market context should only read Shopify Markets");
    return response({
      data: {
        markets: {
          nodes: [
            { status: "INACTIVE", regions: { nodes: [{ code: "IE", currency: { currencyCode: "GBP" } }] } },
            { status: "ACTIVE", regions: { nodes: [{ code: "GB", currency: { currencyCode: "GBP" } }] } },
            { status: "ACTIVE", regions: { nodes: [{ code: "US", currency: { currencyCode: "USD" } }] } },
          ],
        },
      },
    });
  },
});

assert.deepEqual(marketContext, { countryCode: "GB", currency: "GBP" }, "the configured site currency should resolve to its one active Shopify market country");
await resolveShopifyMarketContext({
  endpoint: "https://market-self-check.myshopify.com/admin/api/2026-04/graphql.json",
  token: "self-check-token",
  currency: "GBP",
  fetchImpl: async () => {
    throw new Error("cached market context should not make another request");
  },
});
assert.equal(calls, 1, "market context should be cached per Shopify endpoint and configured currency");

clearShopifyMarketContextCacheForTest();
await assert.rejects(() => resolveShopifyMarketContext({
  endpoint: "https://ambiguous-market-self-check.myshopify.com/admin/api/2026-04/graphql.json",
  token: "self-check-token",
  currency: "EUR",
  fetchImpl: async () => response({
    data: {
      markets: {
        nodes: [{
          status: "ACTIVE",
          regions: {
            nodes: [
              { code: "DE", currency: { currencyCode: "EUR" } },
              { code: "FR", currency: { currencyCode: "EUR" } },
            ],
          },
        }],
      },
    },
  }),
}), /multiple countries/i, "ambiguous currency markets must not guess a country");

console.log("Shopify market context self-check passed");

function response(body) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  };
}
