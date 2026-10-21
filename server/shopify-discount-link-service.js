import { createPublicError } from "./public-error-utils.js";

const MAX_CODE_LENGTH = 64;

export function buildShopifyDiscountLink({ code = "", targetUrl = "", storefrontUrl = "" } = {}) {
  const normalizedCode = normalizeDiscountCode(code);
  if (!normalizedCode) throw createPublicError("折扣码格式不正确", 400, "DISCOUNT_CODE_INVALID");
  const target = resolveSameOriginTarget(targetUrl, storefrontUrl);
  target.searchParams.set("discount", normalizedCode);
  target.hash = "";
  return target.toString();
}

export function buildShopifyNoDiscountLink({ targetUrl = "", storefrontUrl = "" } = {}) {
  const target = resolveSameOriginTarget(targetUrl, storefrontUrl);
  target.searchParams.set("discount", "");
  target.hash = "";
  return target.toString();
}

export function resolveTrustedCheckoutStorefrontUrl(site = {}, sourceProduct = {}) {
  const explicitStorefront = normalizeHttpUrl(site.siteUrl);
  if (explicitStorefront) return explicitStorefront;

  const configuredStorefront = normalizeHttpUrl(site.storefrontUrl);
  const trustedProductUrl = normalizeHttpUrl(sourceProduct.url);
  if (trustedProductUrl && (!configuredStorefront || isShopifyAdminDomain(configuredStorefront))) {
    return new URL(trustedProductUrl).origin;
  }
  return configuredStorefront;
}

export function resolveSameOriginTarget(targetUrl = "", storefrontUrl = "") {
  const target = parseHttpUrl(targetUrl, "商品购买链接");
  const storefront = parseHttpUrl(storefrontUrl, "站点购买地址");
  if (target.origin !== storefront.origin) {
    throw createPublicError("商品购买链接不属于当前站点", 400, "PRODUCT_CHECKOUT_ORIGIN_INVALID");
  }
  if (!target.pathname || target.pathname === "/") {
    throw createPublicError("商品购买链接无效", 400, "PRODUCT_CHECKOUT_URL_INVALID");
  }
  return target;
}

export function normalizeDiscountCode(value = "") {
  const code = String(value || "").trim();
  if (!code || code.length > MAX_CODE_LENGTH || !/^[a-z0-9][a-z0-9_-]*$/i.test(code)) return "";
  return code;
}

function parseHttpUrl(value, label) {
  try {
    const url = new URL(String(value || "").trim());
    if (!/^https?:$/.test(url.protocol)) throw new Error("protocol");
    return url;
  } catch {
    throw createPublicError(`${label}无效`, 400, "PRODUCT_CHECKOUT_URL_INVALID");
  }
}

function normalizeHttpUrl(value = "") {
  try {
    const url = new URL(String(value || "").trim());
    return /^https?:$/.test(url.protocol) ? url.toString().replace(/\/$/, "") : "";
  } catch {
    return "";
  }
}

function isShopifyAdminDomain(value = "") {
  try {
    return new URL(value).hostname.toLowerCase().endsWith(".myshopify.com");
  } catch {
    return false;
  }
}
