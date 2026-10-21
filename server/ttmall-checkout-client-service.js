import { createPublicError } from "./public-error-utils.js";
import { safeString } from "./product-source-shared-service.js";
import { fetchTtmallCheckoutUserJson } from "./ttmall-bound-user-client-service.js";

const MAX_ADDRESS_TEXT_LENGTH = 255;
const MAX_ORDER_MESSAGE_LENGTH = 500;
const TRUSTED_TTMALL_PAYMENT_HOSTS = new Set([
  "paypal.com",
  "www.paypal.com",
  "taotens.com",
  "www.taotens.com",
]);
const SENSITIVE_PAYMENT_PARAMETER_PATTERN = /(?:^|_)(?:card|cc|cvv|cvc|security|expiration|expiry|exp_month|exp_year)(?:_|$)/i;

export async function listTtmallAddresses(source, token, { timeoutMs } = {}) {
  const payload = await fetchTtmallCheckoutUserJson(source, token, "/v1/address", { timeoutMs });
  return listPayload(payload).map(mapAddress).filter((address) => address.id);
}

export async function listTtmallAddressRegions(source, token, { timeoutMs } = {}) {
  const payload = await fetchTtmallCheckoutUserJson(source, token, "/v1/zone", { timeoutMs });
  return listPayload(payload).map(mapZone).filter((zone) => zone.id && zone.countries.length);
}

export async function createTtmallAddress(source, token, input = {}, { timeoutMs } = {}) {
  const body = normalizeAddressInput(input, { requireZone: true });
  const payload = await fetchTtmallCheckoutUserJson(source, token, "/v1/address", { method: "POST", body, timeoutMs });
  return mapAddress(readData(payload));
}

export async function updateTtmallAddress(source, token, addressId, input = {}, { timeoutMs } = {}) {
  const id = normalizeId(addressId, "TTMALL_ADDRESS_INVALID");
  const body = normalizeAddressInput(input, { requireZone: false });
  const payload = await fetchTtmallCheckoutUserJson(source, token, `/v1/address/${encodeURIComponent(id)}`, { method: "PUT", body, timeoutMs });
  return mapAddress(readData(payload));
}

export async function deleteTtmallAddress(source, token, addressId, { timeoutMs } = {}) {
  const id = normalizeId(addressId, "TTMALL_ADDRESS_INVALID");
  await fetchTtmallCheckoutUserJson(source, token, `/v1/address/${encodeURIComponent(id)}`, { method: "DELETE", timeoutMs });
  return { id };
}

export async function listTtmallShippingMethods(source, token, { countryId, addressId, cartHash, cartLineIds, timeoutMs } = {}) {
  const normalizedCountryId = normalizeId(countryId, "TTMALL_ADDRESS_INVALID");
  const normalizedAddressId = normalizeId(addressId, "TTMALL_ADDRESS_INVALID");
  const hash = safeString(cartHash);
  const checkList = normalizeIdList(cartLineIds, "TTMALL_CART_SELECTION_INVALID");
  if (!hash || !checkList.length) throw createPublicError("Your TTMall cart could not be verified. Please return to your cart and try again.", 409, "TTMALL_CART_SELECTION_INVALID");
  const payload = await fetchTtmallCheckoutUserJson(source, token, "/v1/shipping", {
    timeoutMs,
    searchParams: {
      country_id: normalizedCountryId,
      address_id: normalizedAddressId,
      hash,
      check_list: JSON.stringify(checkList),
    },
  });
  return listPayload(payload).map(mapShipping).filter((shipping) => shipping.id);
}

export async function listTtmallPaymentMethods(source, token, { productIds, shippingAddressId, amount = "", timeoutMs } = {}) {
  const products = normalizeIdList(productIds, "TTMALL_CART_SELECTION_INVALID");
  const addressId = normalizeId(shippingAddressId, "TTMALL_ADDRESS_INVALID");
  const payload = await fetchTtmallCheckoutUserJson(source, token, "/v1/payment", {
    timeoutMs,
    searchParams: {
      type: "order",
      product_ids: products.join(","),
      shipping_address_id: addressId,
      amount: normalizeOptionalMoney(amount),
    },
  });
  return listPayload(payload).map(mapPayment).filter((payment) => payment.id);
}

// ShowDoc #665 combines TTMall order creation and payment initiation. Keep
// this narrow mapper separate from the cart client so the checkout allowlist
// remains the only place allowed to submit an order.
export async function createTtmallOrderWithPayment(source, token, {
  cartHash,
  cartLineIds,
  shippingAddressId,
  shippingId,
  paymentId,
  zoneId,
  countryId,
  stateId,
  billingAddressId = "",
  message = "",
  timeoutMs,
} = {}) {
  const hash = safeString(cartHash);
  const checkList = normalizeIdList(cartLineIds, "TTMALL_CART_SELECTION_INVALID");
  const normalizedShippingAddressId = normalizeId(shippingAddressId, "TTMALL_ADDRESS_INVALID");
  const normalizedBillingAddressId = normalizeId(billingAddressId || normalizedShippingAddressId, "TTMALL_ADDRESS_INVALID");
  if (!hash || !checkList.length) throw createPublicError("Your TTMall cart could not be verified. Please return to your cart and try again.", 409, "TTMALL_CART_SELECTION_INVALID");
  const payload = await fetchTtmallCheckoutUserJson(source, token, "/v1/order/generate_order_to_pay", {
    method: "POST",
    bodyEncoding: "form",
    includeOrderResponseDiagnostic: true,
    timeoutMs,
    body: {
      hash,
      check_list: JSON.stringify(checkList),
      shipping_address_id: normalizedShippingAddressId,
      billing_address_id: normalizedBillingAddressId,
      shipping_id: normalizeId(shippingId, "TTMALL_SHIPPING_INVALID"),
      payment_id: normalizeId(paymentId, "TTMALL_PAYMENT_INVALID"),
      zone_id: normalizeId(zoneId, "TTMALL_ADDRESS_REGION_INCOMPLETE"),
      country_id: normalizeId(countryId, "TTMALL_ADDRESS_REGION_INCOMPLETE"),
      state_id: normalizeId(stateId, "TTMALL_ADDRESS_REGION_INCOMPLETE"),
      ...(safeString(message) ? { message: safeString(message).slice(0, MAX_ORDER_MESSAGE_LENGTH) } : {}),
    },
  });
  const orderResponse = unwrapOrderResponse(payload);
  const data = readData(orderResponse.payload);
  const orderNumber = normalizeOrderNumber(data?.order_number || data?.orderNumber);
  const nextCartHash = safeString(data?.cart_hash || data?.cartHash);
  const type = normalizePaymentType(data?.type);
  const rawRedirectUrl = safeString(data?.redirect_link || data?.redirectUrl);
  const redirectUrl = safeTtmallPaymentRedirectUrl(rawRedirectUrl);
  const paymentOutcome = resolvePaymentOutcome({
    rawRedirectUrl,
    redirectUrl,
    succeed: data?.succeed,
    orderNumber,
  });
  if (!paymentOutcome) {
    throw createOrderResponseInvalidError(orderResponse.ttmallCheckoutDiagnostic, orderResponse.payload, data);
  }
  return {
    type,
    orderNumber,
    nextCartHash,
    redirectUrl,
    redirectUnavailable: Boolean(rawRedirectUrl && !redirectUrl),
    state: safeString(data?.state).slice(0, 80),
    // A provider payment message may contain HTML, URLs, or checkout secrets.
    // The browser only needs a validated redirect URL, never this raw text.
    message: "",
    cartConsumed: true,
    paymentOutcome,
    confirmationLevel: paymentOutcome === "redirect"
      ? "payment_redirected"
      : (paymentOutcome === "succeeded"
        ? "payment_succeeded"
        : (paymentOutcome === "failed" ? "payment_failed" : "payment_pending")),
  };
}

function resolvePaymentOutcome({ rawRedirectUrl = "", redirectUrl = "", succeed, orderNumber = "" } = {}) {
  // TTMall's documented result contract is intentionally resolved in this
  // order: a valid redirect continues payment there; otherwise an explicit
  // succeed flag is the terminal payment result. Legacy type/cart fields do
  // not establish payment completion on their own.
  if (redirectUrl) return "redirect";
  if (isExplicitProviderSuccess(succeed)) return "succeeded";
  if (isExplicitProviderFailure(succeed)) return "failed";
  // Order creation and payment completion are separate facts. TTMall may
  // return an order number before it has a redirect or a terminal payment
  // result; retain that confirmed order as pending rather than calling it an
  // invalid response and inviting a duplicate checkout.
  if (normalizeOrderNumber(orderNumber)) return "pending";
  if (rawRedirectUrl) return "";
  return "";
}

export function normalizeTtmallCheckoutDiagnostic(value = {}) {
  const row = value && typeof value === "object" ? value : {};
  const status = Number(row.upstreamHttpStatus);
  const outcome = safeString(row.upstreamOutcome);
  return {
    upstreamHttpStatus: Number.isInteger(status) && status >= 100 && status <= 599 ? status : null,
    upstreamOutcome: ["transport_unknown", "http_unconfirmed", "invalid_json", "business_rejection", "schema_mismatch"].includes(outcome) ? outcome : "transport_unknown",
    upstreamBusinessCode: normalizeProviderBusinessCode(row.upstreamBusinessCode),
    upstreamResponseShape: normalizeResponseShape(row.upstreamResponseShape),
    upstreamSafeMessage: normalizeDiagnosticMessage(row.upstreamSafeMessage),
  };
}

function unwrapOrderResponse(value) {
  const row = value && typeof value === "object" ? value : {};
  return {
    payload: row.isTtmallOrderResponseEnvelope === true ? row.payload : value,
    ttmallCheckoutDiagnostic: normalizeTtmallCheckoutDiagnostic(row.isTtmallOrderResponseEnvelope === true ? row.ttmallCheckoutDiagnostic : null),
  };
}

function createOrderResponseInvalidError(baseDiagnostic, payload, data) {
  const error = createPublicError("TTMall returned an incomplete order result. Please do not retry yet.", 409, "TTMALL_ORDER_RESPONSE_INVALID");
  error.ttmallCheckoutDiagnostic = normalizeTtmallCheckoutDiagnostic({
    ...baseDiagnostic,
    upstreamOutcome: "schema_mismatch",
    upstreamBusinessCode: readProviderBusinessCode(payload, data),
    upstreamResponseShape: mergeResponseShape(baseDiagnostic?.upstreamResponseShape, payload, data),
    upstreamSafeMessage: readProviderSafeMessage(payload, data),
  });
  return error;
}

function readProviderBusinessCode(payload, data) {
  return firstDefinedProviderValue(data, payload, ["code", "error_code", "errorCode", "status_code", "statusCode"]);
}

function readProviderSafeMessage(payload, data) {
  return firstDefinedProviderValue(data, payload, ["message", "msg", "error_message", "errorMessage", "description", "error"]);
}

function firstDefinedProviderValue(data, payload, keys) {
  for (const source of [data, payload]) {
    if (!source || typeof source !== "object") continue;
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(source, key)) return source[key];
    }
  }
  return "";
}

function mergeResponseShape(baseShape, payload, data) {
  const parts = [normalizeResponseShape(baseShape)];
  const top = describeKnownResponseFields(payload);
  const nested = describeKnownResponseFields(data);
  if (top) parts.push(`top:${top}`);
  if (nested) parts.push(`data:${nested}`);
  return parts.filter(Boolean).join(";");
}

function describeKnownResponseFields(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const known = ["succeed", "code", "error_code", "errorCode", "status_code", "statusCode", "message", "msg", "error_message", "errorMessage", "description", "order_number", "orderNumber", "cart_hash", "cartHash", "type", "redirect_link", "redirectUrl", "data"];
  return known.filter((key) => Object.prototype.hasOwnProperty.call(value, key)).join(",");
}

function normalizeProviderBusinessCode(value) {
  const code = safeString(value).trim();
  return /^[A-Za-z0-9_.-]{1,64}$/.test(code) ? code : "";
}

function normalizeResponseShape(value) {
  const shape = safeString(value).trim();
  return /^[A-Za-z0-9_:+,;.-]{1,500}$/.test(shape) ? shape : "";
}

function normalizeDiagnosticMessage(value) {
  const raw = safeString(value);
  if (!raw || /[<>\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(raw)) return "";
  const cleaned = raw
    .replace(/\bhttps?:\/\/\S+/gi, "")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "")
    .replace(/\b(?:bearer|authorization|token|hash|cart_hash|session(?:_id)?)\b\s*(?:[:=]?\s*)?[A-Za-z0-9._~+\/-]{4,}\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.slice(0, 500);
}

export async function listTtmallOrders(source, token, { page = 1, limit = 20, state = "", timeoutMs } = {}) {
  const payload = await fetchTtmallCheckoutUserJson(source, token, "/v1/order", {
    timeoutMs,
    searchParams: { page: clampInteger(page, 1, 10000, 1), limit: clampInteger(limit, 1, 20, 20), state: safeString(state).slice(0, 32) },
  });
  const data = readData(payload);
  return {
    total: clampInteger(data?.count, 0, Number.MAX_SAFE_INTEGER, 0),
    orders: listPayload(data).map(mapOrder).filter((order) => order.orderNumber),
  };
}

export async function getTtmallOrder(source, token, orderNumber, { timeoutMs } = {}) {
  const normalized = normalizeOrderNumber(orderNumber);
  if (!normalized) throw createPublicError("The requested TTMall order is unavailable.", 404, "TTMALL_ORDER_NOT_FOUND");
  const payload = await fetchTtmallCheckoutUserJson(source, token, `/v1/order/${encodeURIComponent(normalized)}`, { timeoutMs });
  const order = mapOrder(readData(payload));
  if (!order.orderNumber || order.orderNumber !== normalized) throw createPublicError("The requested TTMall order is unavailable.", 404, "TTMALL_ORDER_NOT_FOUND");
  return order;
}

function normalizeAddressInput(input = {}, { requireZone } = {}) {
  const result = {
    country_id: normalizeId(input.countryId || input.country_id, "TTMALL_ADDRESS_INVALID"),
    firstname: requiredText(input.firstName || input.firstname, "TTMALL_ADDRESS_INVALID"),
    lastname: requiredText(input.lastName || input.lastname, "TTMALL_ADDRESS_INVALID"),
    line: requiredText(input.line, "TTMALL_ADDRESS_INVALID"),
    postcode: requiredText(input.postcode, "TTMALL_ADDRESS_INVALID"),
    phone: requiredText(input.phone, "TTMALL_ADDRESS_INVALID"),
    email: requiredEmail(input.email),
  };
  const zone = safeString(input.zoneId || input.zone_id);
  if (requireZone) result.zone_id = normalizeId(zone, "TTMALL_ADDRESS_INVALID");
  else if (zone) result.zone_id = normalizeId(zone, "TTMALL_ADDRESS_INVALID");
  const optional = {
    state_id: safeString(input.stateId || input.state_id),
    tag: safeString(input.tag),
    address_invoice: safeString(input.addressInvoice || input.address_invoice),
    city: safeString(input.city),
    identification_code: safeString(input.identificationCode || input.identification_code),
  };
  for (const [key, value] of Object.entries(optional)) if (value) result[key] = value.slice(0, MAX_ADDRESS_TEXT_LENGTH);
  if (input.isDefault === true || input.is_default === true || input.isDefault === 1 || input.is_default === 1) result.is_default = 1;
  return result;
}

function mapAddress(value = {}) {
  const row = value && typeof value === "object" ? value : {};
  return {
    id: safeString(row.address_id || row.id),
    zoneId: safeString(row.zone_id), countryId: safeString(row.country_id), stateId: safeString(row.state_id),
    tag: safeString(row.tag).slice(0, 64), firstName: safeString(row.firstname).slice(0, 128), lastName: safeString(row.lastname).slice(0, 128),
    line: safeString(row.line).slice(0, 255), addressInvoice: safeString(row.address_invoice).slice(0, 255),
    postcode: safeString(row.postcode).slice(0, 64), city: safeString(row.city).slice(0, 128),
    phone: safeString(row.phone).slice(0, 64), email: safeString(row.email).slice(0, 254),
    country: safeString(row.country).slice(0, 128), state: safeString(row.state).slice(0, 128),
    isDefault: Number(row.is_default) === 1,
  };
}

function mapZone(value = {}) {
  const zone = value && typeof value === "object" ? value : {};
  return { id: safeString(zone.zone_id || zone.id), name: safeString(zone.zone_name || zone.name).slice(0, 128), countries: listPayload(zone.countries || zone.country_list).map((country) => ({
    id: safeString(country?.country_id || country?.id), name: safeString(country?.country_name || country?.country || country?.name).slice(0, 128), code: safeString(country?.country_code || country?.iso_code).slice(0, 8),
    states: listPayload(country?.states || country?.state_list).map((state) => ({ id: safeString(state?.state_id || state?.id), name: safeString(state?.state_name || state?.state || state?.name).slice(0, 128), code: safeString(state?.state_code || state?.code).slice(0, 16) })).filter((state) => state.id),
  })).filter((country) => country.id) };
}

function mapShipping(value = {}) {
  const row = value && typeof value === "object" ? value : {};
  return { id: safeString(row.shipping_id || row.id), name: safeString(row.shipping_name || row.name).slice(0, 128), description: safeString(row.description).slice(0, 240), price: safeString(row.price).slice(0, 32), remotePrice: safeString(row.price_remote).slice(0, 32), expectedTime: safeString(row.expect_time).slice(0, 240), expectedDays: safeString(row.expect_day).slice(0, 64), isRemote: Number(row.is_remote) === 1, logo: safeHttpUrl(row.logo) };
}

function mapPayment(value = {}) {
  const row = value && typeof value === "object" ? value : {};
  const requiresSensitiveInput = hasSensitivePaymentParameter(row.payment_param)
    || row.requires_sensitive_input === true
    || row.requires_sensitive_input === 1
    || row.requires_sensitive_input === "1";
  return { id: safeString(row.payment_id || row.id), name: safeString(row.payment_name || row.name).slice(0, 128), description: safeString(row.payment_description || row.description).slice(0, 240), logo: safeHttpUrl(row.payment_logo || row.logo), chargeRate: safeString(row.charge_rate).slice(0, 32), discountRate: safeString(row.discount_rate).slice(0, 32), lowerLimit: safeString(row.lower_limit).slice(0, 32), upperLimit: safeString(row.upper_limit).slice(0, 32), requiresBillingAddress: Number(row.require_billing_address_id) === 1, requiresSensitiveInput };
}

function hasSensitivePaymentParameter(value) {
  let parameters = value;
  if (typeof parameters === "string") {
    try { parameters = JSON.parse(parameters); } catch { return true; }
  }
  if (!parameters || typeof parameters !== "object" || Array.isArray(parameters)) return false;
  return Object.keys(parameters).some((key) => SENSITIVE_PAYMENT_PARAMETER_PATTERN.test(safeString(key).replace(/[-\s]+/g, "_")));
}

function mapOrder(value = {}) {
  const row = value && typeof value === "object" ? value : {};
  return { orderNumber: normalizeOrderNumber(row.order_number || row.orderNumber), state: safeString(row.order_state_en || row.state).slice(0, 64), createdAt: Number(row.create_time) || 0, paidAt: Number(row.pay_time) || 0, shippingAt: Number(row.shipping_time) || 0, orderAmount: safeString(row.order_amount).slice(0, 32), shippingFee: safeString(row.shipping_fee).slice(0, 32), totalAmount: safeString(row.total_amount).slice(0, 32), currencyCode: normalizeCurrencyCode(row.currency_code || row.currency || row.currencyCode), tracking: safeString(row.tracking_num).slice(0, 512), shippingMethod: safeString(row.shipping_method).slice(0, 128), items: listPayload(row.product_list).slice(0, 50).map((item) => ({ productId: normalizeOrderProductId(item?.product_id || item?.productId || item?.id), title: safeString(item?.product_title).slice(0, 255), image: safeHttpUrl(item?.product_image || item?.image || item?.cover), quantity: clampInteger(item?.product_quantity, 1, 99, 1), option: safeString(item?.product_option).slice(0, 255), unitPrice: safeString(item?.product_price).slice(0, 32), totalPrice: safeString(item?.product_total_price).slice(0, 32) })) };
}

function readData(payload = {}) { return payload?.data && typeof payload.data === "object" ? payload.data : {}; }
function listPayload(payload = {}) { const data = payload?.data && typeof payload.data === "object" ? payload.data : payload; return Array.isArray(data) ? data : (Array.isArray(data?.list) ? data.list : (Array.isArray(data?.rows) ? data.rows : [])); }
function normalizeId(value, code) { const id = safeString(value); if (!/^\d{1,12}$/.test(id)) throw createPublicError("Please choose a valid TTMall option.", 400, code); return id; }
function normalizeIdList(values, code) { const raw = Array.isArray(values) ? values : []; const ids = [...new Set(raw.map((value) => safeString(value)).filter((value) => /^\d{1,12}$/.test(value)))]; if (!ids.length || ids.length !== raw.length) throw createPublicError("Your TTMall cart could not be verified. Please return to your cart and try again.", 409, code); return ids.slice(0, 20); }
function normalizeOrderNumber(value) { const number = safeString(value); return /^[A-Za-z0-9_-]{4,128}$/.test(number) ? number : ""; }
function normalizeOrderProductId(value) { const id = safeString(value); return /^\d{1,20}$/.test(id) ? id : ""; }
function normalizeCurrencyCode(value) { const code = safeString(value).trim().toUpperCase(); return /^[A-Z]{3}$/.test(code) ? code : ""; }
function normalizePaymentType(value) { const type = Number(value); return [1, 2, 3].includes(type) ? type : 0; }
function isExplicitProviderSuccess(value) { return value === true || value === 1 || value === "1" || value === "true"; }
function isExplicitProviderFailure(value) { return value === false || value === 0 || value === "0" || value === "false"; }
function requiredText(value, code) { const text = safeString(value).trim(); if (!text || text.length > MAX_ADDRESS_TEXT_LENGTH) throw createPublicError("Please complete the required address fields.", 400, code); return text; }
function requiredEmail(value) { const email = safeString(value).toLowerCase(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw createPublicError("Please enter a valid email address.", 400, "TTMALL_ADDRESS_INVALID"); return email; }
function normalizeOptionalMoney(value) { const text = safeString(value); return /^\d{1,8}(\.\d{1,2})?$/.test(text) ? text : ""; }
function clampInteger(value, min, max, fallback) { const number = Math.trunc(Number(value)); return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback; }
function safeHttpUrl(value) { try { const url = new URL(safeString(value)); return url.protocol === "https:" ? url.toString() : ""; } catch { return ""; } }
function safeTtmallPaymentRedirectUrl(value) {
  try {
    const url = new URL(safeString(value));
    const hostname = url.hostname.toLowerCase();
    const isTrusted = TRUSTED_TTMALL_PAYMENT_HOSTS.has(hostname)
      || hostname.endsWith(".taotens.com")
      || hostname.endsWith(".paypal.com");
    return url.protocol === "https:" && isTrusted ? url.toString() : "";
  } catch {
    return "";
  }
}
