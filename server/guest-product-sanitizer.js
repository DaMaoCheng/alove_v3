import { publicProductCandidateFields } from "../shared/product-candidate-fields.js";
import { normalizeProductAttributeEvidence } from "./product-attribute-evidence-service.js";
import { validateProductSourceErrorCode } from "./product-source-error-service.js";
import { getServerProductOrigins } from "./product-source-provenance.js";
import { normalizeProductEdition } from "./product-edition-service.js";

const MAX_TEXT_LENGTH = 240;

// Request-local catalogue evidence never enters public JSON or persists across
// clones. Serialized snapshots isolate it from later mutations of either side.
const guestProductEvidence = new WeakMap();

export function getGuestProductEvidence(product) {
  const proof = product && typeof product === "object" && guestProductEvidence.get(product);
  if (!proof) return product;
  try {
    return JSON.stringify(product) === proof.safeSnapshot ? JSON.parse(proof.sourceSnapshot) : product;
  } catch { return product; }
}

function bindGuestProductEvidence(product, source) {
  try {
    guestProductEvidence.set(product, { safeSnapshot: JSON.stringify(product), sourceSnapshot: JSON.stringify(source) });
  } catch { /* Non-JSON sources cannot grant private evidence. */ }
  return product;
}

export function toGuestSafeProductSearchResult(result = {}, { includeAttributeEvidence = false, sourceItems = result.items } = {}) {
  const allowedOrigins = getServerProductOrigins(result);
  const sourceObjects = new Set(Array.isArray(result.items) ? result.items : []);
  return {
    ok: result.ok !== false,
    query: safeText(result.query, MAX_TEXT_LENGTH),
    searchState: safeText(result.searchState, 32),
    searchOutcome: safeText(result.searchOutcome, 32),
    sourceErrorCode: validateProductSourceErrorCode(result.sourceErrorCode),
    site: toGuestSafeSite(result.site),
    items: (Array.isArray(sourceItems) ? sourceItems : []).filter(item => sourceObjects.has(item))
      .map((item) => {
        const product = toGuestSafeProduct(item, result.site, { allowedOrigins, includeAttributeEvidence });
        return result.searchOutcome === "matched" ? bindGuestProductEvidence(product, item) : product;
      })
      .filter((item) => item.name && item.url && !containsGuestPromotionContent(item)),
  };
}

export function toGuestSafeResolvedProduct(result = {}) {
  const sourceItem = result.sourceItem && typeof result.sourceItem === "object" ? result.sourceItem : null;
  const allowedOrigins = getServerProductOrigins(result);
  const safeItem = sourceItem ? toGuestSafeProduct(sourceItem, result.site, { allowedOrigins }) : toGuestSafeProduct({}, result.site);
  return {
    ok: result.ok !== false,
    query: safeText(result.query, MAX_TEXT_LENGTH),
    site: toGuestSafeSite(result.site),
    item: !safeItem.url || containsGuestPromotionContent(safeItem) ? toGuestSafeProduct({}, result.site) : safeItem,
  };
}

export function toGuestSafeKitshopResult(result = {}) {
  const allowedOrigins = getServerProductOrigins(result);
  const safeSite = toGuestSafeSite(result.site);
  return {
    ok: result.ok !== false,
    site: safeSite,
    shelves: (Array.isArray(result.shelves) ? result.shelves : []).map((shelf) => ({
      key: safeText(shelf?.key, 64),
      title: safeText(shelf?.title, 128),
      items: (Array.isArray(shelf?.items) ? shelf.items : [])
        .map((item) => toGuestSafeProduct(item, result.site, { allowedOrigins }))
        .filter((item) => item.name && !containsGuestPromotionContent(item)),
    })),
    cache: {
      refreshed: false,
      stale: result.cache?.stale === true,
      lastSyncedAt: safeText(result.cache?.lastSyncedAt, 64),
    },
    error: safeText(result.error, MAX_TEXT_LENGTH),
    warning: safeText(result.warning, MAX_TEXT_LENGTH),
  };
}

export function containsGuestPromotionContent(value) {
  for (const text of collectStringValues(value)) {
    const decoded = safeDecode(text);
    const normalized = decoded.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ");
    if (/\b(?:code|discount|promo|coupon|voucher)\b/i.test(normalized)) return true;
    if (/\b\d{1,3}\s*%\s*off\b/i.test(normalized)) return true;
    if (/\bsave\s*\d{1,3}\b/i.test(normalized)) return true;
    if (hasPromotionQueryKey(decoded)) return true;
  }
  return false;
}

function hasPromotionQueryKey(value = "") {
  const text = String(value || "").trim();
  if (!text.includes("?") && !text.includes("&")) return false;
  try {
    const url = new URL(text, "https://guest-product.invalid");
    for (const key of url.searchParams.keys()) {
      const normalizedKey = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
      if (/(?:code|discount|promo|coupon|voucher)/.test(normalizedKey)) return true;
    }
  } catch {
    return false;
  }
  return false;
}

export function toGuestSafeProduct(product = {}, site = null, { allowedOrigins = [], includeAttributeEvidence = false } = {}) {
  const safeSite = toGuestSafeSite(site);
  const trustedOrigins = new Set((Array.isArray(allowedOrigins) ? allowedOrigins : []).map((value) => String(value || "").trim()).filter(Boolean));
  const productUrl = safeExternalUrl(product.url, safeSite, trustedOrigins);
  return {
    id: safeText(product.id || product.productId, 128),
    productId: safeText(product.productId || product.id, 128),
    name: safeText(product.name || product.title, 255),
    canonicalEdition: normalizeProductEdition(product.canonicalEdition),
    ...publicProductCandidateFields(product),
    ...(includeAttributeEvidence ? { attributeEvidence: normalizeProductAttributeEvidence(product.attributeEvidence) } : {}),
    price: safeText(product.price || product.priceNow, 64),
    priceNow: safeText(product.priceNow || product.price, 64),
    stock: safeText(product.stock, 128),
    available: product.available === true ? true : product.available === false ? false : null,
    url: productUrl,
    imageUrl: safeImageUrl(product.imageUrl, safeSite, trustedOrigins),
    imageUrls: uniqueStrings(product.imageUrls).map((value) => safeImageUrl(value, safeSite, trustedOrigins)).filter(Boolean).slice(0, 8),
    sizes: sanitizeSizes(product.sizes, safeSite, trustedOrigins),
    sizeChart: sanitizeSizeChart(product.sizeChart),
    customizationOptions: sanitizeCustomizationOptions(product.customizationOptions, safeSite, trustedOrigins),
    paymentMethods: Array.isArray(safeSite?.paymentMethods) ? safeSite.paymentMethods : [],
    commerceEnabled: safeSite?.commerceEnabled !== false,
    siteId: safeSite?.id || "",
    siteSlug: safeSite?.slug || "",
    fetchedAt: safeText(product.fetchedAt || product.livePriceFetchedAt, 64),
    sizeChartResolved: product.sizeChartResolved === true,
    purchaseMode: safeText(product.purchaseMode, 32),
  };
}

function sanitizeSizeChart(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const columns = Array.isArray(value.columns) ? value.columns.map((item) => safeText(item, 80)).filter(Boolean).slice(0, 8) : [];
  const rows = Array.isArray(value.rows)
    ? value.rows.map((row) => Array.isArray(row) ? row.map((item) => safeText(item, 80)).slice(0, columns.length) : []).filter((row) => row.length >= 2).slice(0, 24)
    : [];
  if (columns.length < 2 || !rows.length) return null;
  return { title: safeText(value.title, 120) || "Size Chart", fitTip: safeText(value.fitTip, 240), unit: safeText(value.unit, 24), columns, rows };
}

function sanitizeCustomizationOptions(options = [], site = null, allowedOrigins = new Set()) {
  return (Array.isArray(options) ? options : []).map((option) => {
    if (!option || typeof option !== "object" || Array.isArray(option)) return null;
    const values = (Array.isArray(option.values) ? option.values : []).map((value) => ({
      id: safeText(value?.id, 128),
      label: safeText(value?.label || value?.value || value?.name, 255),
      price: Number(value?.price) > 0 ? Number(value.price) : 0,
      imageUrl: safeImageUrl(value?.imageUrl || value?.image_url, site, allowedOrigins),
    })).filter((value) => value.id && value.label).slice(0, 100);
    const type = safeText(option.type, 32);
    if (!safeText(option.id, 128) || !safeText(option.name, 255)) return null;
    if (!values.length && !["text", "number", "date", "email", "phone", "file"].includes(type)) return null;
    return {
      id: safeText(option.id, 128),
      name: safeText(option.name, 255),
      type,
      required: option.required === true,
      placeholder: safeText(option.placeholder, 255),
      price: Number(option.price) > 0 ? Number(option.price) : 0,
      values,
    };
  }).filter(Boolean).slice(0, 24);
}

function toGuestSafeSite(site = null) {
  if (!site || typeof site !== "object") return null;
  return {
    id: safeText(site.id, 64),
    name: safeText(site.name, 128),
    slug: safeText(site.slug, 96),
    currency: safeText(site.currency, 16),
    siteUrl: safeUrl(site.siteUrl),
    storefrontUrl: safeUrl(site.storefrontUrl),
    logoUrl: safeUrl(site.logoUrl),
    paymentMethods: Array.isArray(site.paymentMethods) ? site.paymentMethods.slice(0, 12) : [],
    commerceEnabled: site.commerceEnabled !== false,
  };
}

function sanitizeSizes(sizes = [], site = null, allowedOrigins = new Set()) {
  return (Array.isArray(sizes) ? sizes : []).map((size) => ({
    label: safeText(size?.label || size?.name || size?.title, 64),
    available: size?.available === true ? true : size?.available === false ? false : null,
    price: safeText(size?.price, 64),
    variantId: safeText(size?.variantId || size?.variant_id, 128),
    buyUrl: safeExternalUrl(size?.buyUrl || size?.buy_url, site, allowedOrigins),
  })).filter((size) => size.label).slice(0, 12);
}

function safeExternalUrl(value = "", site = null, allowedOrigins = new Set()) {
  const url = safeUrl(value);
  if (!url) return "";
  const siteUrl = safeUrl(site?.storefrontUrl || site?.siteUrl);
  if (!siteUrl) return "";
  if (url.startsWith("/")) return url;
  try {
    const origin = new URL(url).origin;
    return origin === new URL(siteUrl).origin || allowedOrigins.has(origin) ? url : "";
  } catch {
    return "";
  }
}

function safeImageUrl(value = "", site = null, allowedOrigins = new Set()) {
  const url = safeUrl(value);
  if (!url) return "";
  if (url.startsWith("/")) return url;
  const siteUrl = safeUrl(site?.storefrontUrl || site?.siteUrl);
  try {
    const imageOrigin = new URL(url);
    const siteOrigin = siteUrl ? new URL(siteUrl).origin : "";
    if (siteOrigin && imageOrigin.origin === siteOrigin) return url;
    if (allowedOrigins.has(imageOrigin.origin)) return url;
    if (imageOrigin.protocol === "https:" && imageOrigin.hostname === "cdn.shopify.com") return url;
    return "";
  } catch {
    return "";
  }
}

function safeUrl(value = "") {
  const text = String(value || "").trim();
  if (!text) return "";
  if (text.includes("\\") || text.startsWith("//")) return "";
  try {
    const url = new URL(text);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : "";
  } catch {
    return /^\/(?![\/\\])/.test(text) ? text.slice(0, 512) : "";
  }
}

function uniqueStrings(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || "").trim()).filter(Boolean))];
}

function safeText(value = "", maxLength = MAX_TEXT_LENGTH) {
  return String(value == null ? "" : value).trim().slice(0, maxLength);
}

function collectStringValues(value, output = []) {
  if (typeof value === "string") {
    output.push(value);
    return output;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStringValues(item, output);
    return output;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectStringValues(item, output);
  }
  return output;
}

function safeDecode(value = "") {
  try {
    return decodeURIComponent(String(value || ""));
  } catch {
    return String(value || "");
  }
}
