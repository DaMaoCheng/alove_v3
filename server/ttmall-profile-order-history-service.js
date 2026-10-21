import { createPublicError } from "./public-error-utils.js";
import { safeString } from "./product-source-shared-service.js";
import { ensureActiveTtmallBinding, getTtmallAccountBinding, markTtmallAccountBindingStale } from "./ttmall-account-binding-service.js";
import { getTtmallOrder, listTtmallOrders } from "./ttmall-checkout-client-service.js";
import { isEnabledTtmallAccess, resolveTtmallRuntimeAccess } from "./ttmall-runtime-access-service.js";
import { listCachedProductRows } from "./kitshop-repository.js";
import { mapCachedProducts } from "./kitshop-shelf-builder.js";

const ORDER_PAGE_SIZE = 20;
const ORDER_READ_TIMEOUT_MS = 15_000;
const TTMALL_ORDER_SETTLEMENT_CURRENCY = "USD";

// This adapter deliberately returns the existing profile-order DTO. The profile
// modal and client stay provider-neutral; ownership remains enforced by the
// server-owned active TTMall binding before every upstream read.
export async function getTtmallProfileOrderHistory(user = {}, dependencies = {}) {
  const access = await resolveTtmallOrderAccess(user, dependencies);
  if (!isEnabledTtmallAccess(access)) return null;
  if (!access.binding) return emptyTtmallOrderHistory();
  try {
    const result = await (dependencies.listOrders || listTtmallOrders)(access.binding.source, access.binding.token, {
      page: 1,
      limit: ORDER_PAGE_SIZE,
      timeoutMs: ORDER_READ_TIMEOUT_MS,
    });
    const canonicalImages = await readCanonicalProductImages(access, dependencies);
    const orders = Array.isArray(result?.orders) ? result.orders.map((order) => mapTtmallOrder(order, canonicalImages)).filter((order) => order.id) : [];
    return {
      ok: true,
      provider: "ttmall",
      account: { provider: "TTMall", linked: true },
      orders,
      hasMore: Number(result?.total || 0) > orders.length,
    };
  } catch (error) {
    await markStaleBindingForOrderRead(error, access, dependencies);
    throw normalizeOrderReadError(error);
  }
}

export async function getTtmallProfileOrderDetail(user = {}, orderId = "", dependencies = {}) {
  const access = await resolveTtmallOrderAccess(user, dependencies);
  if (!isEnabledTtmallAccess(access)) return null;
  if (!access.binding) throwOrderNotFound();
  try {
    const order = await (dependencies.getOrder || getTtmallOrder)(access.binding.source, access.binding.token, safeString(orderId), {
      timeoutMs: ORDER_READ_TIMEOUT_MS,
    });
    const mapped = mapTtmallOrder(order, await readCanonicalProductImages(access, dependencies));
    if (!mapped.id || mapped.id !== safeString(orderId)) throwOrderNotFound();
    return { ok: true, provider: "ttmall", order: mapped };
  } catch (error) {
    await markStaleBindingForOrderRead(error, access, dependencies);
    if (error?.publicCode === "TTMALL_ORDER_NOT_FOUND") throwOrderNotFound();
    throw normalizeOrderReadError(error);
  }
}

async function resolveTtmallOrderAccess(user, dependencies) {
  const userId = safeString(user?.id);
  const userSiteId = safeString(user?.site_id || user?.siteId);
  const siteSlug = safeString(user?.site_slug || user?.siteSlug);
  if (!userId || !userSiteId || !siteSlug) throw createPublicError("Please sign in first.", 401, "AUTH_REQUIRED");
  const resolved = await (dependencies.resolveSiteAccess || resolveTtmallRuntimeAccess)(siteSlug);
  if (!isEnabledTtmallAccess(resolved)) return { mode: "not_ttmall", binding: null };
  if (safeString(resolved?.site?.id) !== userSiteId) {
    throw createPublicError("This account site is unavailable.", 409, "TTMALL_ORDER_SITE_UNAVAILABLE");
  }
  const bindingState = await (dependencies.getBinding || getTtmallAccountBinding)({ userId, siteSlug });
  if (bindingState?.mode !== "ttmall") return { mode: "not_ttmall", binding: null };
  const binding = await (dependencies.ensureBinding || ensureActiveTtmallBinding)({ userId, siteSlug });
  return {
    mode: "ttmall",
    runtimeMode: resolved.runtimeMode,
    source: resolved.source,
    userId,
    siteSlug,
    binding,
    site: resolved.site,
  };
}

async function markStaleBindingForOrderRead(error, access, dependencies) {
  if (error?.publicCode !== "TTMALL_BINDING_REAUTH_REQUIRED" || !access?.binding?.site?.id) return;
  await (dependencies.markStale || markTtmallAccountBindingStale)({
    userId: access.userId,
    siteId: access.binding.site.id,
    errorCode: "orders_token_rejected",
  });
}

function emptyTtmallOrderHistory() {
  return { ok: true, provider: "ttmall", account: { provider: "TTMall", linked: false }, orders: [], hasMore: false };
}

async function readCanonicalProductImages(access, dependencies = {}) {
  try {
    const rows = await (dependencies.listCachedProducts || listCachedProductRows)(access.site.id);
    const images = new Map();
    for (const row of mapCachedProducts(rows)) {
      const productId = normalizeTtmallProductId(row?.payload?.productId || row?.payload?.id || row?.external_product_key);
      const imageUrl = safeHttpUrl(row?.payload?.imageUrl || row?.image_url);
      if (productId && imageUrl && !images.has(productId)) images.set(productId, imageUrl);
    }
    return images;
  } catch {
    // Product-cache media is an optional same-site correction for a provider
    // thumbnail. Order history must remain readable if that cache is stale.
    return new Map();
  }
}

function mapTtmallOrder(order = {}, canonicalImages = new Map()) {
  const state = safeString(order?.state).toUpperCase();
  const currencyCode = resolveTtmallOrderSettlementCurrency(order?.currencyCode);
  const total = toMoney(order?.totalAmount, currencyCode);
  const items = Array.isArray(order?.items) ? order.items.map((item) => ({
    title: safeString(item?.title).slice(0, 255),
    variantTitle: safeString(item?.option).slice(0, 255),
    quantity: Math.max(0, Math.min(99, Math.trunc(Number(item?.quantity) || 0))),
    imageUrl: canonicalImages.get(normalizeTtmallProductId(item?.productId)) || safeHttpUrl(item?.image),
    unitPrice: toMoney(item?.unitPrice, currencyCode),
  })).filter((item) => item.title) : [];
  const trackingNumber = safeString(order?.tracking).slice(0, 512);
  const shippingMethod = safeString(order?.shippingMethod).slice(0, 128);
  return {
    id: safeString(order?.orderNumber),
    name: safeString(order?.orderNumber),
    createdAt: toIsoDate(order?.createdAt),
    financialStatus: mapFinancialStatus(state),
    fulfillmentStatus: state || "UNKNOWN",
    total,
    pricing: {
      subtotal: toMoney(order?.orderAmount, currencyCode),
      discount: null,
      shipping: toMoney(order?.shippingFee, currencyCode),
      tax: null,
      total,
    },
    shipments: trackingNumber || shippingMethod ? [{
      status: state || "UNKNOWN",
      tracking: [{ company: shippingMethod, number: trackingNumber, url: "" }].filter((item) => item.company || item.number),
    }] : [],
    itemSummary: items.map((item) => `${item.title}${item.quantity ? ` × ${item.quantity}` : ""}`).join(" · "),
    hasMoreItems: false,
    items,
  };
}

function normalizeTtmallProductId(value) {
  const id = safeString(value);
  return /^\d{1,20}$/.test(id) ? id : "";
}

function safeHttpUrl(value) {
  try {
    const url = new URL(safeString(value));
    return url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function mapFinancialStatus(value) {
  if (["PAID", "PAYMENT_SUCCESS", "SUCCESS"].includes(value)) return "PAID";
  if (["REFUNDED", "PARTIALLY_REFUNDED"].includes(value)) return "REFUNDED";
  if (["CANCELLED", "CANCELED", "VOIDED", "CLOSED"].includes(value)) return "VOIDED";
  return "PENDING";
}

function toIsoDate(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return "";
  const timestamp = numeric > 1e12 ? numeric : numeric * 1000;
  const date = new Date(timestamp);
  return Number.isFinite(date.getTime()) ? date.toISOString() : "";
}

function toMoney(value, currencyCode) {
  const amount = safeString(value).trim();
  return /^\d{1,12}(\.\d{1,2})?$/.test(amount) && currencyCode ? { amount, currencyCode } : null;
}

function normalizeCurrencyCode(value) {
  const currencyCode = safeString(value).trim().toUpperCase();
  return /^[A-Z]{3}$/.test(currencyCode) ? currencyCode : "";
}

function resolveTtmallOrderSettlementCurrency(value) {
  const providerCurrencyCode = normalizeCurrencyCode(value);
  if (!providerCurrencyCode) return TTMALL_ORDER_SETTLEMENT_CURRENCY;
  return providerCurrencyCode === TTMALL_ORDER_SETTLEMENT_CURRENCY ? providerCurrencyCode : "";
}

function normalizeOrderReadError(error) {
  if (error?.publicCode === "TTMALL_BINDING_REAUTH_REQUIRED") return createPublicError("Please reconnect your TTMall account and try again.", 409, "TTMALL_BINDING_REAUTH_REQUIRED");
  if (error?.publicCode === "TTMALL_ORDER_NOT_FOUND") return error;
  return createPublicError("TTMall orders are temporarily unavailable. Please try again later.", 502, "TTMALL_ORDER_UPSTREAM_FAILED");
}

function throwOrderNotFound() {
  throw createPublicError("Order not found.", 404, "TTMALL_ORDER_NOT_FOUND");
}
