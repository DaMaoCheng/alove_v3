import { createPublicError } from "./public-error-utils.js";
import { fetchSafeProductSourceBytes } from "./product-source-http-service.js";
import { safeString } from "./product-source-shared-service.js";

const MAX_RESPONSE_BYTES = 512 * 1024;
const TTMALL_ORDER_REQUEST_TIMEOUT_MS = 15_000;

export async function fetchTtmallBoundUserJson(source, token, pathname, { method = "GET", body = null, timeoutMs } = {}) {
  return fetchTtmallBoundUserJsonWithPolicy(source, token, pathname, { method, body, timeoutMs }, isCartOrAddressReadPath);
}

// Checkout code receives a separate, fixed route policy. Keeping it apart from
// cart access prevents a future checkout endpoint from silently widening the
// established cart surface.
export async function fetchTtmallCheckoutUserJson(source, token, pathname, { method = "GET", body = null, bodyEncoding = "json", timeoutMs, searchParams = null, includeOrderResponseDiagnostic = false } = {}) {
  const normalizedMethod = String(method || "GET").toUpperCase();
  const isOrderCreation = normalizedMethod === "POST" && pathname === "/v1/order/generate_order_to_pay";
  return fetchTtmallBoundUserJsonWithPolicy(source, token, pathname, {
    method: normalizedMethod,
    body,
    bodyEncoding,
    timeoutMs: isOrderCreation ? resolveOrderRequestTimeout(timeoutMs) : timeoutMs,
    searchParams,
    includeOrderResponseDiagnostic: isOrderCreation && includeOrderResponseDiagnostic,
  }, isCheckoutPath);
}

async function fetchTtmallBoundUserJsonWithPolicy(source, token, pathname, { method = "GET", body = null, bodyEncoding = "json", timeoutMs, searchParams = null, includeOrderResponseDiagnostic = false } = {}, isAllowedPath) {
  const accessToken = safeString(token);
  const apiBaseUrl = safeString(source?.apiBaseUrl);
  if (!accessToken || !apiBaseUrl) throw createPublicError("Please reconnect your TTMall account and try again.", 409, "TTMALL_BINDING_REAUTH_REQUIRED");
  const url = new URL(pathname, `${apiBaseUrl}/`);
  for (const [key, value] of Object.entries(searchParams || {})) {
    const normalized = safeString(value);
    if (normalized) url.searchParams.set(key, normalized);
  }
  if (url.origin !== new URL(apiBaseUrl).origin || !isAllowedPath(url.pathname, String(method || "GET").toUpperCase())) {
    throw createPublicError("This TTMall test action is unavailable.", 400, "TTMALL_USER_API_PATH_INVALID");
  }
  const isOrderCreation = String(method || "GET").toUpperCase() === "POST" && pathname === "/v1/order/generate_order_to_pay";
  let response;
  const requestBody = body == null ? null : serializeRequestBody(body, bodyEncoding);
  try {
    response = await fetchSafeProductSourceBytes(url, {
      timeoutMs,
      maxBytes: MAX_RESPONSE_BYTES,
      method,
      body: requestBody,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        ...(body == null ? {} : { "Content-Type": normalizeBodyEncoding(bodyEncoding) === "form" ? "application/x-www-form-urlencoded;charset=UTF-8" : "application/json" }),
        "User-Agent": "AIOVE TTMall local checkout",
      },
    });
  } catch {
    throw createCheckoutOrderError("TTMall checkout could not be confirmed. Please do not retry yet.", "TTMALL_CHECKOUT_STATUS_UNKNOWN", isOrderCreation ? createOrderDiagnostic({ outcome: "transport_unknown" }) : null);
  }
  if (response.status === 401 || response.status === 403) {
    throw createCheckoutOrderError("Please reconnect your TTMall account and try again.", "TTMALL_BINDING_REAUTH_REQUIRED", isOrderCreation ? createOrderDiagnostic({ status: response.status, outcome: "http_unconfirmed", contentType: response.contentType }) : null);
  }
  if (!response.ok && (isOrderCreation || response.status === 408 || response.status === 429 || response.status >= 500)) {
    throw createCheckoutOrderError("TTMall checkout could not be confirmed. Please do not retry yet.", "TTMALL_CHECKOUT_STATUS_UNKNOWN", isOrderCreation ? createOrderDiagnostic({ status: response.status, outcome: "http_unconfirmed", contentType: response.contentType }) : null);
  }
  if (!response.ok) {
    throw createPublicError("TTMall checkout is temporarily unavailable. Please try again later.", 503, "TTMALL_CHECKOUT_UPSTREAM_UNAVAILABLE");
  }
  try {
    const payload = JSON.parse(response.buffer.toString("utf8"));
    if (includeOrderResponseDiagnostic) {
      return {
        isTtmallOrderResponseEnvelope: true,
        payload,
        ttmallCheckoutDiagnostic: createOrderDiagnostic({ status: response.status, outcome: "schema_mismatch", contentType: response.contentType }),
      };
    }
    return payload;
  } catch {
    throw createCheckoutOrderError("TTMall checkout returned an invalid response. Please do not retry yet.", "TTMALL_CHECKOUT_RESPONSE_INVALID", isOrderCreation ? createOrderDiagnostic({ status: response.status, outcome: "invalid_json", contentType: response.contentType }) : null);
  }
}

function createCheckoutOrderError(message, code, diagnostic = null) {
  const error = createPublicError(message, 409, code);
  if (diagnostic) error.ttmallCheckoutDiagnostic = diagnostic;
  return error;
}

function createOrderDiagnostic({ status = null, outcome = "transport_unknown", contentType = "" } = {}) {
  return {
    upstreamHttpStatus: Number.isInteger(Number(status)) && Number(status) >= 100 && Number(status) <= 599 ? Number(status) : null,
    upstreamOutcome: ["transport_unknown", "http_unconfirmed", "invalid_json", "schema_mismatch"].includes(outcome) ? outcome : "transport_unknown",
    upstreamBusinessCode: "",
    upstreamResponseShape: `content:${normalizeResponseContentType(contentType)}`,
    upstreamSafeMessage: "",
  };
}

function normalizeResponseContentType(value) {
  const type = safeString(value).toLowerCase();
  if (type === "application/json" || type.endsWith("+json")) return "json";
  if (type === "text/html") return "html";
  if (type === "text/plain") return "text";
  return "other";
}

function serializeRequestBody(body, bodyEncoding) {
  if (normalizeBodyEncoding(bodyEncoding) !== "form") return JSON.stringify(body);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("TTMall form payload must be an object");
  return new URLSearchParams(Object.entries(body).map(([key, value]) => [safeString(key), safeString(value)])).toString();
}

function normalizeBodyEncoding(value) {
  return safeString(value).toLowerCase() === "form" ? "form" : "json";
}

function resolveOrderRequestTimeout(value) {
  const requested = Number(value);
  if (!Number.isFinite(requested)) return TTMALL_ORDER_REQUEST_TIMEOUT_MS;
  return Math.max(1_000, Math.min(30_000, Math.trunc(requested)));
}

function isCartOrAddressReadPath(pathname, method) {
  return (method === "GET" && pathname === "/v1/address")
    || (method === "POST" && pathname === "/v1/cart")
    || (method === "POST" && pathname === "/v1/cart/clear")
    || (method === "GET" && /^\/v1\/cart\/[A-Za-z0-9_-]{1,255}$/.test(pathname) && pathname !== "/v1/cart/checkpaypal");
}

function isCheckoutPath(pathname, method) {
  if (pathname === "/v1/address") return method === "GET" || method === "POST";
  if (/^\/v1\/address\/\d{1,12}$/.test(pathname)) return method === "GET" || method === "PUT" || method === "DELETE";
  if (pathname === "/v1/zone") return method === "GET";
  if (pathname === "/v1/shipping") return method === "GET";
  if (pathname === "/v1/payment") return method === "GET";
  if (pathname === "/v1/order") return method === "GET";
  if (pathname === "/v1/order/generate_order_to_pay") return method === "POST";
  return method === "GET" && /^\/v1\/order\/[A-Za-z0-9_-]{1,128}$/.test(pathname);
}
