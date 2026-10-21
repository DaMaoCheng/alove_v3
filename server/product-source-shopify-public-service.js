import { SERVER_CONFIG } from "./config.js";
import { normalizeShopifySearchProduct } from "./product-normalizer.js";
import { fetchShopifyCustomizationOptions } from "./product-customization-service.js";
import {
  fetchJsonWithTimeout,
  fetchTextWithTimeout,
  MAX_PRODUCTS,
  normalizeProductSourceLimit,
  normalizePathname,
  safeString,
  shopifySearchQuery,
} from "./product-source-shared-service.js";

export function isShopifyPublicProductSource(value) {
  return isShopifyStorefrontUrl(value) || isShopifySearchApiUrl(value);
}

export function buildShopifySearchUrl(storefrontUrl, searchIntent = {}, { maxProducts = MAX_PRODUCTS } = {}) {
  try {
    const source = new URL(storefrontUrl);
    const url = isShopifySearchApiUrl(storefrontUrl)
      ? new URL(storefrontUrl)
      : new URL("/search/suggest.json", source.origin);
    url.searchParams.set("q", shopifySearchQuery(searchIntent.query));
    url.searchParams.set("resources[type]", "product");
    url.searchParams.set("resources[limit]", String(normalizeProductSourceLimit(maxProducts)));
    return url.toString();
  } catch {
    return "";
  }
}

export async function fetchShopifySearchPageProducts(storefrontUrl, searchIntent = {}, { currency = "", timeoutMs = SERVER_CONFIG.productApi.timeoutMs, maxProducts = MAX_PRODUCTS, throwOnError = false } = {}) {
  const limit = normalizeProductSourceLimit(maxProducts);
  const searchUrl = buildShopifyStorefrontSearchUrl(storefrontUrl, searchIntent);
  if (!searchUrl) return [];

  try {
    const html = await fetchTextWithTimeout(searchUrl, timeoutMs);
    const rows = extractShopifySearchPageRows(storefrontUrl, html, limit);
    const products = [];
    for (const row of rows.slice(0, limit)) {
      products.push(await normalizeShopifySearchProduct(storefrontUrl, row, {
        currency,
        fetchProductDetail: (baseUrl, product) => fetchShopifyProductDetail(baseUrl, product, { timeoutMs }),
        fetchCustomizationOptions: (productUrl) => fetchShopifyCustomizationOptions(productUrl, { timeoutMs }),
      }));
    }
    return products.filter((item) => item?.name).slice(0, limit);
  } catch (error) {
    console.warn("[aiove] Shopify storefront search page failed:", error.message);
    if (throwOnError) throw error;
    return [];
  }
}

export async function fetchShopifyPublicProductByUrl(storefrontUrl, productUrl, { currency = "", timeoutMs = SERVER_CONFIG.productApi.timeoutMs } = {}) {
  const base = new URL(storefrontUrl);
  const target = new URL(productUrl);
  if (base.origin !== target.origin || !/^\/products\/[^/]+\/?$/.test(target.pathname)) return null;
  return normalizeShopifySearchProduct(storefrontUrl, { url: target.href, handle: extractShopifyHandle(target.href) }, {
    currency,
    fetchProductDetail: (url, product) => fetchShopifyProductDetail(url, product, { timeoutMs }),
    fetchCustomizationOptions: async () => [],
  });
}

export async function fetchShopifyPublicProducts(storefrontUrl, searchIntent = {}, { currency = "", timeoutMs = SERVER_CONFIG.productApi.timeoutMs, maxProducts = MAX_PRODUCTS, throwOnError = false } = {}) {
  const limit = normalizeProductSourceLimit(maxProducts);
  const searchUrl = buildShopifySearchUrl(storefrontUrl, searchIntent, { maxProducts: limit });
  if (!searchUrl) return [];

  try {
    const payload = await fetchJsonWithTimeout(searchUrl, timeoutMs);
    const rows = extractShopifySearchRows(payload);
    const products = [];
    for (const row of rows.slice(0, limit)) {
      products.push(await normalizeShopifySearchProduct(storefrontUrl, row, {
        currency,
        fetchProductDetail: (baseUrl, product) => fetchShopifyProductDetail(baseUrl, product, { timeoutMs }),
        fetchCustomizationOptions: (productUrl) => fetchShopifyCustomizationOptions(productUrl, { timeoutMs }),
      }));
    }
    return products.filter((item) => item?.name).slice(0, limit);
  } catch (error) {
    console.warn("[aiove] Shopify public product view failed:", error.message);
    if (throwOnError) throw error;
    return [];
  }
}

function buildShopifyStorefrontSearchUrl(storefrontUrl, searchIntent = {}) {
  try {
    const source = new URL(storefrontUrl);
    const url = new URL("/search", source.origin);
    url.searchParams.set("q", shopifySearchQuery(searchIntent.query));
    url.searchParams.set("type", "product");
    return url.toString();
  } catch {
    return "";
  }
}

function isShopifyStorefrontUrl(value) {
  const text = safeString(value);
  if (!text) return false;
  try {
    const url = new URL(text);
    if (!["http:", "https:"].includes(url.protocol)) return false;
    return (!url.pathname || url.pathname === "/") && !url.search;
  } catch {
    return false;
  }
}

function isShopifySearchApiUrl(value) {
  const text = safeString(value);
  if (!text) return false;
  try {
    const url = new URL(text);
    if (!["http:", "https:"].includes(url.protocol)) return false;
    return normalizePathname(url.pathname) === "/search/suggest.json";
  } catch {
    return false;
  }
}

function extractShopifySearchRows(payload) {
  const rows = payload?.resources?.results?.products;
  return Array.isArray(rows) ? rows : [];
}

function extractShopifySearchPageRows(storefrontUrl, html = "", maxRows = MAX_PRODUCTS) {
  const products = [];
  const seenHandles = new Set();
  const linkPattern = /<a\b[^>]*href=["']([^"']*\/products\/[^"'#?]+[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = linkPattern.exec(String(html || ""))) && products.length < normalizeProductSourceLimit(maxRows)) {
    const url = normalizeProductPageUrl(storefrontUrl, match[1]);
    const handle = extractShopifyHandle(url);
    if (!handle || seenHandles.has(handle)) continue;
    seenHandles.add(handle);
    products.push({
      handle,
      title: stripHtml(match[2]),
      url,
    });
  }
  return products;
}

async function fetchShopifyProductDetail(storefrontUrl, product = {}, { timeoutMs = SERVER_CONFIG.productApi.timeoutMs } = {}) {
  const handle = safeString(product.handle) || extractShopifyHandle(product.url);
  if (!handle) return null;
  try {
    return await fetchJsonWithTimeout(buildShopifyDetailUrl(storefrontUrl, handle), timeoutMs);
  } catch {
    return null;
  }
}

function buildShopifyDetailUrl(storefrontUrl, handle) {
  const source = new URL(storefrontUrl);
  return new URL(`/products/${encodeURIComponent(handle)}.js`, source.origin).toString();
}

function normalizeProductPageUrl(storefrontUrl, value = "") {
  const text = safeString(value);
  if (!text) return "";
  try {
    return new URL(text, new URL(storefrontUrl).origin).toString();
  } catch {
    return text;
  }
}

function extractShopifyHandle(value = "") {
  const text = safeString(value);
  if (!text) return "";
  try {
    const url = new URL(text, "https://example.test");
    const parts = url.pathname.split("/").filter(Boolean);
    const index = parts.indexOf("products");
    return index >= 0 ? safeString(parts[index + 1]) : "";
  } catch {
    return "";
  }
}

function stripHtml(value = "") {
  return safeString(value).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
}
