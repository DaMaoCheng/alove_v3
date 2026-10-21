import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { aggregateShopifyOrderSales, fetchShopifyOrderSalesSnapshot } from "../server/shopify-order-sales-service.js";
import { buildKitshopShelves, mapCachedProducts } from "../server/kitshop-shelf-builder.js";
import { SERVER_CONFIG } from "../server/config.js";
import { encryptSecret } from "../server/security.js";

const now = new Date("2026-07-14T12:00:00.000Z");
const sales = aggregateShopifyOrderSales([
  order("2026-07-10T12:00:00.000Z", "PAID", [["gid://shopify/Product/p1", 2], ["gid://shopify/Product/p2", 1]]),
  order("2026-07-01T12:00:00.000Z", "PARTIALLY_REFUNDED", [["gid://shopify/Product/p2", 4], ["gid://shopify/Product/p3", 5]]),
  order("2026-06-01T12:00:00.000Z", "PAID", [["gid://shopify/Product/p4", 7]]),
  order("2026-05-25T12:00:00.000Z", "PARTIALLY_PAID", [["gid://shopify/Product/p1", 10]]),
  { ...order("2026-07-12T12:00:00.000Z", "PAID", [["gid://shopify/Product/cancelled", 99]]), cancelledAt: "2026-07-13T00:00:00.000Z" },
  { ...order("2026-07-12T12:00:00.000Z", "PAID", [["gid://shopify/Product/test", 99]]), test: true },
  order("2026-07-12T12:00:00.000Z", "REFUNDED", [["gid://shopify/Product/refunded", 99]]),
  order("2026-07-12T12:00:00.000Z", "PAID", [["gid://shopify/Product/zero", 0]]),
], { now });

assert.deepEqual(sales.rank30d.map((item) => [item.productId, item.units]), [
  ["gid://shopify/Product/p2", 5],
  ["gid://shopify/Product/p3", 5],
  ["gid://shopify/Product/p1", 2],
]);
assert.deepEqual(sales.rank60d.map((item) => [item.productId, item.units]), [
  ["gid://shopify/Product/p1", 12],
  ["gid://shopify/Product/p4", 7],
  ["gid://shopify/Product/p2", 5],
  ["gid://shopify/Product/p3", 5],
]);

const cachedRows = mapCachedProducts(Array.from({ length: 10 }, (_, index) => cacheRow(`p${index + 1}`, index + 1)));
const homepageSections = [
  { sectionKey: "primary", title: "Primary", productKeys: ["gid://shopify/Product/p1"] },
  { sectionKey: "secondary", title: "Secondary", productKeys: ["gid://shopify/Product/p2", "gid://shopify/Product/p3", "gid://shopify/Product/p4", "gid://shopify/Product/p5", "gid://shopify/Product/p6"] },
  { sectionKey: "third", title: "Third", productKeys: ["gid://shopify/Product/p7", "gid://shopify/Product/p8", "gid://shopify/Product/p9", "gid://shopify/Product/p10"] },
];
const salesSnapshot = { ...sales, shuffleSeed: "sales-self-check-seed" };
const shelves = buildKitshopShelves(cachedRows, { homepageSections, salesSnapshot });
const repeated = buildKitshopShelves(cachedRows, { homepageSections, salesSnapshot });
const bestSellerIds = shelves[1].items.map((item) => item.productId);

assert.equal(shelves.length, 2);
assert.equal(bestSellerIds.length, 9);
assert.equal(new Set(bestSellerIds).size, bestSellerIds.length, "Best Sellers must never contain duplicate products");
assert.ok(!bestSellerIds.includes("gid://shopify/Product/p1"), "Best Sellers must not duplicate the first homepage shelf");
assert.ok(bestSellerIds.includes("gid://shopify/Product/p2"));
assert.ok(bestSellerIds.includes("gid://shopify/Product/p3"));
assert.ok(bestSellerIds.includes("gid://shopify/Product/p4"), "unused 60-day sales winners should be included");
assert.deepEqual(bestSellerIds, repeated[1].items.map((item) => item.productId), "the same cache seed should keep the mixed order stable");

const schema = readFileSync("database/schema.sql", "utf8");
const bootstrap = readFileSync("server/db-bootstrap-commerce-tables.js", "utf8");
const orderSalesSource = readFileSync("server/shopify-order-sales-service.js", "utf8");
assert.match(schema, /CREATE TABLE IF NOT EXISTS site_kitshop_sales_cache/);
assert.match(bootstrap, /createSiteKitshopSalesCacheTableIfMissing/);
assert.match(schema, /sync_status VARCHAR\(32\) NOT NULL DEFAULT 'ready'/);
assert.match(schema, /last_synced_at DATETIME\(3\) NULL/);
assert.doesNotMatch(orderSalesSource, /SALES_CANDIDATES_PER_WINDOW|slice\(0,\s*16\)/, "all 32 entries from both sales windows should be eligible for product lookup");
assert.match(orderSalesSource, /retry-after/);

const graphqlCalls = [];
const payloads = [
  {
    status: 200,
    body: {
      data: { markets: { nodes: [{ status: "ACTIVE", regions: { nodes: [{ code: "GB", currency: { currencyCode: "GBP" } }] } }] } },
    },
  },
  {
    status: 200,
    body: {
      errors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }],
      extensions: { cost: { requestedQueryCost: 1, throttleStatus: { currentlyAvailable: 0, restoreRate: 100000 } } },
    },
  },
  {
    status: 200,
    body: {
      data: {
        orders: {
          pageInfo: { hasNextPage: false, endCursor: null },
          edges: [{
            node: {
              id: "gid://shopify/Order/o1",
              createdAt: "2026-07-10T12:00:00.000Z",
              test: false,
              cancelledAt: null,
              displayFinancialStatus: "PAID",
              lineItems: {
                pageInfo: { hasNextPage: true, endCursor: "line-page-1" },
                edges: [{ node: { currentQuantity: 2, product: { id: "gid://shopify/Product/p1" } } }],
              },
            },
          }],
        },
      },
      extensions: { cost: { requestedQueryCost: 1, throttleStatus: { currentlyAvailable: 1000, restoreRate: 100 } } },
    },
  },
  {
    status: 200,
    body: {
      data: {
        order: {
          lineItems: {
            pageInfo: { hasNextPage: false, endCursor: null },
            edges: [{ node: { currentQuantity: 3, product: { id: "gid://shopify/Product/p2" } } }],
          },
        },
      },
      extensions: { cost: { requestedQueryCost: 1, throttleStatus: { currentlyAvailable: 1000, restoreRate: 100 } } },
    },
  },
  {
    status: 200,
    body: {
      data: {
        nodes: [shopifyProduct("p1"), shopifyProduct("p2")],
      },
    },
  },
];
const fetched = await fetchShopifyOrderSalesSnapshot({
  id: "site_test",
  slug: "test",
  currency: "GBP",
  product_api_url: "shopify-admin://sales-self-check.myshopify.com?version=2026-04",
  product_access_token_encrypted: encryptSecret("test-token", SERVER_CONFIG.productApi.secretKey),
}, {
  now,
  fetchImpl: async (_url, options) => {
    graphqlCalls.push(JSON.parse(options.body));
    const next = payloads.shift();
    assert.ok(next, "mock GraphQL response should be available");
    return { ok: next.status >= 200 && next.status < 300, status: next.status, json: async () => next.body };
  },
});
assert.equal(graphqlCalls.length, 5, "market lookup, throttle retry, order page, line-item page and product lookup should all run");
assert.match(graphqlCalls[0].query, /^query\s+AioveMarkets/m, "sales refresh should resolve the configured market first");
const recentOrdersQuery = graphqlCalls.find((call) => /AioveRecentProductSales/.test(call.query))?.query || "";
assertGraphqlBracesAreBalanced(recentOrdersQuery, "recent-order sales query must close every GraphQL selection set");
const rankedProductsQuery = graphqlCalls.find((call) => /AioveSalesRankedProducts/.test(call.query))?.query || "";
assertGraphqlBracesAreBalanced(rankedProductsQuery, "ranked-product sales query must close every GraphQL selection set");
assert.match(graphqlCalls[3].query, /AioveOrderLineItems/);
assert.deepEqual(fetched.rank30d.map((item) => [item.productId, item.units]), [
  ["gid://shopify/Product/p2", 3],
  ["gid://shopify/Product/p1", 2],
]);
assert.equal(fetched.products.length, 2, "products from all line-item pages should be resolvable");
assert.match(graphqlCalls[4].query, /contextualPricing\(context:\s*\{\s*country:\s*\$country\s*\}\)/, "ranked products should request resolved contextual pricing");
assert.equal(graphqlCalls[4].variables.country, "GB", "ranked products should use the country resolved from Shopify Markets");
assert.doesNotMatch(graphqlCalls[4].query, /\bshop\s*\{\s*currencyCode\s*\}/, "ranked products must not request the base shop currency");
assert.equal(fetched.products[0].price, "£36.00", "ranked products should use UK contextual market pricing");
assert.equal(fetched.products[0].currency, "GBP", "ranked products should retain the market currency");
assert.ok(fetched.rank30d.every((item) => !Object.hasOwn(item, "lastSoldAt")), "exact sale timestamps must not leave the aggregation boundary");

console.log("Shopify order sales self-check passed");

function assertGraphqlBracesAreBalanced(query, message) {
  let depth = 0;
  for (const character of String(query || "")) {
    if (character === "{") depth += 1;
    if (character === "}") depth -= 1;
    assert.ok(depth >= 0, message);
  }
  assert.equal(depth, 0, message);
}

function order(createdAt, displayFinancialStatus, products) {
  return {
    createdAt,
    displayFinancialStatus,
    test: false,
    cancelledAt: null,
    lineItems: {
      edges: products.map(([productId, currentQuantity]) => ({ node: { currentQuantity, product: { id: productId } } })),
    },
  };
}

function cacheRow(id, sourceRank) {
  const productId = `gid://shopify/Product/${id}`;
  return {
    id: `cache_${id}`,
    site_id: "site_fkk",
    site_slug: "footballkituk",
    external_product_key: productId,
    product_title: id.toUpperCase(),
    product_url: `https://footballkituk.com/products/${id}`,
    product_payload_json: JSON.stringify({ id: productId, productId, name: id.toUpperCase(), url: `https://footballkituk.com/products/${id}` }),
    source_rank: sourceRank,
    last_synced_at: "2026-07-14T12:00:00.000Z",
  };
}

function shopifyProduct(id) {
  return {
    id: `gid://shopify/Product/${id}`,
    title: id.toUpperCase(),
    handle: id,
    status: "ACTIVE",
    onlineStoreUrl: `https://sales-self-check.example/products/${id}`,
    featuredImage: { url: `https://sales-self-check.example/${id}.jpg` },
    images: { edges: [] },
    variants: {
      nodes: [{
          id: `gid://shopify/ProductVariant/${id}`,
          title: "Default",
          sku: id,
          contextualPricing: {
            price: { amount: "36.00", currencyCode: "GBP" },
            compareAtPrice: { amount: "73.00", currencyCode: "GBP" },
          },
          availableForSale: true,
          inventoryQuantity: 10,
          selectedOptions: [],
      }],
    },
  };
}
