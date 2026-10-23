import { transferAlternativeSearch } from './product-alternative-service.js';
import { normalizeProductSourceError, PRODUCT_SOURCE_ERROR_CODE } from "./product-source-error-service.js";
import { buildProductSearchIntent } from "./product-intent-service.js";
import { normalizeCurrency } from "./product-normalizer.js";
import { DEFAULT_PRODUCT_SEARCH_LIMIT } from "./product-search-constants.js";
import { executeProductSearch, executeProductSearchDetailed } from "./product-search-execution-service.js";
import {
  PRODUCT_SEARCH_STATE,
  resolveProductSearchState,
} from "./product-search-decision-service.js";
import { isInternalDemoProductApi, mapProductSearchSite, resolveSearchSite } from "./product-search-site-service.js";
import { markServerProductOrigins } from "./product-source-provenance.js";
import { isShopifyAdminProductSource, isShopifyPublicProductSource, isTtmallProductSource } from "./product-source-service.js";

export async function searchSiteProducts({ siteSlug = "", query = "", limit = DEFAULT_PRODUCT_SEARCH_LIMIT, strictSite = false, searchIntent: searchIntentOverride = null, allowNearestAgeFallback = false, allowCandidateSearch = false } = {}) {
  const normalizedQuery = safeString(query);
  const normalizedLimit = Math.max(1, Math.min(10, Number(limit) || DEFAULT_PRODUCT_SEARCH_LIMIT));
  if (!normalizedQuery) {
    return {
      ok: true,
      items: [],
      site: null,
      query: "",
      searchState: PRODUCT_SEARCH_STATE.NOT_PRODUCT,
      searchOutcome: "no_match",
    };
  }

  const site = await resolveSearchSite(siteSlug, { allowDefault: !strictSite });
  const productApiUrl = site?.product_api_url || "";
  if (!productApiUrl || isInternalDemoProductApi(productApiUrl)) {
    return {
      ok: true,
      items: [],
      site: mapProductSearchSite(site),
      query: normalizedQuery,
      searchState: PRODUCT_SEARCH_STATE.SOURCE_ERROR,
      searchOutcome: "source_error",
      sourceErrorCode: PRODUCT_SOURCE_ERROR_CODE.SOURCE_UNCONFIGURED,
    };
  }

  const siteCurrency = normalizeCurrency(site.currency);
  const mappedSite = mapProductSearchSite(site);
  const originalSearchIntent = searchIntentOverride && typeof searchIntentOverride === "object"
    ? searchIntentOverride
    : buildProductSearchIntent(normalizedQuery, "");
  const searchState = safeString(originalSearchIntent.searchState) || PRODUCT_SEARCH_STATE.READY;
  if (searchState === PRODUCT_SEARCH_STATE.NEEDS_CLARIFICATION || searchState === PRODUCT_SEARCH_STATE.CLARIFICATION_EXHAUSTED) {
    return {
      ok: true,
      query: normalizedQuery,
      site: mappedSite,
      items: [],
      searchState,
      searchOutcome: "needs_clarification",
    };
  }
  let products = [];
  let detailedResult = null;
  try {
    const options = {
      productApiUrl,
      query: normalizedQuery,
      currency: siteCurrency,
      encryptedAccessToken: site.product_access_token_encrypted,
      limit: normalizedLimit,
      searchIntent: originalSearchIntent,
      allowNearestAgeFallback,
    };
    if (allowCandidateSearch) {
      const detailed = await executeProductSearchDetailed(options);
      detailedResult = detailed;
      products = detailed.matches.length ? detailed.matches : detailed.candidates.length ? detailed.candidates : (detailed.alternatives || []);
    } else products = await executeProductSearch(options);
  } catch (error) {
    const sourceError = normalizeProductSourceError(error, {
      provider: isShopifyAdminProductSource(productApiUrl) || isShopifyPublicProductSource(productApiUrl) ? "shopify" : isTtmallProductSource(productApiUrl) ? "ttmall" : "http",
    });
    console.warn("[aiove] public product search source unavailable", sourceError);
    return {
      ok: true,
      query: normalizedQuery,
      site: mappedSite,
      items: [],
      searchState: PRODUCT_SEARCH_STATE.SOURCE_ERROR,
      searchOutcome: "source_error",
      sourceErrorCode: sourceError.code,
      sourceErrorProvider: sourceError.provider,
      sourceErrorStatus: sourceError.statusCode,
    };
  }

  return transferAlternativeSearch(detailedResult, markServerProductOrigins({
    ok: true,
    query: normalizedQuery,
    site: mappedSite,
    searchState,
    searchOutcome: products.some(product => product.matchStatus === "alternative") ? "alternative" : products.some(product => product.matchStatus === "candidate") ? "candidate" : resolveProductSearchState(originalSearchIntent, products).status,
    items: products.map((product, index) => ({
      ...product,
      paymentMethods: mappedSite?.paymentMethods || [],
      analytics: {
        productName: product.name || "",
        productUrl: product.url || "",
        siteId: site.id || "",
        siteSlug: site.slug || "",
        siteName: site.name || "",
        position: index + 1,
      },
    })),
  }, products));
}

function safeString(value) {
  return String(value == null ? "" : value).trim();
}
