import { createPublicError } from "./public-error-utils.js";
import { resolveSearchSite } from "./product-search-site-service.js";
import { parseShopifyAdminSource, resolveShopifyAdminToken } from "./product-source-shopify-admin-service.js";
import { readShopifyCustomerBinding } from "./shopify-customer-sync-service.js";

const ORDER_PAGE_SIZE = 20;
const ORDER_LINE_LIMIT = 50;
const ORDER_LIST_LINE_PREVIEW_LIMIT = 25;
const ORDER_ID_PATTERN = /^gid:\/\/shopify\/Order\/\d+$/;

export async function getShopifyOrderHistory(user = {}, { fetchImpl = fetch } = {}) {
  const access = await resolveOrderAccess(user);
  if (!access) return unsupportedOrderHistory();

  const binding = await readShopifyCustomerBinding({ userId: user.id, siteId: access.site.id });
  if (!isActiveBinding(binding)) return unlinkedOrderHistory(user);

  const data = await shopifyGraphql(access, ORDER_LIST_QUERY, {
    first: ORDER_PAGE_SIZE,
    query: `customer_id:${normalizeCustomerId(binding.shopify_customer_id)}`,
  }, fetchImpl);
  const connection = data?.orders || {};
  const nodes = Array.isArray(connection.nodes) ? connection.nodes : [];
  return {
    ok: true,
    provider: "shopify",
    account: accountSummary(true),
    orders: nodes
      .filter((order) => String(order?.customer?.id || "") === toCustomerGid(binding.shopify_customer_id))
      .map(mapOrderSummary),
    hasMore: connection?.pageInfo?.hasNextPage === true,
  };
}

export async function getShopifyOrderDetail(user = {}, orderId = "", { fetchImpl = fetch } = {}) {
  const normalizedOrderId = normalizeOrderId(orderId);
  const access = await resolveOrderAccess(user);
  if (!access) throwOrderNotFound();

  const binding = await readShopifyCustomerBinding({ userId: user.id, siteId: access.site.id });
  if (!isActiveBinding(binding)) throwOrderNotFound();

  const data = await shopifyGraphql(access, ORDER_DETAIL_QUERY, { id: normalizedOrderId, lineFirst: ORDER_LINE_LIMIT }, fetchImpl);
  const order = data?.order || null;
  if (!order || String(order?.customer?.id || "") !== toCustomerGid(binding.shopify_customer_id)) throwOrderNotFound();

  return { ok: true, provider: "shopify", order: mapOrderDetail(order) };
}

async function resolveOrderAccess(user = {}) {
  const userId = String(user?.id || "").trim();
  const siteId = String(user?.site_id || "").trim();
  const siteSlug = String(user?.site_slug || "").trim();
  if (!userId || !siteId || !siteSlug) throw createPublicError("Please sign in first.", 401, "AUTH_REQUIRED");

  const site = await resolveSearchSite(siteSlug, { allowDefault: false });
  if (!site || String(site.id) !== siteId) throw createPublicError("This account site is unavailable.", 409, "SHOPIFY_ORDER_SITE_UNAVAILABLE");
  const source = parseShopifyAdminSource(site.product_api_url || "");
  const token = source ? resolveShopifyAdminToken(source.tokenEnv, site.product_access_token_encrypted || "") : "";
  if (!source || !token) return null;
  return { site, source, token };
}

async function shopifyGraphql(access, query, variables, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetchImpl(access.source.endpoint, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": "AIOVE Shopify Order History Reader",
        "X-Shopify-Access-Token": access.token,
      },
      body: JSON.stringify({ query, variables }),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || (Array.isArray(payload?.errors) && payload.errors.length)) {
      throw createPublicError("Shopify orders are temporarily unavailable. Please try again later.", 502, "SHOPIFY_ORDER_UPSTREAM_FAILED");
    }
    return payload?.data || {};
  } catch (error) {
    if (error?.publicCode) throw error;
    throw createPublicError("Shopify orders are temporarily unavailable. Please try again later.", 502, "SHOPIFY_ORDER_UPSTREAM_FAILED");
  } finally {
    clearTimeout(timer);
  }
}

function unsupportedOrderHistory() {
  return { ok: true, provider: "unavailable", account: null, orders: [], hasMore: false };
}

function unlinkedOrderHistory() {
  return { ok: true, provider: "shopify", account: accountSummary(false), orders: [], hasMore: false };
}

function accountSummary(linked) {
  return {
    provider: "Shopify",
    linked: Boolean(linked),
  };
}

function mapOrderSummary(order = {}) {
  const lines = Array.isArray(order?.lineItems?.nodes) ? order.lineItems.nodes : [];
  return {
    id: normalizeOrderId(order.id),
    name: String(order.name || "").trim(),
    createdAt: String(order.createdAt || ""),
    financialStatus: normalizeStatus(order.displayFinancialStatus),
    fulfillmentStatus: normalizeStatus(order.displayFulfillmentStatus),
    total: mapMoney(order.totalPriceSet?.presentmentMoney),
    itemSummary: lines.map((line) => formatLineSummary(line)).filter(Boolean).join(" · "),
    hasMoreItems: order?.lineItems?.pageInfo?.hasNextPage === true,
    items: lines.map(mapOrderItem).filter((line) => line.title),
  };
}

function mapOrderDetail(order = {}) {
  const summary = mapOrderSummary(order);
  const pricing = mapOrderPricing(order);
  return {
    ...summary,
    createdAt: String(order?.createdAt || summary.createdAt || ""),
    total: pricing.total || summary.total,
    pricing,
    shipments: mapOrderShipments(order?.fulfillments),
    items: (Array.isArray(order?.lineItems?.nodes) ? order.lineItems.nodes : []).map(mapOrderItem).filter((line) => line.title),
  };
}

function mapOrderItem(line = {}) {
  return {
    title: String(line?.title || "").trim(),
    variantTitle: String(line?.variantTitle || "").trim(),
    quantity: Math.max(0, Math.trunc(Number(line?.quantity || 0))),
    imageUrl: sanitizeOrderImageUrl(line?.image?.url),
    unitPrice: mapMoney(line?.originalUnitPriceSet?.presentmentMoney),
  };
}

function mapOrderPricing(order = {}) {
  return {
    subtotal: mapMoney(order?.currentSubtotalPriceSet?.presentmentMoney),
    discount: mapMoney(order?.currentTotalDiscountsSet?.presentmentMoney),
    shipping: mapMoney(order?.currentShippingPriceSet?.presentmentMoney),
    tax: mapMoney(order?.currentTotalTaxSet?.presentmentMoney),
    total: mapMoney(order?.currentTotalPriceSet?.presentmentMoney),
  };
}

function mapOrderShipments(fulfillments) {
  return (Array.isArray(fulfillments) ? fulfillments : [])
    .map((fulfillment) => ({
      status: normalizeStatus(fulfillment?.displayStatus || fulfillment?.status),
      tracking: (Array.isArray(fulfillment?.trackingInfo) ? fulfillment.trackingInfo : [])
        .map((tracking) => ({
          company: clipTrackingText(tracking?.company),
          number: clipTrackingText(tracking?.number),
          url: sanitizeTrackingUrl(tracking?.url),
        }))
        .filter((tracking) => tracking.company || tracking.number),
    }))
    .filter((shipment) => shipment.status !== "UNKNOWN" || shipment.tracking.length);
}

function mapMoney(money = {}) {
  const amount = String(money?.amount || "").trim();
  const currencyCode = String(money?.currencyCode || "").trim().toUpperCase();
  return amount && currencyCode ? { amount, currencyCode } : null;
}

function clipTrackingText(value = "") {
  return String(value || "").trim().slice(0, 160);
}

function sanitizeTrackingUrl(value = "") {
  const raw = String(value || "").trim();
  if (!raw || raw.length > 2048) return "";
  try {
    const url = new URL(raw);
    return url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function sanitizeOrderImageUrl(value = "") {
  const raw = String(value || "").trim();
  if (!raw || raw.length > 2048) return "";
  try {
    const url = new URL(raw);
    return url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function formatLineSummary(line = {}) {
  const title = String(line?.title || "").trim();
  const quantity = Math.max(0, Math.trunc(Number(line?.quantity || 0)));
  return title ? `${title}${quantity ? ` × ${quantity}` : ""}` : "";
}

function normalizeOrderId(value = "") {
  const id = String(value || "").trim();
  if (!ORDER_ID_PATTERN.test(id)) throw createPublicError("Order not found.", 404, "SHOPIFY_ORDER_NOT_FOUND");
  return id;
}

function normalizeCustomerId(value = "") {
  const id = String(value || "").replace(/^gid:\/\/shopify\/Customer\//, "").trim();
  if (!/^\d+$/.test(id)) throw createPublicError("Shopify account linking needs to be completed again.", 409, "SHOPIFY_CUSTOMER_BINDING_REQUIRED");
  return id;
}

function toCustomerGid(value = "") {
  return `gid://shopify/Customer/${normalizeCustomerId(value)}`;
}

function isActiveBinding(binding = {}) {
  return Boolean(binding?.shopify_customer_id) && String(binding?.binding_status || "") === "active";
}

function normalizeStatus(value = "") {
  return String(value || "").trim().toUpperCase() || "UNKNOWN";
}

function throwOrderNotFound() {
  throw createPublicError("Order not found.", 404, "SHOPIFY_ORDER_NOT_FOUND");
}

const ORDER_LIST_QUERY = `
query AioveCustomerOrderHistory($first: Int!, $query: String!) {
  orders(first: $first, query: $query, sortKey: PROCESSED_AT, reverse: true) {
    pageInfo { hasNextPage }
    nodes {
      id
      name
      createdAt
      displayFinancialStatus
      displayFulfillmentStatus
      totalPriceSet { presentmentMoney { amount currencyCode } }
      customer { id }
      lineItems(first: ${ORDER_LIST_LINE_PREVIEW_LIMIT}) { pageInfo { hasNextPage } nodes { title quantity image { url } } }
    }
  }
}
`;

const ORDER_DETAIL_QUERY = `
query AioveCustomerOrderDetail($id: ID!, $lineFirst: Int!) {
  order(id: $id) {
    id
    name
    createdAt
    displayFinancialStatus
      displayFulfillmentStatus
      totalPriceSet { presentmentMoney { amount currencyCode } }
      currentSubtotalPriceSet { presentmentMoney { amount currencyCode } }
      currentTotalDiscountsSet { presentmentMoney { amount currencyCode } }
      currentShippingPriceSet { presentmentMoney { amount currencyCode } }
      currentTotalTaxSet { presentmentMoney { amount currencyCode } }
      currentTotalPriceSet { presentmentMoney { amount currencyCode } }
      customer { id }
      fulfillments(first: 10) {
        displayStatus
        status
        trackingInfo(first: 5) { company number url }
      }
      lineItems(first: $lineFirst) {
      pageInfo { hasNextPage }
      nodes {
        title
        variantTitle
        quantity
        image { url }
        originalUnitPriceSet { presentmentMoney { amount currencyCode } }
      }
    }
  }
}
`;
