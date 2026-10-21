import { createProductSourceError, createProductSourceGraphqlError, normalizeProductSourceError, PRODUCT_SOURCE_ERROR_CODE } from "./product-source-error-service.js";
import { SERVER_CONFIG } from "./config.js";
import { normalizeShopifyAdminProduct } from "./product-normalizer.js";
import { resolveShopifyMarketContext } from "./shopify-market-context-service.js";
import { decryptSecret } from "./security.js";
import {
  MAX_PRODUCTS,
  normalizeProductSourceLimit,
  safeString,
  shopifySearchQuery,
} from "./product-source-shared-service.js";

export function isShopifyAdminProductSource(value) {
  return Boolean(parseShopifyAdminSource(value));
}

export function buildShopifyAdminStorefrontUrl(value) {
  const source = parseShopifyAdminSource(value);
  return source ? `https://${source.shopDomain}` : "";
}

export async function fetchShopifyAdminProducts(sourceValue, searchIntent = {}, { currency = "", marketCountryCode = "", timeoutMs = SERVER_CONFIG.productApi.timeoutMs, encryptedAccessToken = "", maxProducts = MAX_PRODUCTS, throwOnError = false } = {}) {
  const source = parseShopifyAdminSource(sourceValue);
  if (!source) return [];
  const token = resolveShopifyAdminToken(source.tokenEnv, encryptedAccessToken);
  if (!token) {
    console.warn("[aiove] Shopify admin product source missing configured access token");
    if (throwOnError) throw createProductSourceError(PRODUCT_SOURCE_ERROR_CODE.CREDENTIALS_UNAVAILABLE, { provider: "shopify" });
    return [];
  }

  const limit = normalizeProductSourceLimit(maxProducts);
  try {
    const marketContext = await resolveShopifyMarketContext({ endpoint: source.endpoint, token, currency, countryCode: marketCountryCode, timeoutMs });
    const payload = await fetchShopifyAdminGraphql(source, token, buildShopifyAdminProductsQuery(), {
      query: shopifyAdminSearchQuery(searchIntent.query, { productHandle: searchIntent.productHandle }),
      first: limit,
      country: marketContext.countryCode,
    }, timeoutMs);
    const rows = payload?.data?.products?.nodes;
    if (!Array.isArray(rows)) throw createProductSourceError(PRODUCT_SOURCE_ERROR_CODE.SOURCE_INTERNAL, { provider: "shopify" });
    return rows
      .filter(isVisibleShopifyAdminProduct)
      .map((product) => normalizeShopifyAdminProduct(product, {
        currency: marketContext.currency,
        shopDomain: source.shopDomain,
      }))
      .filter((item) => item.name)
      .slice(0, limit);
  } catch (error) {
    const metadata = normalizeProductSourceError(error, { provider: "shopify" });
    console.warn("[aiove] Shopify admin product source failed", metadata);
    if (throwOnError) throw createProductSourceError(metadata.code, metadata);
    return [];
  }
}

async function fetchShopifyAdminGraphql(source, token, query, variables = {}, timeoutMs = SERVER_CONFIG.productApi.timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, Number(timeoutMs || 3000)));
  try {
    const response = await fetch(source.endpoint, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": "AIOVE Shopify Product Reader",
        "X-Shopify-Access-Token": token,
      },
      body: JSON.stringify({ query, variables }),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw createProductSourceError(normalizeProductSourceError({ statusCode: response.status }).code, { provider: "shopify", statusCode: response.status });
    if (Array.isArray(payload.errors) && payload.errors.length) {
      throw createProductSourceGraphqlError(payload.errors, { provider: "shopify" });
    }
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

function buildShopifyAdminProductsQuery() {
  return `
query AioveProductSearch($query: String, $first: Int!, $country: CountryCode!) {
  products(first: $first, query: $query, sortKey: PUBLISHED_AT, reverse: true) {
    nodes {
        id
        title
        handle
        status
        publishedAt
        createdAt
        updatedAt
        vendor
        productType
        totalInventory
        onlineStoreUrl
        featuredImage { url }
        images(first: 8) { edges { node { url } } }
        collections(first: 100) { nodes { id } }
        customization: metafield(namespace: "alove", key: "customization_options") {
          type
          value
          updatedAt
        }
        variants(first: 100) {
          nodes {
              id
              title
              sku
              contextualPricing(context: { country: $country }) {
                price { amount currencyCode }
                compareAtPrice { amount currencyCode }
              }
              availableForSale
              inventoryQuantity
              selectedOptions { name value }
          }
        }
      }
    }
  }
`;
}

export function isVisibleShopifyAdminProduct(product = {}) {
  return product?.status === "ACTIVE" && Boolean(safeString(product.onlineStoreUrl));
}

export function parseShopifyAdminSource(value = "") {
  const text = safeString(value);
  if (!text) return null;
  try {
    const url = new URL(text);
    if (url.protocol !== "shopify-admin:") return null;
    const shopDomain = safeString(url.hostname || url.pathname.replace(/^\/+/, "")).toLowerCase();
    if (!shopDomain || !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shopDomain)) return null;
    const apiVersion = normalizeShopifyAdminApiVersion(url.searchParams.get("version") || SERVER_CONFIG.productApi.shopifyAdminApiVersion);
    return {
      shopDomain,
      tokenEnv: normalizeShopifyTokenEnv(url.searchParams.get("tokenEnv")),
      apiVersion,
      endpoint: `https://${shopDomain}/admin/api/${apiVersion}/graphql.json`,
    };
  } catch {
    return null;
  }
}

export function resolveShopifyAdminToken(tokenEnv = "SHOPIFY_ADMIN_ACCESS_TOKEN", encryptedAccessToken = "") {
  if (safeString(encryptedAccessToken)) return decryptConfiguredSecret(encryptedAccessToken);
  if (normalizeShopifyTokenEnv(tokenEnv) !== "SHOPIFY_ADMIN_ACCESS_TOKEN") return "";
  return safeString(SERVER_CONFIG.productApi.shopifyAdminAccessToken);
}

function normalizeShopifyTokenEnv(value = "") {
  const envName = safeString(value) || "SHOPIFY_ADMIN_ACCESS_TOKEN";
  return envName === "SHOPIFY_ADMIN_ACCESS_TOKEN" ? envName : "UNSUPPORTED_TOKEN_ENV";
}

function decryptConfiguredSecret(value = "") {
  const text = safeString(value);
  if (!text) return "";
  try {
    return safeString(decryptSecret(text, SERVER_CONFIG.productApi.secretKey));
  } catch {
    return "";
  }
}

function normalizeShopifyAdminApiVersion(value = "") {
  const text = safeString(value);
  return /^\d{4}-\d{2}$/.test(text) ? text : SERVER_CONFIG.productApi.shopifyAdminApiVersion;
}

export function shopifyAdminSearchQuery(query = "", { productHandle = "" } = {}) {
  const handle = safeString(productHandle).toLowerCase();
  if (handle.length <= 255 && /^[a-z0-9][a-z0-9-]*$/.test(handle)) return `handle:${handle}`;
  const text = shopifySearchQuery(query);
  if (!text || text === "football shirt") return "status:active";
  const tokens = [...new Set(text
    .split(/\s+/)
    .map((token) => safeString(token).replace(/[^a-zA-Z0-9_-]/g, ""))
    .filter(Boolean)
    .map((token) => token.toLowerCase()))];
  if (!tokens.length) return "status:active";
  // Shopify's quoted title search is not a reliable phrase match for multi-word
  // catalogue entities. Match normalized title words, then apply the shared
  // requirement filters and ranking to the returned active catalogue set.
  if (tokens.length === 1) return `status:active AND (title:${tokens[0]}* OR sku:${tokens[0]}*)`;
  const titleTerms = tokens.slice(0, 8).map((token) => `title:${token}*`);
  return ["status:active", ...titleTerms].join(" AND ");
}
