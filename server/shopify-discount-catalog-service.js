import { SERVER_CONFIG } from "./config.js";
import { createPublicError } from "./public-error-utils.js";
import {
  parseShopifyAdminSource,
  resolveShopifyAdminToken,
} from "./product-source-shopify-admin-service.js";

const SEARCH_LIMIT = 12;
const SEARCH_NODE_LIMIT = 24;
const MIN_QUERY_LENGTH = 2;
const MAX_CODE_LENGTH = 64;
const SEARCH_CACHE_TTL_MS = 15 * 1000;
const SEARCH_RATE_WINDOW_MS = 60 * 1000;
const SEARCH_RATE_LIMIT = 30;
const searchCache = new Map();
const searchRateBuckets = new Map();

export async function searchShopifyDiscountCodes(site = {}, query = "", {
  fetchImpl = globalThis.fetch,
  timeoutMs = SERVER_CONFIG.productApi.timeoutMs,
  accessToken = "",
} = {}) {
  const searchText = normalizeSearchText(query);
  if (searchText.length < MIN_QUERY_LENGTH) return [];
  const cacheKey = `${normalizeText(site.id)}:${searchText.toLowerCase()}`;
  const cached = searchCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.items;
  const client = resolveShopifyDiscountClient(site, accessToken, fetchImpl);
  const payload = await requestShopifyDiscountGraphql(
    client,
    SHOPIFY_DISCOUNT_SEARCH_QUERY,
    { query: searchText, first: SEARCH_NODE_LIMIT },
    timeoutMs,
    "SHOPIFY_DISCOUNT_SEARCH_FAILED",
  );
  const nodes = Array.isArray(payload?.data?.discountNodes?.nodes)
    ? payload.data.discountNodes.nodes
    : [];
  const needle = searchText.toLowerCase();
  const matches = [];
  for (const node of nodes) {
    const codes = Array.isArray(node?.discount?.codes?.nodes) ? node.discount.codes.nodes : [];
    for (const codeNode of codes) {
      const code = normalizeCode(codeNode?.code);
      if (!code || !code.toLowerCase().includes(needle)) continue;
      matches.push(mapShopifyDiscountRule({
        id: node?.id,
        codeDiscount: node?.discount,
      }, code));
      if (matches.length >= SEARCH_LIMIT) {
        rememberSearch(cacheKey, matches);
        return matches;
      }
    }
  }
  rememberSearch(cacheKey, matches);
  return matches;
}

export function assertShopifyDiscountSearchAllowed(actorId = "", now = Date.now()) {
  const key = normalizeText(actorId) || "unknown";
  const currentTime = Number(now) || Date.now();
  const current = searchRateBuckets.get(key);
  const bucket = !current || current.windowStartedAt + SEARCH_RATE_WINDOW_MS <= currentTime
    ? { count: 0, windowStartedAt: currentTime }
    : current;
  bucket.count += 1;
  searchRateBuckets.set(key, bucket);
  if (bucket.count > SEARCH_RATE_LIMIT) {
    throw createPublicError("折扣码搜索过于频繁，请稍后再试", 429, "SHOPIFY_DISCOUNT_SEARCH_RATE_LIMITED");
  }
  if (searchRateBuckets.size > 5000) pruneSearchState(currentTime);
}

export async function resolveShopifyDiscountCode(site = {}, code = "", {
  fetchImpl = globalThis.fetch,
  timeoutMs = SERVER_CONFIG.productApi.timeoutMs,
  accessToken = "",
} = {}) {
  const normalizedCode = normalizeCode(code);
  if (!normalizedCode) {
    throw createPublicError("请选择 Shopify 折扣码", 400, "SHOPIFY_DISCOUNT_CODE_REQUIRED");
  }
  const client = resolveShopifyDiscountClient(site, accessToken, fetchImpl);
  const payload = await requestShopifyDiscountGraphql(
    client,
    SHOPIFY_DISCOUNT_BY_CODE_QUERY,
    { code: normalizedCode },
    timeoutMs,
    "SHOPIFY_DISCOUNT_LOOKUP_FAILED",
  );
  const node = payload?.data?.codeDiscountNodeByCode;
  if (!node?.codeDiscount) {
    throw createPublicError("Shopify 中未找到该折扣码", 404, "SHOPIFY_DISCOUNT_NOT_FOUND");
  }
  return mapShopifyDiscountRule(node, normalizedCode);
}

export function mapShopifyDiscountRule(node = {}, code = "") {
  const discount = node?.codeDiscount || {};
  const sourceType = normalizeText(discount.__typename);
  const customerGets = discount.customerGets || {};
  const value = customerGets.value || {};
  const minimumRequirement = normalizeMinimumRequirement(discount.minimumRequirement);
  const targetScope = normalizeTargetScope(customerGets.items);
  const customerContext = normalizeText(discount.context?.__typename);
  const combinesWith = normalizeCombinesWith(discount.combinesWith);
  const discountClasses = normalizeDiscountClasses(discount.discountClasses);
  const shopifyDiscountType = normalizeDiscountType(sourceType, value.__typename);
  const normalizedValue = normalizeDiscountValue(shopifyDiscountType, value);
  const appliesOnEachItem = shopifyDiscountType === "fixed_amount" && value.appliesOnEachItem === true;
  const shopifyStatus = normalizeText(discount.status).toUpperCase();
  const startsAt = normalizeIsoDate(discount.startsAt);
  const endsAt = normalizeIsoDate(discount.endsAt);
  const offerDescription = clipText(
    discount.shortSummary || discount.summary || discount.title || normalizeCode(code),
    255,
  );
  const pricePreviewEligible = sourceType === "DiscountCodeBasic"
    && !minimumRequirement
    && ["all", "products", "collections"].includes(targetScope.type)
    && /All$/i.test(customerContext)
    && (
      shopifyDiscountType === "percentage"
      || shopifyDiscountType === "fixed_amount"
    );

  return {
    shopifyDiscountId: normalizeText(node?.id),
    code: normalizeCode(code),
    offerDescription,
    shopifyDiscountType,
    shopifyStatus,
    startsAt,
    endsAt,
    validityMode: endsAt ? "fixed" : "indefinite",
    rule: {
      type: shopifyDiscountType,
      value: normalizedValue.value,
      currencyCode: normalizedValue.currencyCode,
      appliesOnEachItem,
      minimumRequirement,
      targetScope,
      customerContext,
      appliesOncePerCustomer: discount.appliesOncePerCustomer === true,
      usageLimit: normalizeUsageLimit(discount.usageLimit),
      asyncUsageCount: normalizeUsageCount(discount.asyncUsageCount),
      discountClasses,
      combinesWith,
      pricePreviewEligible,
    },
  };
}

function normalizeCombinesWith(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  return {
    productDiscounts: source.productDiscounts === true,
    orderDiscounts: source.orderDiscounts === true,
    shippingDiscounts: source.shippingDiscounts === true,
  };
}

function normalizeDiscountClasses(value = []) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map((item) => normalizeText(item).toUpperCase())
    .filter((item) => ["PRODUCT", "ORDER", "SHIPPING"].includes(item)))].sort();
}

function normalizeUsageLimit(value) {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
}

function normalizeUsageCount(value) {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric >= 0 ? numeric : 0;
}

function rememberSearch(key, items) {
  searchCache.set(key, { expiresAt: Date.now() + SEARCH_CACHE_TTL_MS, items });
  if (searchCache.size > 500) pruneSearchState(Date.now());
}

function pruneSearchState(now) {
  for (const [key, value] of searchCache) {
    if (value.expiresAt <= now) searchCache.delete(key);
  }
  for (const [key, value] of searchRateBuckets) {
    if (value.windowStartedAt + SEARCH_RATE_WINDOW_MS <= now) searchRateBuckets.delete(key);
  }
}

function resolveShopifyDiscountClient(site, accessToken, fetchImpl) {
  const source = parseShopifyAdminSource(site.product_api_url || site.productApiUrl || "");
  const token = normalizeText(accessToken) || (source
    ? resolveShopifyAdminToken(
        source.tokenEnv,
        site.product_access_token_encrypted || site.productAccessTokenEncrypted || "",
      )
    : "");
  if (!source || !token || typeof fetchImpl !== "function") {
    throw createPublicError(
      "当前站点尚未配置可读取折扣码的 Shopify API",
      400,
      "SHOPIFY_DISCOUNT_SOURCE_UNAVAILABLE",
    );
  }
  return { source, token, fetchImpl };
}

async function requestShopifyDiscountGraphql(client, query, variables, timeoutMs, publicCode) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, Number(timeoutMs || 3000)));
  try {
    const response = await client.fetchImpl(client.source.endpoint, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": "AIOVE Shopify Discount Catalog",
        "X-Shopify-Access-Token": client.token,
      },
      body: JSON.stringify({ query, variables }),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || (Array.isArray(payload.errors) && payload.errors.length)) {
      throw createPublicError("Shopify 折扣码读取失败，请稍后重试", 502, publicCode);
    }
    return payload;
  } catch (error) {
    if (error?.statusCode) throw error;
    throw createPublicError("Shopify 折扣码读取失败，请稍后重试", 502, publicCode);
  } finally {
    clearTimeout(timer);
  }
}

function normalizeSearchText(value) {
  return normalizeText(value)
    .replace(/[^\p{L}\p{N}_ -]+/gu, "")
    .replace(/\s+/g, " ")
    .slice(0, MAX_CODE_LENGTH);
}

function normalizeCode(value) {
  return normalizeText(value).slice(0, MAX_CODE_LENGTH).toUpperCase();
}

function normalizeDiscountType(sourceType, valueType) {
  if (sourceType === "DiscountCodeFreeShipping") return "free_shipping";
  if (sourceType === "DiscountCodeBxgy") return "bxgy";
  if (sourceType === "DiscountCodeApp") return "app";
  if (sourceType !== "DiscountCodeBasic") return "unsupported";
  if (valueType === "DiscountPercentage") return "percentage";
  if (valueType === "DiscountAmount") return "fixed_amount";
  return "unsupported";
}

function normalizeDiscountValue(type, value = {}) {
  if (type === "percentage") {
    const numeric = Number(value.percentage);
    return {
      value: Number.isFinite(numeric) ? roundMoney(numeric <= 1 ? numeric * 100 : numeric) : 0,
      currencyCode: "",
    };
  }
  if (type === "fixed_amount") {
    const numeric = Number(value.amount?.amount);
    return {
      value: Number.isFinite(numeric) ? roundMoney(numeric) : 0,
      currencyCode: normalizeText(value.amount?.currencyCode).toUpperCase(),
    };
  }
  return { value: 0, currencyCode: "" };
}

function normalizeMinimumRequirement(value) {
  const type = normalizeText(value?.__typename);
  if (type === "DiscountMinimumSubtotal") {
    const numeric = Number(value?.greaterThanOrEqualToSubtotal?.amount);
    if (!Number.isFinite(numeric)) return null;
    return {
      type: "subtotal",
      value: roundMoney(numeric),
      currencyCode: normalizeText(value?.greaterThanOrEqualToSubtotal?.currencyCode).toUpperCase(),
    };
  }
  if (type === "DiscountMinimumQuantity") {
    const numeric = Number(value?.greaterThanOrEqualToQuantity);
    if (!Number.isFinite(numeric)) return null;
    return { type: "quantity", value: Math.max(0, Math.floor(numeric)), currencyCode: "" };
  }
  return null;
}

function normalizeTargetScope(value) {
  const type = normalizeText(value?.__typename);
  if (type === "AllDiscountItems") return { type: "all" };
  if (type === "DiscountProducts") {
    return {
      type: "products",
      productIds: normalizeIdList(value?.products?.nodes),
      variantIds: normalizeIdList(value?.productVariants?.nodes),
    };
  }
  if (type === "DiscountCollections") {
    return { type: "collections", collectionIds: normalizeIdList(value?.collections?.nodes) };
  }
  return { type: "unknown" };
}

function normalizeIdList(nodes) {
  return [...new Set((Array.isArray(nodes) ? nodes : []).map((item) => normalizeText(item?.id)).filter(Boolean))].slice(0, 100);
}

function normalizeIsoDate(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function roundMoney(value) {
  return Math.round(Number(value) * 10000) / 10000;
}

function clipText(value, maxLength) {
  return normalizeText(value).slice(0, maxLength);
}

function normalizeText(value) {
  return String(value == null ? "" : value).trim();
}

const SHOPIFY_DISCOUNT_SEARCH_QUERY = `
query AioveDiscountCodeSearch($query: String!, $first: Int!) {
  discountNodes(first: $first, query: $query) {
    nodes {
      id
      discount {
        __typename
        ... on DiscountCodeBasic {
          title
          status
          startsAt
          endsAt
          shortSummary
          summary
          appliesOncePerCustomer
          usageLimit
          asyncUsageCount
          discountClasses
          combinesWith { productDiscounts orderDiscounts shippingDiscounts }
          codes(first: 50) { nodes { code } }
          context { __typename }
          customerGets {
            items { __typename }
            value {
              __typename
              ... on DiscountPercentage { percentage }
              ... on DiscountAmount { amount { amount currencyCode } appliesOnEachItem }
            }
          }
          minimumRequirement {
            __typename
            ... on DiscountMinimumSubtotal {
              greaterThanOrEqualToSubtotal { amount currencyCode }
            }
            ... on DiscountMinimumQuantity {
              greaterThanOrEqualToQuantity
            }
          }
        }
        ... on DiscountCodeBxgy {
          title
          status
          startsAt
          endsAt
          summary
          codes(first: 50) { nodes { code } }
        }
        ... on DiscountCodeFreeShipping {
          title
          status
          startsAt
          endsAt
          summary
          codes(first: 50) { nodes { code } }
        }
        ... on DiscountCodeApp {
          title
          status
          startsAt
          endsAt
          codes(first: 50) { nodes { code } }
        }
      }
    }
  }
}
`;

const SHOPIFY_DISCOUNT_BY_CODE_QUERY = `
query AioveDiscountCodeByCode($code: String!) {
  codeDiscountNodeByCode(code: $code) {
    id
    codeDiscount {
      __typename
      ... on DiscountCodeBasic {
        title
        status
        startsAt
        endsAt
        shortSummary
        summary
        appliesOncePerCustomer
        usageLimit
        asyncUsageCount
        discountClasses
        combinesWith { productDiscounts orderDiscounts shippingDiscounts }
        context { __typename }
        customerGets {
          items {
            __typename
            ... on AllDiscountItems { allItems }
            ... on DiscountProducts {
              products(first: 100) { nodes { id } }
              productVariants(first: 100) { nodes { id } }
            }
            ... on DiscountCollections {
              collections(first: 100) { nodes { id } }
            }
          }
          value {
            __typename
            ... on DiscountPercentage { percentage }
            ... on DiscountAmount { amount { amount currencyCode } appliesOnEachItem }
          }
        }
        minimumRequirement {
          __typename
          ... on DiscountMinimumSubtotal {
            greaterThanOrEqualToSubtotal { amount currencyCode }
          }
          ... on DiscountMinimumQuantity {
            greaterThanOrEqualToQuantity
          }
        }
      }
      ... on DiscountCodeBxgy {
        title
        status
        startsAt
        endsAt
        summary
      }
      ... on DiscountCodeFreeShipping {
        title
        status
        startsAt
        endsAt
        summary
      }
      ... on DiscountCodeApp {
        title
        status
        startsAt
        endsAt
      }
    }
  }
}
`;
