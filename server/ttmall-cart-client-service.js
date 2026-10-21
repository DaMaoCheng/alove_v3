import { fetchTtmallApiJson } from "./product-source-ttmall-client-service.js";
import { safeString } from "./product-source-shared-service.js";
import { fetchTtmallBoundUserJson } from "./ttmall-bound-user-client-service.js";

const MAX_QUANTITY = 99;

export async function addTtmallCartLine(source, { productId = "", sku = "", quantity = 1, options = [], hash = "", timeoutMs, userToken = "" } = {}) {
  const normalizedProductId = normalizeProductId(productId);
  const normalizedSku = normalizeSku(sku);
  if (!normalizedProductId || !normalizedSku) throw new Error("TTMall cart line is missing a product or SKU");
  const payload = {
    id: normalizedProductId,
    list: JSON.stringify([{ sku: normalizedSku, quantity: normalizeQuantity(quantity), option: normalizeOptions(options) }]),
    is_temp: 1,
    ...(safeString(hash) ? { hash: safeString(hash) } : {}),
  };
  return normalizeCartResponse(await fetchTtmallCartJson(source, "/v1/cart", {
    timeoutMs,
    method: "POST",
    body: payload,
  }, userToken));
}

export async function clearTtmallCart(source, { hash = "", timeoutMs, userToken = "" } = {}) {
  const normalizedHash = safeString(hash);
  if (!normalizedHash) return { hash: "", itemCount: 0 };
  const summary = normalizeTtmallCartSummary(await fetchTtmallCartJson(source, "/v1/cart/clear", {
    timeoutMs,
    method: "POST",
    body: { hash: normalizedHash },
  }, userToken));
  // TTMall's clear response can omit the unchanged cart hash. The caller already
  // owns this identity, so preserve it without ever returning it to the browser.
  return { ...summary, hash: summary.hash || normalizedHash };
}

export async function getTtmallCart(source, { hash = "", timeoutMs, userToken = "" } = {}) {
  const normalizedHash = safeString(hash);
  if (!normalizedHash) return { hash: "", itemCount: 0 };
  const summary = normalizeTtmallCartSummary(await fetchTtmallCartJson(source, `/v1/cart/${encodeURIComponent(normalizedHash)}`, { timeoutMs }, userToken));
  // The documented cart-read response places rows and quantity directly under
  // data and omits hash. The caller supplied an already-owned server-side hash.
  return { ...summary, hash: summary.hash || normalizedHash };
}

async function fetchTtmallCartJson(source, pathname, options, userToken) {
  return safeString(userToken)
    ? fetchTtmallBoundUserJson(source, userToken, pathname, options)
    : fetchTtmallApiJson(source, pathname, options);
}

export function normalizeTtmallCartSummary(payload = {}) {
  const data = payload?.data && typeof payload.data === "object" ? payload.data : payload;
  const cart = data?.cart && typeof data.cart === "object" ? data.cart : data;
  const rows = Array.isArray(cart?.rows)
    ? cart.rows
    : (Array.isArray(cart?.list) ? cart.list : (Array.isArray(data?.rows) ? data.rows : (Array.isArray(data?.list) ? data.list : [])));
  const quantity = Number(cart?.quantity ?? data?.quantity);
  return {
    hash: safeString(data?.hash || cart?.hash),
    itemCount: Number.isFinite(quantity) ? Math.max(0, Math.trunc(quantity)) : rows.reduce((sum, row) => sum + normalizeQuantity(row?.quantity || 1), 0),
    lines: normalizeTtmallCartLines(rows),
  };
}

function normalizeTtmallCartLines(rows = []) {
  return rows.map((row) => ({
    // `id` is the cart-row identity required by TTMall's check_list. It is
    // intentionally server-only; the browser never receives cart hashes or
    // provider cart-row IDs.
    cartLineId: normalizeCartLineId(row?.id || row?.cart_id || row?.cart_item_id),
    productId: normalizeProductId(row?.product_id || row?.productId),
    sku: normalizeSku(row?.sku),
    quantity: normalizeQuantity(row?.quantity || 1),
  })).filter((row) => row.sku);
}

function normalizeCartResponse(payload) {
  const summary = normalizeTtmallCartSummary(payload);
  if (!summary.hash) throw new Error("TTMall cart response is missing a cart identity");
  return summary;
}

function normalizeProductId(value) {
  const id = safeString(value);
  return /^\d{1,12}$/.test(id) ? id : "";
}

function normalizeCartLineId(value) {
  const id = safeString(value);
  return /^\d{1,12}$/.test(id) ? id : "";
}

function normalizeSku(value) {
  return safeString(value).slice(0, 160);
}

function normalizeQuantity(value) {
  const quantity = Math.trunc(Number(value) || 1);
  return Math.max(1, Math.min(MAX_QUANTITY, quantity));
}

function normalizeOptions(value) {
  return Array.isArray(value) ? value.slice(0, 20) : [];
}
