import assert from "node:assert/strict";
import { buildChatProductRecommendationContext } from "../server/chat-product-recommendation-service.js";
import { searchCachedProducts, PRODUCT_CACHE_STALE_FALLBACK_MS } from "../server/product-cache-search-service.js";

globalThis.fetch = async () => { throw new Error("External providers disabled in isolated product check"); };
const singleProductRequest = { relation: "single", action: "new", items: [], selectedIndex: null, selectionEvidence: "" };
const classifyShopping = async () => ({ route: "product_search", confident: true, confidence: .99, productRequest: singleProductRequest, replyBoundary: { salesAllowed: true, contactAllowed: true } });
const now = Date.parse("2026-09-04T12:00:00.000Z");
const site = {
  id: "site_bs",
  name: "BS",
  slug: "bestsoccerstore",
  currency: "USD",
  product_api_url: "ttmall://api.example.test?websiteId=6",
  product_access_token_encrypted: "",
  payment_methods_json: "[]",
};
const rows = [{
  site_id: "site_bs",
  site_slug: "bestsoccerstore",
  external_product_key: "sporting-plus",
  product_title: "Sporting CP Home Replica Jersey Plus Size",
  product_url: "https://www.bestsoccerstore.cc/products/sporting-plus",
  image_url: "https://cdn.example.test/sporting-plus.jpg",
  price_now: "39.99",
  sizes_json: JSON.stringify([{ label: "2XL" }, { label: "3XL" }]),
  features_json: "[]",
  product_payload_json: JSON.stringify({
    id: "sporting-plus",
    name: "Sporting CP Home Replica Jersey Plus Size",
    url: "https://www.bestsoccerstore.cc/products/sporting-plus",
    sizes: [{ label: "2XL" }, { label: "3XL" }],
  }),
  source_rank: 1,
  cached_status: "active",
  last_synced_at: "2026-09-04T11:30:00.000Z",
}];
const intent = {
  query: "Sporting CP plus size replica jersey",
  requestedTeam: "Sporting CP",
  requestedProductType: "shirt",
  requestedSizeProfile: "plus_size",
};
const loadRows = async (siteId) => {
  assert.equal(siteId, "site_bs");
  return rows;
};

const fresh = await searchCachedProducts({ siteId: "site_bs", query: intent.query, searchIntent: intent, now, maxAgeMs: 4 * 60 * 60 * 1000 }, { loadRows, now });
assert.equal(fresh.products.length, 1, "fresh matching cache should return a product");

const stale = await searchCachedProducts({ siteId: "site_bs", query: intent.query, searchIntent: intent, now, maxAgeMs: PRODUCT_CACHE_STALE_FALLBACK_MS }, { loadRows, now });
assert.equal(stale.products.length, 1, "recent stale fallback window should still match");

const miss = await searchCachedProducts({ siteId: "site_bs", query: "Real Madrid goalkeeper jersey", searchIntent: { ...intent, query: "Real Madrid goalkeeper jersey", requestedTeam: "Real Madrid" }, now, maxAgeMs: 4 * 60 * 60 * 1000 }, { loadRows, now });
assert.equal(miss.products.length, 0, "cache must not cross-team match");

const chatDb = { async execute(sql) {
  if (String(sql).includes("FROM sites") && String(sql).includes("WHERE s.id = ?")) return [[{
    ...site,
    payment_methods_json: "[]",
  }]];
  throw new Error(`Unexpected self-check query: ${sql}`);
} };
let remoteCalls = 0;
const cachedContext = await buildChatProductRecommendationContext(chatDb, {
  classifyCommerce: classifyShopping,
  character: { id: "mascot_bs", category_id: "mascot", site_id: "site_bs" },
  userText: intent.query,
  recentMessages: [],
  fetchProducts: async () => { remoteCalls += 1; throw new Error("remote should not be called"); },
  searchCache: async () => ({ products: fresh.products, source: "cache", ageMs: 1800000 }),
});
assert.equal(cachedContext?.sourceType, "kitshop_cache", "fresh cache should be the first chat source");
assert.equal(remoteCalls, 0, "fresh cache hit should avoid remote search");

const staleContext = await buildChatProductRecommendationContext(chatDb, {
  classifyCommerce: classifyShopping,
  character: { id: "mascot_bs", category_id: "mascot", site_id: "site_bs" },
  userText: intent.query,
  recentMessages: [],
  fetchProducts: async () => { throw new Error("simulated remote timeout"); },
  searchCache: async ({ maxAgeMs }) => maxAgeMs === PRODUCT_CACHE_STALE_FALLBACK_MS
    ? { products: fresh.products, source: "cache", ageMs: 10 * 60 * 60 * 1000 }
    : { products: [], source: "cache", ageMs: null },
});
assert.equal(staleContext?.sourceRef, "site-product-cache-stale-fallback", "remote timeout should use bounded stale cache");
console.log("product-cache-search-self-check: ok");
