import { SERVER_CONFIG } from "./config.js";
import { normalizeDiscountCode } from "./shopify-discount-link-service.js";
import { parseShopifyAdminSource, resolveShopifyAdminToken } from "./product-source-shopify-admin-service.js";

const ACTIVE_STATUS = "ACTIVE";

export async function validateShopifyDiscountCode(site = {}, code = "", {
  fetchImpl = globalThis.fetch,
  timeoutMs = SERVER_CONFIG.productApi.timeoutMs,
  accessToken = "",
} = {}) {
  const normalizedCode = normalizeDiscountCode(code);
  const source = parseShopifyAdminSource(site.product_api_url || site.productApiUrl || "");
  const token = String(accessToken || "").trim() || (source
    ? resolveShopifyAdminToken(source.tokenEnv, site.product_access_token_encrypted || site.productAccessTokenEncrypted || "")
    : "");
  if (!normalizedCode || !source || !token || typeof fetchImpl !== "function") {
    return { valid: false, code: normalizedCode, status: "", reason: "unavailable" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, Number(timeoutMs || 3000)));
  try {
    const response = await fetchImpl(source.endpoint, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": "AIOVE Shopify Discount Validator",
        "X-Shopify-Access-Token": token,
      },
      body: JSON.stringify({ query: DISCOUNT_STATUS_QUERY, variables: { code: normalizedCode } }),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || (Array.isArray(payload.errors) && payload.errors.length)) {
      return { valid: false, code: normalizedCode, status: "", reason: "unavailable" };
    }
    const status = String(payload?.data?.codeDiscountNodeByCode?.codeDiscount?.status || "").trim().toUpperCase();
    return {
      valid: status === ACTIVE_STATUS,
      code: normalizedCode,
      status,
      reason: status === ACTIVE_STATUS ? "active" : (status ? "inactive" : "not_found"),
    };
  } catch {
    return { valid: false, code: normalizedCode, status: "", reason: "unavailable" };
  } finally {
    clearTimeout(timer);
  }
}

const DISCOUNT_STATUS_QUERY = `
query AioveDiscountCodeStatus($code: String!) {
  codeDiscountNodeByCode(code: $code) {
    codeDiscount {
      __typename
      ... on DiscountCodeBasic { status }
      ... on DiscountCodeBxgy { status }
      ... on DiscountCodeFreeShipping { status }
      ... on DiscountCodeApp { status }
    }
  }
}`;
