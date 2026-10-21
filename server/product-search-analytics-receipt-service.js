import { createHmac, timingSafeEqual } from "node:crypto";
import { SERVER_CONFIG } from "./config.js";

const RECEIPT_VERSION = 2;
const RECEIPT_MAX_AGE_SECONDS = 30 * 60;
const CATALOG_SOURCES = new Set(["search", "kitshop"]);

export function createProductSearchAnalyticsReceipt({ userId = "", siteId = "", siteSlug = "", product = {}, now = Date.now() } = {}) {
  return createProductCatalogAnalyticsReceipt({
    userId,
    siteId,
    siteSlug,
    product,
    source: "search",
    now,
  });
}

export function createProductCatalogAnalyticsReceipt({ userId = "", siteId = "", siteSlug = "", product = {}, source = "", now = Date.now() } = {}) {
  const payload = {
    v: RECEIPT_VERSION,
    uid: safeText(userId, 64),
    sid: safeText(siteId, 64),
    slug: safeText(siteSlug, 96),
    src: normalizeCatalogSource(source),
    pid: safeText(product.id || product.productId, 128),
    title: safeText(product.name || product.title, 255),
    url: safeText(product.url, 512),
    iat: Math.floor(Number(now) / 1000),
  };
  if (!payload.uid || !payload.sid || !payload.slug || !payload.src || (!payload.pid && !payload.url)) return "";
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encoded}.${sign(encoded)}`;
}

export function verifyProductSearchAnalyticsReceipt(receipt = "", { userId = "", now = Date.now() } = {}) {
  return verifyProductCatalogAnalyticsReceipt(receipt, { userId, now });
}

export function verifyProductCatalogAnalyticsReceipt(receipt = "", { userId = "", now = Date.now() } = {}) {
  const [encoded, signature, ...extra] = safeText(receipt, 4096).split(".");
  if (!encoded || !signature || extra.length || !safeEqual(signature, sign(encoded))) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    const ageSeconds = Math.floor(Number(now) / 1000) - Number(payload.iat);
    if (![1, RECEIPT_VERSION].includes(payload.v) || payload.uid !== safeText(userId, 64)) return null;
    if (!Number.isFinite(ageSeconds) || ageSeconds < -60 || ageSeconds > RECEIPT_MAX_AGE_SECONDS) return null;
    const trusted = {
      userId: safeText(payload.uid, 64),
      siteId: safeText(payload.sid, 64),
      siteSlug: safeText(payload.slug, 96),
      source: payload.v === 1 ? "search" : normalizeCatalogSource(payload.src),
      product: {
        id: safeText(payload.pid, 128),
        name: safeText(payload.title, 255),
        url: safeText(payload.url, 512),
      },
    };
    return trusted.siteId && trusted.siteSlug && trusted.source && (trusted.product.id || trusted.product.url) ? trusted : null;
  } catch {
    return null;
  }
}

function normalizeCatalogSource(value = "") {
  const source = safeText(value, 32).toLowerCase();
  return CATALOG_SOURCES.has(source) ? source : "";
}

function sign(value) {
  const secret = SERVER_CONFIG.productApi.secretKey || SERVER_CONFIG.guestChat.networkPepper;
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function safeText(value = "", max = 512) {
  return String(value == null ? "" : value).trim().slice(0, max);
}
