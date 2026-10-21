import assert from "node:assert/strict";
import { initializeDatabase, getDbPool, closeDbPool } from "../server/db.js";
import { closeDbAdvisoryLockPool } from "../server/db-advisory-lock-service.js";
import { getKitshopShelves } from "../server/kitshop-service.js";
import { getKitshopSalesSnapshot, upsertKitshopSalesSnapshot } from "../server/kitshop-repository.js";
import { normalizeVisibleShopifyHomepageProducts } from "../server/shopify-homepage-section-service.js";

const siteId = "site_kitshop_self_check";
const siteSlug = "kitshop-self-check";
const emptySiteId = "site_kitshop_empty_self_check";
const emptySiteSlug = "kitshop-empty-self-check";
const salesSiteId = "site_kitshop_sales_self_check";
const salesSiteSlug = "kitshop-sales-self-check";

async function main() {
  process.env.NODE_ENV = "test";
  assertVisibleHomepageProducts();
  await initializeDatabase();
  await cleanup();
  try {
    await seedSites();

    let fetchCount = 0;
    const baseNow = new Date();
    await upsertKitshopSalesSnapshot({ id: siteId, slug: siteSlug }, {
      rank30d: [{ productId: "prod_third", units: 9 }],
      rank60d: [{ productId: "prod_away", units: 11 }, { productId: "prod_third", units: 9 }],
      shuffleSeed: "cache-self-check",
      includedOrderCount: 4,
    }, baseNow);
    const result = await getKitshopShelves({
      siteSlug,
      now: baseNow,
      fetchProducts: async () => {
        fetchCount += 1;
        return mockProducts();
      },
      fetchHomepageSections: async () => mockHomepageSections(),
    });
    assert.equal(result.ok, true);
    assert.equal(result.cache.refreshed, true);
    assert.ok(result.cache.salesLastSyncedAt);
    assert.equal(fetchCount, 1);
    assert.equal(result.site.siteUrl, "https://store.example", "kitshop should derive the public storefront from a trusted product URL");
    assert.equal(result.site.storefrontUrl, "https://store.example", "kitshop should replace the Shopify Admin storefront fallback with the verified public storefront");
    assert.equal(result.shelves.length, 2, "kitshop should expose one homepage shelf plus Best Sellers");
    assert.equal(result.shelves[0].key, "homepage:featured_collection_self_check");
    assert.equal(result.shelves[0].title, "Homepage kits");
    assert.equal(result.shelves[0].items.length, 2);
    assert.equal(result.shelves[0].items[0].siteSlug, siteSlug);
    assert.equal(result.shelves[0].items[0].productId, "prod_away");
    assert.deepEqual(result.shelves[0].items.map((item) => item.productId), ["prod_away", "prod_home"]);
    assert.equal(result.shelves[0].items[1].priceNow, "£59.99");
    assert.ok(Array.isArray(result.shelves[0].items[0].sizes));
    assert.equal(result.shelves[1].key, "best_sellers");
    assert.deepEqual(result.shelves[1].items.map((item) => item.productId), ["prod_third"], "later homepage products may feed Best Sellers but must not create extra homepage shelves");
    const storedSales = await getKitshopSalesSnapshot(siteId);
    assert.equal(storedSales.includedOrderCount, 4);
    assert.deepEqual(storedSales.rank30d.map((item) => item.productId), ["prod_third"]);

    const [cachedRows] = await getDbPool().execute(
      "SELECT product_title, product_payload_json FROM site_product_cache WHERE site_id = ? ORDER BY source_rank",
      [siteId]
    );
    assert.equal(cachedRows.length, 3);
    assert.equal(readJson(cachedRows[0].product_payload_json).name, "Away Kit");
    const [homeSectionRows] = await getDbPool().execute(
      "SELECT section_key, section_status, product_keys_json FROM site_home_product_sections WHERE site_id = ? ORDER BY source_rank",
      [siteId]
    );
    assert.equal(homeSectionRows.length, 2);
    assert.equal(homeSectionRows[0].section_key, "featured_collection_self_check");
    assert.equal(homeSectionRows[0].section_status, "active");
    assert.deepEqual(readJson(homeSectionRows[0].product_keys_json), ["prod_away", "prod_home"]);

    const cachedResult = await getKitshopShelves({
      siteSlug,
      now: new Date(baseNow.getTime() + 10 * 60 * 1000),
      fetchProducts: async () => {
        throw new Error("fresh cache should not refresh");
      },
    });
    assert.equal(cachedResult.cache.refreshed, false);
    assert.equal(cachedResult.cache.stale, false);
    assert.equal(cachedResult.shelves.length, 2, "fresh cache reads should preserve the two-shelf contract");
    assert.equal(cachedResult.shelves[0].key, "homepage:featured_collection_self_check");
    assert.equal(cachedResult.shelves[1].key, "best_sellers");

    let disabledRefreshCalls = 0;
    const refreshDisabledResult = await getKitshopShelves({
      siteSlug,
      now: new Date(baseNow.getTime() + 10 * 60 * 1000),
      forceRefresh: true,
      allowRefresh: false,
      fetchProducts: async () => {
        disabledRefreshCalls += 1;
        return mockProducts();
      },
      fetchHomepageSections: async () => {
        disabledRefreshCalls += 1;
        return mockHomepageSections();
      },
    });
    assert.equal(disabledRefreshCalls, 0, "allowRefresh=false should block even a forced source refresh");
    assert.equal(refreshDisabledResult.cache.refreshed, false);

    let forcedRefreshCalls = 0;
    const forcedRefreshResult = await getKitshopShelves({
      siteSlug,
      now: new Date(baseNow.getTime() + 10 * 60 * 1000),
      forceRefresh: true,
      fetchProducts: async () => {
        forcedRefreshCalls += 1;
        return mockProducts();
      },
      fetchHomepageSections: async () => {
        forcedRefreshCalls += 1;
        return mockHomepageSections();
      },
    });
    assert.equal(forcedRefreshCalls, 2, "forceRefresh should bypass a fresh cache when refresh is allowed");
    assert.equal(forcedRefreshResult.cache.refreshed, true);
    assert.equal(forcedRefreshResult.shelves.length, 2, "forced admin-style refreshes should preserve the two-shelf contract");
    assert.equal(forcedRefreshResult.shelves[0].key, "homepage:featured_collection_self_check");
    assert.equal(forcedRefreshResult.shelves[1].key, "best_sellers");

    await getDbPool().execute(
      "UPDATE site_product_cache SET last_synced_at = DATE_SUB(NOW(3), INTERVAL 5 HOUR) WHERE site_id = ?",
      [siteId]
    );
    let fallbackFetchCount = 0;
    const preservedHomepageResult = await getKitshopShelves({
      siteSlug,
      now: new Date(),
      fetchHomepageSections: async () => {
        throw new Error("mock homepage source down");
      },
      fetchProducts: async () => {
        fallbackFetchCount += 1;
        return mockProducts().slice(0, 1);
      },
    });
    assert.equal(preservedHomepageResult.cache.refreshed, false);
    assert.equal(preservedHomepageResult.cache.stale, true);
    assert.equal(preservedHomepageResult.warning, "商品源暂时不可用，已显示最近缓存");
    assert.equal(fallbackFetchCount, 0, "homepage failure must not replace the verified homepage cache with generic search results");
    assert.deepEqual(
      preservedHomepageResult.shelves.slice(0, 2).map((shelf) => shelf.items.map((item) => item.productId)),
      [["prod_away", "prod_home"], ["prod_third"]]
    );
    const [preservedStatusRows] = await getDbPool().execute(
      "SELECT external_product_key, cached_status FROM site_product_cache WHERE site_id = ? ORDER BY external_product_key",
      [siteId]
    );
    assert.deepEqual(
      preservedStatusRows.map((row) => `${row.external_product_key}:${row.cached_status}`),
      ["prod_away:active", "prod_home:active", "prod_third:active"]
    );

    const prunedResult = await getKitshopShelves({
      siteSlug,
      now: new Date(),
      fetchProducts: async () => mockProducts().slice(0, 1),
      fetchHomepageSections: async () => [],
    });
    assert.equal(prunedResult.cache.refreshed, true);
    assert.equal(prunedResult.shelves[0].items.length, 1);
    assert.equal(prunedResult.shelves[0].items[0].productId, "prod_home");
    const [statusRows] = await getDbPool().execute(
      "SELECT external_product_key, cached_status FROM site_product_cache WHERE site_id = ? ORDER BY external_product_key",
      [siteId]
    );
    assert.deepEqual(
      statusRows.map((row) => `${row.external_product_key}:${row.cached_status}`),
      ["prod_away:inactive", "prod_home:active", "prod_third:inactive"]
    );
    const [[inactiveHomeSection]] = await getDbPool().execute(
      "SELECT section_status FROM site_home_product_sections WHERE site_id = ? AND section_key = ? LIMIT 1",
      [siteId, "featured_collection_self_check"]
    );
    assert.equal(inactiveHomeSection.section_status, "inactive");

    await getDbPool().execute(
      "UPDATE site_product_cache SET last_synced_at = DATE_SUB(NOW(3), INTERVAL 5 HOUR) WHERE site_id = ?",
      [siteId]
    );
    const staleResult = await getKitshopShelves({
      siteSlug,
      now: new Date(),
      fetchProducts: async () => {
        throw new Error("mock source down");
      },
    });
    assert.equal(staleResult.cache.refreshed, false);
    assert.equal(staleResult.cache.stale, true);
    assert.equal(staleResult.warning, "商品源暂时不可用，已显示最近缓存");
    assert.equal(staleResult.shelves[0].items.length, 1);

    await getDbPool().execute("DELETE FROM site_product_cache WHERE site_id = ?", [siteId]);
    const failedNoCache = await getKitshopShelves({
      siteSlug,
      now: new Date(),
      fetchProducts: async () => {
        throw new Error("mock source down");
      },
    });
    assert.equal(failedNoCache.error, "商品源暂时不可用");
    assert.equal(failedNoCache.shelves[0].items.length, 0);

    const emptySource = await getKitshopShelves({ siteSlug: emptySiteSlug });
    assert.equal(emptySource.error, "当前站点还没有配置商品源");
    assert.equal(emptySource.shelves[0].items.length, 0);

    const salesNow = new Date();
    const emptySalesCache = await getKitshopShelves({
      siteSlug: salesSiteSlug,
      now: salesNow,
      allowRefresh: false,
    });
    assert.equal(emptySalesCache.cache.needsRefresh, true, "an empty configured site should request its first background refresh");
    assert.equal(emptySalesCache.cache.canRefresh, true);

    const firstSalesFailure = await getKitshopShelves({
      siteSlug: salesSiteSlug,
      now: salesNow,
      forceRefresh: true,
      fetchProducts: async () => mockProducts(),
      fetchHomepageSections: async () => mockHomepageSections(),
      fetchSalesSnapshot: async () => {
        throw new Error("mock first order source failure");
      },
    });
    assert.equal(firstSalesFailure.cache.salesStatus, "stale");
    assert.equal(firstSalesFailure.cache.salesLastSyncedAt, "");
    const firstFailureSnapshot = await getKitshopSalesSnapshot(salesSiteId);
    assert.equal(firstFailureSnapshot.syncStatus, "stale", "the first failed sales attempt should be persisted");
    assert.ok(firstFailureSnapshot.lastAttemptAt);

    const salesRefresh = await getKitshopShelves({
      siteSlug: salesSiteSlug,
      now: salesNow,
      forceRefresh: true,
      fetchProducts: async () => mockProducts(),
      fetchHomepageSections: async () => mockHomepageSections(),
      fetchSalesSnapshot: async () => ({
        rank30d: [{ productId: "prod_sales_only", units: 7 }],
        rank60d: [{ productId: "prod_home", units: 9 }, { productId: "prod_sales_only", units: 7 }, { productId: "prod_third", units: 6 }],
        products: [mockSalesOnlyProduct()],
        shuffleSeed: "sales-refresh-self-check",
        includedOrderCount: 3,
      }),
    });
    assert.equal(salesRefresh.warning, undefined);
    assert.equal(salesRefresh.cache.salesStatus, "ready");
    assert.ok(salesRefresh.cache.salesLastSyncedAt);
    assert.deepEqual(
      new Set(salesRefresh.shelves[1].items.map((item) => item.productId)),
      new Set(["prod_sales_only", "prod_third"]),
      "sales-only products and the remaining homepage products should both be eligible"
    );

    const preservedSalesRefresh = await getKitshopShelves({
      siteSlug: salesSiteSlug,
      now: new Date(salesNow.getTime() + 60 * 1000),
      forceRefresh: true,
      fetchProducts: async () => mockProducts(),
      fetchHomepageSections: async () => mockHomepageSections(),
      fetchSalesSnapshot: async () => {
        throw new Error("mock order source down");
      },
    });
    assert.equal(preservedSalesRefresh.warning, undefined);
    assert.equal(preservedSalesRefresh.adminWarning, "销量数据暂时不可用，已显示最近销量缓存");
    assert.equal(preservedSalesRefresh.cache.salesLastSyncedAt, salesRefresh.cache.salesLastSyncedAt);
    assert.equal(preservedSalesRefresh.cache.salesStatus, "stale");
    assert.deepEqual(
      new Set(preservedSalesRefresh.shelves[1].items.map((item) => item.productId)),
      new Set(["prod_sales_only", "prod_third"]),
      "a failed order refresh must preserve the previous sales-only cached product"
    );
    const [salesOnlyRows] = await getDbPool().execute(
      "SELECT cached_status FROM site_product_cache WHERE site_id = ? AND external_product_key = ?",
      [salesSiteId, "prod_sales_only"]
    );
    assert.equal(salesOnlyRows[0]?.cached_status, "active");
    const [storedSalesRows] = await getDbPool().execute(
      "SELECT rank_30d_json FROM site_kitshop_sales_cache WHERE site_id = ?",
      [salesSiteId]
    );
    assert.ok(!JSON.stringify(readJson(storedSalesRows[0].rank_30d_json)).includes("lastSoldAt"));

    let concurrentSalesFetches = 0;
    const concurrentOptions = {
      siteSlug: salesSiteSlug,
      now: new Date(salesNow.getTime() + 2 * 60 * 1000),
      forceRefresh: true,
      refreshLockTimeoutSeconds: 0,
      fetchProducts: async () => mockProducts(),
      fetchHomepageSections: async () => mockHomepageSections(),
      fetchSalesSnapshot: async () => {
        concurrentSalesFetches += 1;
        await new Promise((resolve) => setTimeout(resolve, 75));
        return {
          rank30d: [{ productId: "prod_sales_only", units: 8 }],
          rank60d: [{ productId: "prod_third", units: 9 }, { productId: "prod_sales_only", units: 8 }],
          products: [mockSalesOnlyProduct()],
          shuffleSeed: "sales-concurrency-self-check",
          includedOrderCount: 4,
        };
      },
    };
    const concurrentResults = await Promise.all([
      getKitshopShelves(concurrentOptions),
      getKitshopShelves(concurrentOptions),
    ]);
    assert.equal(concurrentSalesFetches, 1, "the per-site database lock must prevent duplicate order refreshes");
    assert.equal(concurrentResults.filter((item) => item.cache.refreshed).length, 1);
    assert.equal(concurrentResults.filter((item) => item.warning === "商品缓存正在刷新，已显示最近缓存").length, 1);

    console.log("kitshop cache self-check passed");
  } finally {
    await cleanup();
    await closeDbPool();
    await closeDbAdvisoryLockPool();
  }
}

async function seedSites() {
  await getDbPool().execute(
    `INSERT INTO sites (
       id, name, slug, site_url, default_language, currency, time_zone,
       site_status, is_default, mascot_character_id, product_api_url, description
     ) VALUES (?, 'Kitshop Self Check', ?, '', 'English', 'GBP', 'UTC', 'active', 0, NULL, 'https://kitshop-self-check.myshopify.com/admin/api/2026-04/graphql.json', 'Temporary self-check site.')
     ON DUPLICATE KEY UPDATE product_api_url = VALUES(product_api_url), site_status = 'active'`,
    [siteId, siteSlug]
  );
  await getDbPool().execute(
    `INSERT INTO sites (
       id, name, slug, site_url, default_language, currency, time_zone,
       site_status, is_default, mascot_character_id, product_api_url, description
     ) VALUES (?, 'Kitshop Empty Self Check', ?, '', 'English', 'GBP', 'UTC', 'active', 0, NULL, '', 'Temporary empty self-check site.')
     ON DUPLICATE KEY UPDATE product_api_url = '', site_status = 'active'`,
    [emptySiteId, emptySiteSlug]
  );
  await getDbPool().execute(
    `INSERT INTO sites (
       id, name, slug, site_url, default_language, currency, time_zone,
       site_status, is_default, mascot_character_id, product_api_url, description
     ) VALUES (?, 'Kitshop Sales Self Check', ?, '', 'English', 'GBP', 'UTC', 'active', 0, NULL, 'shopify-admin://kitshop-sales-self-check.myshopify.com?version=2026-04', 'Temporary sales self-check site.')
     ON DUPLICATE KEY UPDATE product_api_url = VALUES(product_api_url), site_status = 'active'`,
    [salesSiteId, salesSiteSlug]
  );
}

function mockProducts() {
  return [
    {
      id: "prod_home",
      name: "Home Kit",
      subtitle: "Supporter edition",
      price: "£59.99",
      priceWas: "£89.99",
      url: "https://store.example/products/home-kit",
      imageUrl: "/assets/jersey_product.png",
      imageUrls: ["/assets/jersey_product.png"],
      stock: "Available",
      available: true,
      sizes: [{ label: "M", available: true, buyUrl: "https://store.example/cart/1:1" }],
      features: ["Matchday ready"],
    },
    {
      id: "prod_away",
      name: "Away Kit",
      subtitle: "Player inspired",
      price: "£64.99",
      url: "https://store.example/products/away-kit",
      imageUrl: "/assets/jersey_product.png",
      available: true,
      sizes: [{ label: "L", available: true }],
      features: ["Away colors"],
    },
  ];
}

function mockThirdProduct() {
  return {
    id: "prod_third",
    name: "Third Kit",
    subtitle: "Public homepage product",
    price: "£69.99",
    url: "https://store.example/products/third-kit",
    imageUrl: "/assets/jersey_product.png",
    available: true,
    sizes: [{ label: "S", available: true }],
    features: ["Homepage order"],
  };
}

function mockSalesOnlyProduct() {
  return {
    id: "prod_sales_only",
    name: "Sales Only Kit",
    subtitle: "Resolved from recent orders",
    price: "£74.99",
    url: "https://store.example/products/sales-only-kit",
    imageUrl: "/assets/jersey_product.png",
    available: true,
    sizes: [{ label: "M", available: true }],
    features: ["Recent sales"],
  };
}

async function cleanup() {
  await getDbPool().execute("DELETE FROM site_kitshop_sales_cache WHERE site_id IN (?, ?, ?)", [siteId, emptySiteId, salesSiteId]).catch(() => {});
  await getDbPool().execute("DELETE FROM site_product_cache WHERE site_id IN (?, ?, ?)", [siteId, emptySiteId, salesSiteId]).catch(() => {});
  await getDbPool().execute("DELETE FROM site_home_product_sections WHERE site_id IN (?, ?, ?)", [siteId, emptySiteId, salesSiteId]).catch(() => {});
  await getDbPool().execute("DELETE FROM sites WHERE id IN (?, ?, ?)", [siteId, emptySiteId, salesSiteId]).catch(() => {});
}

function readJson(value) {
  if (value && typeof value === "object") return value;
  return JSON.parse(String(value || "{}"));
}

function mockHomepageSections() {
  return [
    {
      sectionKey: "featured_collection_self_check",
      sectionType: "featured-collection",
      sectionTitle: "Homepage kits",
      collectionHandles: ["homepage-kits"],
      productHandles: [],
      displayOrder: 1,
      themeId: "theme_self_check",
      themeName: "Self Check Theme",
      rawSection: { type: "featured-collection" },
      products: [mockProducts()[1], mockProducts()[0]],
    },
    {
      sectionKey: "featured_collection_second_self_check",
      sectionType: "featured-collection",
      sectionTitle: "<strong>Second shelf</strong>",
      collectionHandles: ["second-shelf"],
      productHandles: [],
      displayOrder: 2,
      themeId: "theme_self_check",
      themeName: "Self Check Theme",
      rawSection: { type: "featured-collection" },
      products: [mockThirdProduct()],
    },
  ];
}

function assertVisibleHomepageProducts() {
  const products = normalizeVisibleShopifyHomepageProducts([
    { node: { id: "draft", title: "Draft product", handle: "draft-product", status: "DRAFT", onlineStoreUrl: null, variants: { edges: [] } } },
    { node: { id: "hidden", title: "Hidden product", handle: "hidden-product", status: "ACTIVE", onlineStoreUrl: null, variants: { edges: [] } } },
    { node: { id: "public", title: "Public product", handle: "public-product", status: "ACTIVE", onlineStoreUrl: "https://store.example/products/public-product", variants: { edges: [] } } },
  ], { currency: "GBP", shopDomain: "store.myshopify.com", limit: 4 });
  assert.deepEqual(products.map((product) => product.name), ["Public product"]);
  assert.equal(products[0].url, "https://store.example/products/public-product");
}

main().catch(async (error) => {
  console.error(error);
  await cleanup().catch(() => {});
  await closeDbPool().catch(() => {});
  await closeDbAdvisoryLockPool().catch(() => {});
  process.exitCode = 1;
});
