import { buildProductSearchIntent } from "./product-intent-service.js";
import { acquireDedicatedDbAdvisoryLock } from "./db-advisory-lock-service.js";
import { normalizeCurrency } from "./product-normalizer.js";
import { fetchProductSummary, fetchTtmallHomepageProductSections, isTtmallProductSource } from "./product-source-service.js";
import { isShopifyAdminProductSource } from "./product-source-shopify-admin-service.js";
import { isInternalDemoProductApi, mapProductSearchSite, resolveSearchSite } from "./product-search-site-service.js";
import { fetchShopifyHomepageProductSections } from "./shopify-homepage-section-service.js";
import { fetchShopifyOrderSalesSnapshot } from "./shopify-order-sales-service.js";
import {
  getKitshopSalesSnapshot,
  listActiveHomepageSectionRows,
  listCachedProductRows,
  markKitshopSalesSnapshotFailed,
  upsertKitshopSalesSnapshot,
  upsertHomeProductSectionRows,
  upsertProductCacheRows,
} from "./kitshop-repository.js";
import {
  buildKitshopShelves,
  buildPreservedSalesProducts,
  latestKitshopSyncedAt,
  mapActiveHomepageSections,
  mapCachedProducts,
  needsKitshopRefresh,
  normalizeCacheProducts,
  normalizeHomeProductSections,
  resolvePublicStorefrontUrl,
  shouldReplaceStorefrontUrl,
  uniqueProducts,
} from "./kitshop-shelf-builder.js";
export const KITSHOP_CACHE_TTL_MS = 4 * 60 * 60 * 1000;
const KITSHOP_FETCH_LIMIT = 16;
const KITSHOP_QUERY = "football shirt";
export async function getKitshopShelves({ siteSlug = "", now = new Date(), forceRefresh = false, allowRefresh = true, strictSite = false, fetchProducts = fetchSiteProducts, fetchHomepageSections = fetchSiteHomepageSections, fetchSalesSnapshot = fetchSiteOrderSalesSnapshot, refreshLockTimeoutSeconds = forceRefresh ? 5 : 0 } = {}) {
  const site = await resolveSearchSite(siteSlug, { allowDefault: !strictSite });
  if (!site?.id) {
    return emptyKitshopResponse({ site: null, error: "站点不存在或已停用" });
  }
  let cacheRows = mapCachedProducts(await listCachedProductRows(site.id));
  let refreshed = false;
  let fetchError = "";
  let salesFetchError = "";
  let refreshBusy = false;
  let salesSnapshot = await getKitshopSalesSnapshot(site.id);
  const cacheNeedsRefresh = needsKitshopRefresh(cacheRows, now, KITSHOP_CACHE_TTL_MS);
  const shouldRefresh = allowRefresh && (Boolean(forceRefresh) || cacheNeedsRefresh);
  if (shouldRefresh && site.product_api_url && !isInternalDemoProductApi(site.product_api_url)) {
    let releaseRefreshLock = null;
    try {
      releaseRefreshLock = await acquireDedicatedDbAdvisoryLock(`kitshop_refresh:${site.id}`, refreshLockTimeoutSeconds);
      const refreshPayload = await loadRefreshProducts(site, { fetchProducts, fetchHomepageSections });
      let freshSalesSnapshot = null;
      if (isShopifyAdminProductSource(site.product_api_url)) {
        try {
          freshSalesSnapshot = await fetchSalesSnapshot(site, { now });
        } catch (error) {
          salesFetchError = error?.message || "Shopify 销量读取失败";
          console.warn(`[aiove] Kitshop sales refresh failed for site ${site.id || site.slug || "unknown"}`);
          await markKitshopSalesSnapshotFailed(site, now);
          salesSnapshot = await getKitshopSalesSnapshot(site.id);
        }
      }
      if (refreshPayload.homepageReadOk) {
        const sectionRows = normalizeHomeProductSections(site, refreshPayload.homepageSections);
        await upsertHomeProductSectionRows(site.id, sectionRows, now);
      }
      const refreshedProducts = uniqueProducts([
        ...refreshPayload.products,
        ...(Array.isArray(freshSalesSnapshot?.products) ? freshSalesSnapshot.products : []),
        ...(salesFetchError ? buildPreservedSalesProducts(cacheRows, salesSnapshot) : []),
      ]);
      if (refreshedProducts.length) {
        const productRows = normalizeCacheProducts(site, refreshedProducts);
        await upsertProductCacheRows(site.id, productRows, now);
        cacheRows = mapCachedProducts(await listCachedProductRows(site.id));
        refreshed = true;
      } else {
        fetchError = "商品源未返回可公开商品";
      }
      if (freshSalesSnapshot) {
        try {
          await upsertKitshopSalesSnapshot(site, freshSalesSnapshot, now);
        } catch (error) {
          salesFetchError = error?.message || "Shopify 销量快照保存失败";
          console.warn(`[aiove] Kitshop sales snapshot write failed for site ${site.id || site.slug || "unknown"}`);
          await markKitshopSalesSnapshotFailed(site, now);
        }
        salesSnapshot = await getKitshopSalesSnapshot(site.id);
      }
    } catch (error) {
      if (Number(error?.statusCode || 0) === 429) refreshBusy = true;
      else fetchError = error?.message || "商品源读取失败";
    } finally {
      if (releaseRefreshLock) await releaseRefreshLock();
    }
  }
  const stale = (allowRefresh ? shouldRefresh && !refreshed : cacheNeedsRefresh) && cacheRows.length > 0;
  const lastSyncedAt = latestKitshopSyncedAt(cacheRows);
  const homepageSections = mapActiveHomepageSections(await listActiveHomepageSectionRows(site.id));
  const shelves = buildKitshopShelves(cacheRows, { homepageSections, salesSnapshot });
  const mappedSite = mapProductSearchSite(site);
  const publicStorefrontUrl = resolvePublicStorefrontUrl(cacheRows);
  if (mappedSite && publicStorefrontUrl) {
    if (shouldReplaceStorefrontUrl(mappedSite.siteUrl)) mappedSite.siteUrl = publicStorefrontUrl;
    if (shouldReplaceStorefrontUrl(mappedSite.storefrontUrl)) mappedSite.storefrontUrl = publicStorefrontUrl;
  }
  const response = {
    ok: true,
    site: mappedSite,
    shelves,
    cache: {
      refreshed,
      stale,
      lastSyncedAt,
      needsRefresh: cacheNeedsRefresh,
      canRefresh: Boolean(site.product_api_url && !isInternalDemoProductApi(site.product_api_url)),
      salesLastSyncedAt: salesSnapshot?.generatedAt || "",
      salesStatus: salesSnapshot?.syncStatus || (salesSnapshot ? "ready" : "unavailable"),
    },
  };
  if (!site.product_api_url || isInternalDemoProductApi(site.product_api_url)) {
    response.error = cacheRows.length ? "" : "当前站点还没有配置商品源";
  } else if (fetchError && !cacheRows.length) {
    response.error = "商品源暂时不可用";
  } else if (fetchError) {
    response.warning = "商品源暂时不可用，已显示最近缓存";
  } else if (refreshBusy) {
    response.warning = "商品缓存正在刷新，已显示最近缓存";
  } else if (salesFetchError || salesSnapshot?.syncStatus === "stale") {
    response.adminWarning = salesSnapshot?.generatedAt
      ? "销量数据暂时不可用，已显示最近销量缓存"
      : "销量数据暂时不可用，已使用首页其他公开商品";
  }
  return response;
}
async function fetchSiteProducts(site = {}) {
  const searchIntent = buildProductSearchIntent(KITSHOP_QUERY, "");
  return fetchProductSummary(site.product_api_url, searchIntent, {
    currency: normalizeCurrency(site.currency),
    encryptedAccessToken: site.product_access_token_encrypted,
    maxProducts: KITSHOP_FETCH_LIMIT,
  });
}
async function fetchSiteHomepageSections(site = {}) {
  if (isTtmallProductSource(site.product_api_url)) {
    return fetchTtmallHomepageProductSections(site);
  }
  return fetchShopifyHomepageProductSections(site);
}
async function fetchSiteOrderSalesSnapshot(site = {}, options = {}) {
  return fetchShopifyOrderSalesSnapshot(site, options);
}
async function loadRefreshProducts(site = {}, { fetchProducts, fetchHomepageSections } = {}) {
  const homepageSections = await fetchHomepageSections(site);
  const homepageReadOk = Array.isArray(homepageSections);
  if (!homepageReadOk) {
    throw new Error("商品源首页货架读取失败");
  }
  const homepageProducts = homepageSections.flatMap((section) => Array.isArray(section.products) ? section.products : []);
  const sourceProducts = await fetchProducts(site);
  return {
    homepageReadOk,
    homepageSections,
    products: uniqueProducts([...homepageProducts, ...sourceProducts]),
  };
}

function emptyKitshopResponse({ site = null, error = "" } = {}) {
  return {
    ok: true,
    site,
    shelves: [
      { key: "recommended", title: "Recommended", items: [] },
      { key: "best_sellers", title: "Best Sellers", items: [] },
    ],
    cache: { refreshed: false, stale: false, needsRefresh: false, canRefresh: false, lastSyncedAt: "" },
    error,
  };
}
