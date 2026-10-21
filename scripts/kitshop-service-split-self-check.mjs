import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildKitshopShelves,
  latestKitshopSyncedAt,
  mapActiveHomepageSections,
  mapCachedProducts,
  needsKitshopRefresh,
  normalizeCacheProducts,
  normalizeHomeProductSections,
  resolvePublicStorefrontUrl,
  shouldReplaceStorefrontUrl,
} from "../server/kitshop-shelf-builder.js";

const serviceSource = readFileSync("server/kitshop-service.js", "utf8");
const repositorySource = readFileSync("server/kitshop-repository.js", "utf8");
const builderSource = readFileSync("server/kitshop-shelf-builder.js", "utf8");
const routesSource = readFileSync("server/kitshop-routes.js", "utf8");
const backgroundRefreshSource = readFileSync("server/kitshop-background-refresh-service.js", "utf8");

assert.match(serviceSource, /export async function getKitshopShelves/, "Kitshop facade should preserve getKitshopShelves");
assert.match(serviceSource, /listCachedProductRows/, "Kitshop facade should delegate cache reads");
assert.match(serviceSource, /buildKitshopShelves/, "Kitshop facade should delegate shelf construction");
assert.doesNotMatch(serviceSource, /INSERT INTO site_product_cache|FROM site_product_cache/, "Kitshop facade should not own cache SQL");
assert.ok(serviceSource.split(/\r?\n/).length <= 180, "Kitshop facade should remain an orchestration boundary");

assert.match(repositorySource, /INSERT INTO site_product_cache/, "Kitshop repository should own product cache writes");
assert.match(repositorySource, /FROM site_product_cache/, "Kitshop repository should own product cache reads");
assert.match(repositorySource, /site_home_product_sections/, "Kitshop repository should own homepage section persistence");
assert.match(repositorySource, /site_kitshop_sales_cache/, "Kitshop repository should own sales snapshot persistence");
assert.doesNotMatch(builderSource, /getDbPool|\.execute\(/, "Kitshop shelf builder should remain database-free");
assert.match(serviceSource, /acquireDedicatedDbAdvisoryLock/, "Kitshop source refreshes should use a per-site database lock");
assert.match(routesSource, /allowRefresh:\s*false/, "public Kitshop reads must not block on privileged source refreshes");
assert.match(routesSource, /scheduleKitshopRefresh/, "logged-in stale reads should schedule a background refresh");
assert.match(routesSource, /cache\?\.needsRefresh && result\.cache\?\.canRefresh/, "an empty configured cache should schedule its first background refresh");
assert.match(backgroundRefreshSource, /pendingRefreshes = new Map/, "background refreshes should be single-flight within one process");

const site = { id: "site_1", slug: "footballkituk" };
const productRows = normalizeCacheProducts(site, [
  { id: "p1", name: "Home Shirt", url: "https://store.example/products/home", price: "£10" },
  { id: "p2", name: "Away Shirt", url: "https://store.example/products/away", price: "£20" },
  { id: "p3", name: "Third Shirt", url: "https://store.example/products/third", price: "£30" },
]);
assert.equal(productRows.length, 3);

const mappedProducts = mapCachedProducts(productRows.map((row) => ({
  id: row.id,
  site_id: row.siteId,
  site_slug: row.siteSlug,
  external_product_key: row.externalProductKey,
  product_title: row.productTitle,
  product_subtitle: row.productSubtitle,
  product_url: row.productUrl,
  image_url: row.imageUrl,
  image_urls_json: JSON.stringify(row.imageUrls),
  price_now: row.priceNow,
  price_was: row.priceWas,
  stock_text: row.stockText,
  available: row.available,
  sizes_json: JSON.stringify(row.sizes),
  features_json: JSON.stringify(row.features),
  product_payload_json: JSON.stringify(row.payload),
  last_synced_at: "2026-07-13T00:00:00.000Z",
})));

const sectionRows = normalizeHomeProductSections(site, [
  {
    sectionKey: "missing-home-section",
    sectionTitle: "Missing home shelf",
    products: [{ id: "missing-product" }],
  },
  {
    sectionKey: "home",
    sectionTitle: "<b>Home shelf</b>",
    products: [{ id: "p2" }, { id: "p1" }],
  },
  {
    sectionKey: "second-home-section",
    sectionTitle: "Second home shelf",
    products: [{ id: "p3" }],
  },
]);
const sections = mapActiveHomepageSections(sectionRows.map((row) => ({
  section_key: row.sectionKey,
  section_title: row.sectionTitle,
  product_keys_json: JSON.stringify(row.productKeys),
})));
const salesSnapshot = {
  rank30d: [{ productId: "p1", units: 5 }],
  rank60d: [{ productId: "p1", units: 8 }],
  shuffleSeed: "service-split",
};
const shelves = buildKitshopShelves(mappedProducts, { homepageSections: sections, salesSnapshot });
assert.deepEqual(shelves[0].items.map((item) => item.productId), ["p2", "p1"], "homepage shelf order should be stable");
assert.equal(shelves[0].title, "Home shelf", "homepage HTML should be stripped from the title");
assert.equal(shelves.length, 2, "kitshop should keep exactly one homepage shelf and Best Sellers");
assert.equal(shelves[0].key, "homepage:home", "kitshop should skip an earlier homepage section that has no cached public products");
assert.equal(shelves[1].key, "best_sellers");
assert.deepEqual(shelves[1].items.map((item) => item.productId), ["p3"], "later homepage sections should feed fallback ranking without becoming visible shelves");

const noDuplicateFallbackShelves = buildKitshopShelves(mappedProducts.slice(0, 2), {
  homepageSections: sections.slice(1, 2),
  salesSnapshot,
});
assert.equal(noDuplicateFallbackShelves.length, 2);
assert.deepEqual(noDuplicateFallbackShelves[0].items.map((item) => item.productId), ["p2", "p1"]);
assert.deepEqual(noDuplicateFallbackShelves[1].items, [], "Best Sellers should stay empty instead of duplicating the entire first shelf");
assert.equal(latestKitshopSyncedAt(mappedProducts), "2026-07-13T00:00:00.000Z");
assert.equal(needsKitshopRefresh(mappedProducts, new Date("2026-07-13T01:00:00.000Z"), 4 * 60 * 60 * 1000), false);
assert.equal(needsKitshopRefresh(mappedProducts, new Date("2026-07-13T05:00:00.001Z"), 4 * 60 * 60 * 1000), true);
assert.equal(resolvePublicStorefrontUrl(mappedProducts), "https://store.example");
assert.equal(shouldReplaceStorefrontUrl("https://footballkituk.com"), false, "trusted custom storefront URL should be preserved");
assert.equal(shouldReplaceStorefrontUrl("https://example.myshopify.com"), true, "Shopify fallback URL should be replaced");

const rankedRows = mapCachedProducts(normalizeCacheProducts(site, Array.from({ length: 18 }, (_, index) => ({
  id: `ranked_${index + 1}`,
  name: `Ranked Shirt ${index + 1}`,
  url: `https://store.example/products/ranked-${index + 1}`,
}))).map((row) => ({
  id: row.id,
  site_id: row.siteId,
  site_slug: row.siteSlug,
  external_product_key: row.externalProductKey,
  product_title: row.productTitle,
  product_url: row.productUrl,
  product_payload_json: JSON.stringify(row.payload),
  last_synced_at: "2026-07-13T00:00:00.000Z",
})));
const rankedShelves = buildKitshopShelves(rankedRows, {
  salesSnapshot: {
    rank30d: Array.from({ length: 10 }, (_, index) => ({ productId: `ranked_${18 - index}`, units: 20 - index })),
    rank60d: Array.from({ length: 10 }, (_, index) => ({ productId: `ranked_${18 - index}`, units: 40 - index })),
    shuffleSeed: "ranked-split",
  },
});
assert.equal(rankedShelves[0].items.length, 8, "recommended shelf should keep the eight-product limit");
assert.equal(rankedShelves[1].items.length, 10, "Best Sellers should include five 30-day winners plus five distinct 60-day winners when eligible");
assert.deepEqual(new Set(rankedShelves[1].items.map((item) => item.productId)), new Set([
  "ranked_18", "ranked_17", "ranked_16", "ranked_15", "ranked_14",
  "ranked_13", "ranked_12", "ranked_11", "ranked_10", "ranked_9",
]));

const mixedRows = mapCachedProducts(normalizeCacheProducts(site, Array.from({ length: 22 }, (_, index) => ({
  id: `mixed_${index + 1}`,
  name: `Mixed Shirt ${index + 1}`,
  url: `https://store.example/products/mixed-${index + 1}`,
}))).map((row) => ({
  id: row.id,
  site_id: row.siteId,
  site_slug: row.siteSlug,
  external_product_key: row.externalProductKey,
  product_title: row.productTitle,
  product_url: row.productUrl,
  product_payload_json: JSON.stringify(row.payload),
  last_synced_at: "2026-07-14T00:00:00.000Z",
})));
const mixedShelves = buildKitshopShelves(mixedRows, {
  homepageSections: [
    { sectionKey: "primary", title: "Primary", productKeys: ["mixed_1", "mixed_2"] },
    { sectionKey: "remaining", title: "Remaining", productKeys: Array.from({ length: 10 }, (_, index) => `mixed_${index + 13}`) },
  ],
  salesSnapshot: {
    rank30d: ["mixed_1", "mixed_3", "mixed_4", "mixed_5", "mixed_6", "mixed_7"].map((productId, index) => ({ productId, units: 30 - index })),
    rank60d: Array.from({ length: 11 }, (_, index) => ({ productId: `mixed_${index + 3}`, units: 60 - index })),
    shuffleSeed: "mixed-fifteen",
  },
});
const mixedBestSellerIds = mixedShelves[1].items.map((item) => item.productId);
assert.equal(mixedBestSellerIds.length, 15, "Best Sellers should fill to fifteen products when enough unique public candidates exist");
assert.equal(new Set(mixedBestSellerIds).size, 15, "all fifteen Best Sellers must be unique");
assert.ok(!mixedBestSellerIds.includes("mixed_1") && !mixedBestSellerIds.includes("mixed_2"), "Best Sellers must not duplicate the first shelf");
for (const productId of ["mixed_3", "mixed_4", "mixed_5", "mixed_6", "mixed_7"]) assert.ok(mixedBestSellerIds.includes(productId));
for (const productId of ["mixed_8", "mixed_9", "mixed_10", "mixed_11", "mixed_12"]) assert.ok(mixedBestSellerIds.includes(productId));
assert.equal(mixedBestSellerIds.filter((productId) => Number(productId.split("_")[1]) >= 13).length, 5, "the remaining five slots should come from later homepage sections");

console.log("kitshop service split self-check passed");
