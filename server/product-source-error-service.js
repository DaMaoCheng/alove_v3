export const PRODUCT_SOURCE_ERROR_CODE = Object.freeze({
  MARKET_CURRENCY_MISMATCH: "market_currency_mismatch",
  MARKET_COUNTRY_AMBIGUOUS: "market_country_ambiguous",
  CREDENTIALS_UNAVAILABLE: "credentials_unavailable",
  AUTH_FAILED: "auth_failed",
  TIMEOUT: "timeout",
  RATE_LIMITED: "rate_limited",
  SOURCE_UNCONFIGURED: "source_unconfigured",
  SOURCE_NETWORK: "source_network",
  SOURCE_INTERNAL: "source_internal",
});

const allowedCodes = new Set(Object.values(PRODUCT_SOURCE_ERROR_CODE));
const allowedProviders = new Set(["shopify", "ttmall", "http"]);
const errorMessages = Object.freeze({
  market_currency_mismatch: "Shopify Markets currency is not available",
  market_country_ambiguous: "Shopify Markets found multiple countries or an unavailable country",
  credentials_unavailable: "Product source access token is unavailable",
  auth_failed: "Product source authentication failed",
  timeout: "Product source request timed out",
  rate_limited: "Product source rate limit reached",
  source_unconfigured: "Product source is not configured",
  source_network: "Product source network request failed",
  source_internal: "Product source request failed",
});

export function validateProductSourceErrorCode(value) {
  return typeof value === "string" && allowedCodes.has(value) ? value : "";
}

export function createProductSourceError(code, { provider = "", statusCode = 0 } = {}) {
  const safeCode = validateProductSourceErrorCode(code) || PRODUCT_SOURCE_ERROR_CODE.SOURCE_INTERNAL;
  const error = new Error(errorMessages[safeCode]);
  error.name = "ProductSourceError";
  error.code = safeCode;
  error.provider = allowedProviders.has(provider) ? provider : "";
  error.statusCode = normalizeStatusCode(statusCode);
  return error;
}

// Only allowlisted metadata crosses the source boundary; never return raw
// upstream messages, response bodies, request URLs, or credential headers.
export function normalizeProductSourceError(error, { provider = "" } = {}) {
  const statusCode = normalizeStatusCode(error?.statusCode || error?.status)
    || normalizeStatusCode(String(error?.message || "").match(/\bHTTP\s+(\d{3})\b/i)?.[1]);
  let code = validateProductSourceErrorCode(error?.code);
  if (!code) {
    if (statusCode === 401 || statusCode === 403) code = PRODUCT_SOURCE_ERROR_CODE.AUTH_FAILED;
    else if (statusCode === 429) code = PRODUCT_SOURCE_ERROR_CODE.RATE_LIMITED;
    else if ([408, 504].includes(statusCode) || ["AbortError", "TimeoutError"].includes(error?.name)
      || ["ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT"].includes(error?.code || error?.cause?.code)) code = PRODUCT_SOURCE_ERROR_CODE.TIMEOUT;
    else if (["ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "EAI_AGAIN", "UND_ERR_SOCKET"].includes(error?.code || error?.cause?.code)
      || (error?.name === "TypeError" && /fetch failed|network/i.test(String(error?.message || "")))) code = PRODUCT_SOURCE_ERROR_CODE.SOURCE_NETWORK;
    else code = PRODUCT_SOURCE_ERROR_CODE.SOURCE_INTERNAL;
  }
  return {
    code,
    provider: allowedProviders.has(error?.provider) ? error.provider : allowedProviders.has(provider) ? provider : "",
    statusCode,
  };
}

export function createProductSourceGraphqlError(errors = [], { provider = "" } = {}) {
  const codes = (Array.isArray(errors) ? errors : []).map((item) => String(item?.extensions?.code || "").toUpperCase());
  const code = codes.includes("THROTTLED") ? PRODUCT_SOURCE_ERROR_CODE.RATE_LIMITED
    : codes.some((value) => ["ACCESS_DENIED", "UNAUTHORIZED", "FORBIDDEN"].includes(value)) ? PRODUCT_SOURCE_ERROR_CODE.AUTH_FAILED
      : PRODUCT_SOURCE_ERROR_CODE.SOURCE_INTERNAL;
  return createProductSourceError(code, { provider });
}

function normalizeStatusCode(value) {
  const status = Number(value);
  return Number.isInteger(status) && status >= 100 && status <= 599 ? status : 0;
}
