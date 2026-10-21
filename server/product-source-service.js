import { SERVER_CONFIG } from "./config.js";
import {
  buildProductApiUrl,
  fetchHttpProducts,
  isBlockedProductAdminUrl,
} from "./product-source-http-service.js";
import {
  buildShopifyAdminStorefrontUrl,
  fetchShopifyAdminProducts,
  isShopifyAdminProductSource,
} from "./product-source-shopify-admin-service.js";
import {
  buildShopifySearchUrl,
  fetchShopifyPublicProducts,
  fetchShopifySearchPageProducts,
  isShopifyPublicProductSource,
} from "./product-source-shopify-public-service.js";
import {
  buildTtmallStorefrontUrl,
  extractTtmallProductId,
  fetchTtmallHomepageProductSections,
  fetchTtmallProductById,
  fetchTtmallProducts,
  isTtmallProductSource,
  parseTtmallProductSource,
} from "./product-source-ttmall-service.js";

export {
  buildProductApiUrl,
  buildShopifyAdminStorefrontUrl,
  buildShopifySearchUrl,
  fetchShopifySearchPageProducts,
  isBlockedProductAdminUrl,
  isShopifyAdminProductSource,
  isShopifyPublicProductSource,
  buildTtmallStorefrontUrl,
  extractTtmallProductId,
  fetchTtmallHomepageProductSections,
  fetchTtmallProductById,
  isTtmallProductSource,
  parseTtmallProductSource,
};

export function resolvePublicProductSourceUrl(productApiUrl = "") {
  if (isShopifyAdminProductSource(productApiUrl)) {
    return buildShopifyAdminStorefrontUrl(productApiUrl);
  }
  if (isTtmallProductSource(productApiUrl)) return "";
  return productApiUrl;
}

export async function fetchProductSummary(productApiUrl, searchIntent = {}, options = {}) {
  const { currency = "", marketCountryCode = "", timeoutMs = null, encryptedAccessToken = "", maxProducts, throwOnError = false } = options;
  const resolvedTimeoutMs = Number(timeoutMs) > 0 ? Number(timeoutMs) : isTtmallProductSource(productApiUrl) ? SERVER_CONFIG.productApi.ttmallTimeoutMs : SERVER_CONFIG.productApi.timeoutMs;
  if (isTtmallProductSource(productApiUrl)) {
    return fetchTtmallProducts(productApiUrl, searchIntent, { currency, timeoutMs: resolvedTimeoutMs, maxProducts, throwOnError });
  }
  if (isShopifyAdminProductSource(productApiUrl)) {
    return fetchShopifyAdminProducts(productApiUrl, searchIntent, { currency, marketCountryCode, timeoutMs: resolvedTimeoutMs, encryptedAccessToken, maxProducts, throwOnError });
  }
  if (isBlockedProductAdminUrl(productApiUrl)) {
    console.warn("[aiove] product API rejected because it is not a read-only product view");
    return [];
  }
  if (isShopifyPublicProductSource(productApiUrl)) {
    return fetchShopifyPublicProducts(productApiUrl, searchIntent, { currency, timeoutMs: resolvedTimeoutMs, maxProducts, throwOnError });
  }
  return fetchHttpProducts(productApiUrl, searchIntent, { currency, timeoutMs: resolvedTimeoutMs, maxProducts, throwOnError });
}
