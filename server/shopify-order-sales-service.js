import { createHash } from "node:crypto";
import { SERVER_CONFIG } from "./config.js";
import { normalizeCurrency, normalizeShopifyAdminProduct } from "./product-normalizer.js";
import {
  isVisibleShopifyAdminProduct,
  parseShopifyAdminSource,
  resolveShopifyAdminToken,
} from "./product-source-shopify-admin-service.js";
import { resolveShopifyMarketContext } from "./shopify-market-context-service.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const ORDER_PAGE_SIZE = 100;
const LINE_ITEM_PAGE_SIZE = 50;
const SALES_RANK_LIMIT = 32;
const SALES_SYNC_DEADLINE_MS = 30 * 1000;
const GRAPHQL_THROTTLE_RETRIES = 2;
const PAID_ORDER_STATUSES = new Set(["PAID", "PARTIALLY_PAID", "PARTIALLY_REFUNDED"]);

export async function fetchShopifyOrderSalesSnapshot(site = {}, { now = new Date(), timeoutMs = Math.max(8000, SERVER_CONFIG.productApi.timeoutMs), fetchImpl = fetch } = {}) {
  const source = parseShopifyAdminSource(site.product_api_url || "");
  if (!source) throw new Error("Shopify Admin order source is not configured");
  const token = resolveShopifyAdminToken(source.tokenEnv, site.product_access_token_encrypted || "");
  if (!token) throw new Error("Shopify Admin access token is not configured");

  const normalizedNow = normalizeDate(now);
  const deadlineAt = Date.now() + SALES_SYNC_DEADLINE_MS;
  const marketContext = await resolveShopifyMarketContext({
    endpoint: source.endpoint,
    token,
    currency: site.currency,
    countryCode: site.market_country_code || site.marketCountryCode || "",
    timeoutMs,
    fetchImpl,
  });
  const marketSite = { ...site, currency: marketContext.currency };
  const orders = await fetchRecentOrders(source, token, normalizedNow, timeoutMs, deadlineAt, fetchImpl);
  const sales = aggregateShopifyOrderSales(orders, { now: normalizedNow });
  const rankedProductIds = uniqueStrings([
    ...sales.rank30d.map((item) => item.productId),
    ...sales.rank60d.map((item) => item.productId),
  ]);
  const products = await fetchRankedProducts(source, token, marketSite, rankedProductIds, marketContext.countryCode, timeoutMs, deadlineAt, fetchImpl);
  return {
    rank30d: sanitizeSalesRanking(sales.rank30d),
    rank60d: sanitizeSalesRanking(sales.rank60d),
    includedOrderCount: sales.includedOrderCount,
    products,
    shuffleSeed: createHash("sha256")
      .update(`${site.id || site.slug || "site"}:${normalizedNow.toISOString()}`)
      .digest("hex")
      .slice(0, 24),
    generatedAt: normalizedNow.toISOString(),
  };
}

export function aggregateShopifyOrderSales(orders = [], { now = new Date() } = {}) {
  const normalizedNow = normalizeDate(now);
  const cutoff30d = normalizedNow.getTime() - 30 * DAY_MS;
  const cutoff60d = normalizedNow.getTime() - 60 * DAY_MS;
  const totals30d = new Map();
  const totals60d = new Map();
  let includedOrderCount = 0;

  for (const order of Array.isArray(orders) ? orders : []) {
    const createdAt = new Date(order?.createdAt || "");
    const createdTime = createdAt.getTime();
    if (!Number.isFinite(createdTime) || createdTime < cutoff60d || createdTime > normalizedNow.getTime()) continue;
    if (order?.test || order?.cancelledAt || !PAID_ORDER_STATUSES.has(String(order?.displayFinancialStatus || "").toUpperCase())) continue;
    includedOrderCount += 1;
    for (const edge of Array.isArray(order?.lineItems?.edges) ? order.lineItems.edges : []) {
      const productId = String(edge?.node?.product?.id || "").trim();
      const units = Math.max(0, Math.floor(Number(edge?.node?.currentQuantity || 0)));
      if (!productId || !units) continue;
      addSalesUnits(totals60d, productId, units, createdAt.toISOString());
      if (createdTime >= cutoff30d) addSalesUnits(totals30d, productId, units, createdAt.toISOString());
    }
  }

  return {
    rank30d: rankSalesTotals(totals30d),
    rank60d: rankSalesTotals(totals60d),
    includedOrderCount,
  };
}

async function fetchRecentOrders(source, token, now, timeoutMs, deadlineAt, fetchImpl) {
  const orders = [];
  let after = null;
  const searchQuery = `created_at:>=${new Date(now.getTime() - 60 * DAY_MS).toISOString()} test:false`;
  for (let page = 0; page < 100; page += 1) {
    const payload = await shopifyGraphql(source, token, buildRecentOrdersQuery(), {
      query: searchQuery,
      first: ORDER_PAGE_SIZE,
      after,
      lineItemFirst: LINE_ITEM_PAGE_SIZE,
    }, timeoutMs, deadlineAt, fetchImpl);
    const connection = payload?.data?.orders;
    if (!connection || !Array.isArray(connection.edges)) throw new Error("Shopify orders response is invalid");
    for (const edge of connection.edges) {
      if (!edge?.node) continue;
      await appendRemainingLineItems(source, token, edge.node, timeoutMs, deadlineAt, fetchImpl);
      orders.push(edge.node);
    }
    await waitForThrottle(payload?.extensions?.cost?.throttleStatus, payload?.extensions?.cost?.requestedQueryCost, deadlineAt);
    if (!connection.pageInfo?.hasNextPage) return orders;
    after = connection.pageInfo.endCursor;
    if (!after) throw new Error("Shopify orders pagination cursor is missing");
  }
  throw new Error("Shopify orders pagination exceeded the safety limit");
}

async function appendRemainingLineItems(source, token, order, timeoutMs, deadlineAt, fetchImpl) {
  let pageInfo = order?.lineItems?.pageInfo;
  while (pageInfo?.hasNextPage) {
    if (!order.id || !pageInfo.endCursor) throw new Error("Shopify line item pagination cursor is missing");
    const payload = await shopifyGraphql(source, token, buildOrderLineItemsQuery(), {
      id: order.id,
      first: LINE_ITEM_PAGE_SIZE,
      after: pageInfo.endCursor,
    }, timeoutMs, deadlineAt, fetchImpl);
    const connection = payload?.data?.order?.lineItems;
    if (!connection || !Array.isArray(connection.edges)) throw new Error("Shopify line item response is invalid");
    order.lineItems.edges.push(...connection.edges);
    pageInfo = connection.pageInfo;
    await waitForThrottle(payload?.extensions?.cost?.throttleStatus, payload?.extensions?.cost?.requestedQueryCost, deadlineAt);
  }
}

async function fetchRankedProducts(source, token, site, productIds, marketCountryCode, timeoutMs, deadlineAt, fetchImpl) {
  if (!productIds.length) return [];
  const payload = await shopifyGraphql(source, token, buildRankedProductsQuery(), { ids: productIds, country: marketCountryCode }, timeoutMs, deadlineAt, fetchImpl);
  return (Array.isArray(payload?.data?.nodes) ? payload.data.nodes : [])
    .filter(isVisibleShopifyAdminProduct)
    .map((product) => normalizeShopifyAdminProduct(product, { currency: normalizeCurrency(site.currency), shopDomain: source.shopDomain }))
    .filter((product) => product.name);
}

async function shopifyGraphql(source, token, query, variables, timeoutMs, deadlineAt, fetchImpl) {
  for (let attempt = 0; attempt <= GRAPHQL_THROTTLE_RETRIES; attempt += 1) {
    const remainingMs = deadlineAt - Date.now();
    if (remainingMs <= 0) throw new Error("Shopify sales refresh exceeded the total time limit");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(250, Math.min(remainingMs, Number(timeoutMs || 8000))));
    try {
      const response = await fetchImpl(source.endpoint, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": "AIOVE Shopify Order Sales Reader",
        "X-Shopify-Access-Token": token,
      },
      body: JSON.stringify({ query, variables }),
      signal: controller.signal,
    });
      const payload = await response.json().catch(() => ({}));
      const throttled = response.status === 429 || (payload?.errors || []).some((item) => item?.extensions?.code === "THROTTLED");
      if (throttled && attempt < GRAPHQL_THROTTLE_RETRIES) {
        const retryAfterMs = parseRetryAfterMs(response.headers?.get?.("retry-after"));
        await waitForThrottle(payload?.extensions?.cost?.throttleStatus, payload?.extensions?.cost?.requestedQueryCost || 100, deadlineAt, retryAfterMs || 250);
        continue;
      }
      if (!response.ok) throw new Error(`Shopify order read HTTP ${response.status}`);
      if (Array.isArray(payload.errors) && payload.errors.length) {
        throw new Error(payload.errors.map((item) => item?.message).filter(Boolean).join("; ") || "Shopify order GraphQL error");
      }
      return payload;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error("Shopify order GraphQL retry limit exceeded");
}

function buildRecentOrdersQuery() {
  return `
query AioveRecentProductSales($query: String!, $first: Int!, $after: String, $lineItemFirst: Int!) {
  orders(first: $first, after: $after, query: $query, sortKey: CREATED_AT, reverse: true) {
    pageInfo { hasNextPage endCursor }
    edges {
      node {
        id
        createdAt
        test
        cancelledAt
        displayFinancialStatus
        lineItems(first: $lineItemFirst) {
          pageInfo { hasNextPage endCursor }
          edges { node { currentQuantity product { id } } }
        }
      }
    }
  }
}
`;
}

function buildOrderLineItemsQuery() {
  return `
query AioveOrderLineItems($id: ID!, $first: Int!, $after: String) {
  order(id: $id) {
    lineItems(first: $first, after: $after) {
      pageInfo { hasNextPage endCursor }
      edges { node { currentQuantity product { id } } }
    }
  }
}
`;
}

function buildRankedProductsQuery() {
  return `
query AioveSalesRankedProducts($ids: [ID!]!, $country: CountryCode!) {
  nodes(ids: $ids) {
    ... on Product {
      id
      title
      handle
      status
      vendor
      productType
      onlineStoreUrl
      featuredImage { url }
      images(first: 8) { edges { node { url } } }
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

function addSalesUnits(map, productId, units, soldAt) {
  const current = map.get(productId) || { productId, units: 0, lastSoldAt: "" };
  current.units += units;
  if (!current.lastSoldAt || soldAt > current.lastSoldAt) current.lastSoldAt = soldAt;
  map.set(productId, current);
}

function rankSalesTotals(map) {
  return [...map.values()]
    .sort((left, right) => right.units - left.units
      || String(right.lastSoldAt).localeCompare(String(left.lastSoldAt))
      || String(left.productId).localeCompare(String(right.productId)))
    .slice(0, SALES_RANK_LIMIT);
}

async function waitForThrottle(status = {}, requestedCost = 0, deadlineAt = Number.POSITIVE_INFINITY, fallbackMs = 0) {
  const available = Number(status?.currentlyAvailable);
  const restoreRate = Number(status?.restoreRate);
  const required = Math.max(0, Number(requestedCost || 0));
  const calculatedWaitMs = Number.isFinite(available) && Number.isFinite(restoreRate) && restoreRate > 0 && available < required
    ? Math.ceil(((required - available) / restoreRate) * 1000) + 50
    : 0;
  const waitMs = Math.min(10000, Math.max(0, calculatedWaitMs, Number(fallbackMs || 0)));
  if (!waitMs) return;
  if (Date.now() + waitMs > deadlineAt) throw new Error("Shopify sales refresh exceeded the total time limit");
  await new Promise((resolve) => setTimeout(resolve, waitMs));
}

function parseRetryAfterMs(value = "") {
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(10000, Math.ceil(seconds * 1000));
  const date = new Date(String(value || ""));
  return Number.isFinite(date.getTime()) ? Math.min(10000, Math.max(0, date.getTime() - Date.now())) : 0;
}

function sanitizeSalesRanking(values) {
  return (Array.isArray(values) ? values : []).map((item) => ({ productId: item.productId, units: item.units }));
}

function normalizeDate(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("Shopify sales snapshot time is invalid");
  return date;
}

function uniqueStrings(values) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}
