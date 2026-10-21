import { SERVER_CONFIG } from "./config.js";
import { encryptSecret } from "./security.js";
import { isUnsafeConfiguredProductSourceUrl } from "./product-source-http-service.js";
import {
  nullableText,
  safeString,
  throwUserError,
} from "./admin-site-shared.js";

export function normalizeProductSourcePayload(payload = {}) {
  const rawType = safeString(payload.productSourceType || payload.product_source_type);
  const productSourceType = ["shopify_admin", "ttmall"].includes(rawType) ? rawType : "";
  const productApiVersion = normalizeApiVersion(payload.productApiVersion || payload.product_api_version || SERVER_CONFIG.productApi.shopifyAdminApiVersion);
  const productShopDomain = productSourceType === "shopify_admin"
    ? normalizeShopifyAdminDomain(payload.productShopDomain || payload.product_shop_domain || inferShopifyAdminDomain(payload.productApiUrl || payload.product_api_url))
    : "";
  if (productSourceType === "shopify_admin" && !productShopDomain) {
    throwUserError("Shopify 店铺域名不能为空");
  }
  const ttmallApiBaseUrl = productSourceType === "ttmall"
    ? normalizeTtmallApiBaseUrl(payload.productTtmallApiBaseUrl || payload.product_ttmall_api_base_url || inferTtmallSource(payload.productApiUrl || payload.product_api_url)?.apiBaseUrl)
    : "";
  const ttmallWebsiteId = productSourceType === "ttmall"
    ? normalizeTtmallWebsiteId(payload.productTtmallWebsiteId || payload.product_ttmall_website_id || inferTtmallSource(payload.productApiUrl || payload.product_api_url)?.websiteId)
    : "";
  const productApiUrl = productSourceType === "shopify_admin"
    ? buildShopifyAdminSourceUrl(productShopDomain, productApiVersion)
    : productSourceType === "ttmall"
      ? buildTtmallSourceUrl(ttmallApiBaseUrl, ttmallWebsiteId)
      : nullableText(payload.productApiUrl || payload.product_api_url, 512);
  if (!productSourceType && productApiUrl && isUnsafeConfiguredProductSourceUrl(productApiUrl)) {
    throwUserError("商品库 API 必须是可公开访问的 http/https 地址");
  }
  const accessToken = productSourceType === "shopify_admin"
    ? safeString(payload.productAccessToken || payload.product_access_token)
    : "";
  return {
    productApiUrl,
    productSourceType,
    productShopDomain,
    productApiVersion: productSourceType === "shopify_admin" ? productApiVersion : "",
    productTtmallApiBaseUrl: ttmallApiBaseUrl,
    productTtmallWebsiteId: ttmallWebsiteId,
    shouldUpdateProductAccessToken: productSourceType !== "shopify_admin" || Boolean(accessToken),
    productAccessTokenEncrypted: accessToken ? encryptSecret(accessToken, SERVER_CONFIG.productApi.secretKey) : "",
  };
}

export function inferProductSourceType(productApiUrl = "") {
  if (inferShopifyAdminDomain(productApiUrl)) return "shopify_admin";
  if (inferTtmallSource(productApiUrl)) return "ttmall";
  return "";
}

export function inferTtmallSource(productApiUrl = "") {
  const text = safeString(productApiUrl);
  if (!text) return null;
  try {
    const url = new URL(text);
    if (url.protocol !== "ttmall:") return null;
    const hostname = safeString(url.hostname).toLowerCase();
    const port = safeString(url.port);
    const websiteId = normalizeTtmallWebsiteId(url.searchParams.get("websiteId"), { throwOnInvalid: false });
    if (!hostname || !websiteId) return null;
    return {
      apiBaseUrl: `https://${hostname}${port ? `:${port}` : ""}`,
      websiteId,
    };
  } catch {
    return null;
  }
}

export function inferShopifyAdminDomain(productApiUrl = "") {
  const text = safeString(productApiUrl);
  if (!text) return "";
  try {
    const url = new URL(text);
    if (url.protocol !== "shopify-admin:") return "";
    return normalizeShopifyAdminDomain(url.hostname || url.pathname);
  } catch {
    return "";
  }
}

function buildShopifyAdminSourceUrl(shopDomain = "", apiVersion = "") {
  const domain = normalizeShopifyAdminDomain(shopDomain);
  const version = normalizeApiVersion(apiVersion);
  return domain ? `shopify-admin://${domain}?version=${encodeURIComponent(version)}` : "";
}

function buildTtmallSourceUrl(apiBaseUrl = "", websiteId = "") {
  const baseUrl = new URL(normalizeTtmallApiBaseUrl(apiBaseUrl));
  return `ttmall://${baseUrl.host}?websiteId=${encodeURIComponent(normalizeTtmallWebsiteId(websiteId))}`;
}

function normalizeTtmallApiBaseUrl(value = "") {
  const text = safeString(value);
  if (!text) throwUserError("TTMall API Base URL 不能为空");
  try {
    const url = new URL(text);
    if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
      throw new Error("invalid");
    }
    if (isUnsafeConfiguredProductSourceUrl(url.toString())) throw new Error("unsafe");
    return url.origin;
  } catch {
    throwUserError("TTMall API Base URL 必须是可公开访问的 HTTPS 根地址");
  }
}

function normalizeTtmallWebsiteId(value = "", { throwOnInvalid = true } = {}) {
  const text = safeString(value);
  if (/^[1-9]\d{0,9}$/.test(text)) return text;
  if (throwOnInvalid) throwUserError("TTMall 网站 ID 必须是正整数");
  return "";
}

function normalizeShopifyAdminDomain(value = "") {
  const text = safeString(value)
    .replace(/^https?:\/\//i, "")
    .replace(/^shopify-admin:\/\//i, "")
    .replace(/\/.*$/, "")
    .toLowerCase();
  if (!text) return "";
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(text)) throwUserError("Shopify 店铺域名必须是 xxx.myshopify.com");
  return text;
}

function normalizeApiVersion(value = "") {
  const text = safeString(value);
  return /^\d{4}-\d{2}$/.test(text) ? text : SERVER_CONFIG.productApi.shopifyAdminApiVersion;
}
