import { decryptSecret, encryptSecret } from "./security.js";
import { SERVER_CONFIG } from "./config.js";

const HANDOFF_VERSION = 1;
const HANDOFF_TTL_MS = 10 * 60 * 1000;
const MAX_TOKEN_LENGTH = 4096;
const MAX_PAGE_URL_LENGTH = 512;
const MAX_PAGE_TITLE_LENGTH = 240;
const PAGE_TYPES = new Set(["home", "category", "product", "page"]);
const PRODUCT_ID_PATTERN = /\/productdetail\/[^/]+\/(\d{1,20})(?:\/)?$/i;

export function normalizeExternalSourcePage({ sourceUrl = "", sourceTitle = "", expectedOrigin = "" } = {}) {
  const origin = normalizeOrigin(expectedOrigin);
  if (!origin) return null;
  const rawUrl = String(sourceUrl || "").trim();
  if (!rawUrl || /[\u0000-\u001f\\]/.test(rawUrl)) return null;

  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (!isWebProtocol(url.protocol) || url.origin !== origin || url.username || url.password) return null;
  const pathname = normalizePathname(url.pathname);
  if (!pathname || pathname.length > MAX_PAGE_URL_LENGTH) return null;
  const sourcePageUrl = `${origin}${pathname}`;
  const sourceProductId = normalizeProductId(pathname.match(PRODUCT_ID_PATTERN)?.[1]);
  return {
    sourcePageUrl,
    sourcePageTitle: normalizePageTitle(sourceTitle),
    sourcePageType: classifyPageType(pathname, Boolean(sourceProductId)),
    sourceProductId,
  };
}

export function createExternalSourceHandoffToken({
  publicId = "",
  siteId = "",
  siteSlug = "",
  mascotCharacterId = "",
  sourceOrigin = "",
  page = null,
  issuedAtMs = Date.now(),
} = {}) {
  const normalizedPage = page && typeof page === "object" ? page : null;
  const origin = normalizeOrigin(sourceOrigin);
  const issuedAt = Number(issuedAtMs);
  if (!safeId(publicId) || !safeId(siteId) || !safeId(siteSlug) || !safeId(mascotCharacterId)
    || !origin || !normalizedPage?.sourcePageUrl || !Number.isFinite(issuedAt)) return "";
  const payload = {
    v: HANDOFF_VERSION,
    iat: Math.floor(issuedAt),
    exp: Math.floor(issuedAt + HANDOFF_TTL_MS),
    publicId: safeId(publicId),
    siteId: safeId(siteId),
    siteSlug: safeId(siteSlug),
    mascotCharacterId: safeId(mascotCharacterId),
    sourceOrigin: origin,
    sourcePageUrl: String(normalizedPage.sourcePageUrl).slice(0, MAX_PAGE_URL_LENGTH),
    sourcePageTitle: normalizePageTitle(normalizedPage.sourcePageTitle),
    sourcePageType: PAGE_TYPES.has(normalizedPage.sourcePageType) ? normalizedPage.sourcePageType : "page",
    sourceProductId: normalizeProductId(normalizedPage.sourceProductId),
  };
  const token = encryptSecret(JSON.stringify(payload), handoffSecret());
  return token.length <= MAX_TOKEN_LENGTH ? token : "";
}

export function parseExternalSourceHandoffToken(token = "", { nowMs = Date.now() } = {}) {
  const raw = String(token || "").trim();
  if (!raw || raw.length > MAX_TOKEN_LENGTH) return null;
  let payload;
  try {
    payload = JSON.parse(decryptSecret(raw, handoffSecret()));
  } catch {
    return null;
  }
  const now = Number(nowMs);
  const issuedAt = Number(payload?.iat);
  const expiresAt = Number(payload?.exp);
  if (payload?.v !== HANDOFF_VERSION || !Number.isFinite(now)
    || !Number.isFinite(issuedAt) || !Number.isFinite(expiresAt)
    || issuedAt > now + 60_000 || expiresAt <= now || expiresAt - issuedAt > HANDOFF_TTL_MS + 60_000) {
    return null;
  }
  const sourceOrigin = normalizeOrigin(payload?.sourceOrigin);
  const sourcePage = normalizeExternalSourcePage({
    sourceUrl: payload?.sourcePageUrl,
    sourceTitle: payload?.sourcePageTitle,
    expectedOrigin: sourceOrigin,
  });
  if (!sourceOrigin || !sourcePage || !safeId(payload?.publicId) || !safeId(payload?.siteId)
    || !safeId(payload?.siteSlug) || !safeId(payload?.mascotCharacterId)) return null;
  return {
    v: HANDOFF_VERSION,
    iat: issuedAt,
    exp: expiresAt,
    publicId: safeId(payload.publicId),
    siteId: safeId(payload.siteId),
    siteSlug: safeId(payload.siteSlug),
    mascotCharacterId: safeId(payload.mascotCharacterId),
    sourceOrigin,
    ...sourcePage,
  };
}

export function buildExternalSourceContextFromHandoff(handoff = {}, capturedAt = new Date().toISOString()) {
  const parsed = parseExternalSourceHandoffPayload(handoff);
  if (!parsed) return null;
  return {
    verified: true,
    siteId: parsed.siteId,
    siteSlug: parsed.siteSlug,
    mascotCharacterId: parsed.mascotCharacterId,
    sourceOrigin: parsed.sourceOrigin,
    sourcePageUrl: parsed.sourcePageUrl,
    sourcePageTitle: parsed.sourcePageTitle,
    sourcePageType: parsed.sourcePageType,
    sourceProductId: parsed.sourceProductId,
    capturedAt: normalizeTimestamp(capturedAt),
  };
}

export function parseExternalSourceContext(value = null) {
  let source = value;
  if (typeof source === "string") {
    try { source = JSON.parse(source); } catch { return null; }
  }
  if (!source || typeof source !== "object" || Array.isArray(source) || source.verified !== true) return null;
  const sourceOrigin = normalizeOrigin(source.sourceOrigin);
  const page = normalizeExternalSourcePage({
    sourceUrl: source.sourcePageUrl,
    sourceTitle: source.sourcePageTitle,
    expectedOrigin: sourceOrigin,
  });
  if (!sourceOrigin || !page || !safeId(source.siteId) || !safeId(source.siteSlug) || !safeId(source.mascotCharacterId)) return null;
  return {
    verified: true,
    siteId: safeId(source.siteId),
    siteSlug: safeId(source.siteSlug),
    mascotCharacterId: safeId(source.mascotCharacterId),
    sourceOrigin,
    ...page,
    capturedAt: normalizeTimestamp(source.capturedAt),
  };
}

export function isExternalSourceProductReference(userText = "", searchIntent = {}) {
  const text = String(userText || "").trim().toLowerCase();
  if (!text) return false;
  const deicticReference = /\b(this|that|it|these|those|the one|on this page|this page|this shirt|this jersey|this product|what(?:'s| is) this|how much is this|do you have this)\b/i.test(text)
    || /(这件|这个|这款|这页|这个页面|这个商品|它|那件|那款)/u.test(text)
    || /\b(esta|este|esa|ese|esto|aquí)(?:\s+(?:camiseta|jersey|producto))?\b/i.test(text)
    || /\b(cette|ce|ça|ici)(?:\s+(?:maillot|produit))?\b/i.test(text)
    || /\b(bu|şu|bu ürün|bu forma)\b/i.test(text);
  const implicitPageQuestion = /(多少钱|什么价格|有什么尺码|有哪些尺码|有货吗)/u.test(text)
    || /\b(how much|what price|which sizes?|what sizes?|in stock|precio|cuánto|tallas?|stock|prix|tailles?)\b/i.test(text);
  const productIntent = searchIntent?.shouldLoadProductContext === true
    || ["sizing", "product", "availability", "price"].includes(String(searchIntent?.intent || "").toLowerCase());
  if (!productIntent && !deicticReference && !implicitPageQuestion) return false;
  const explicitOtherAnchor = Boolean(String(searchIntent?.requestedTeam || "").trim()
    || String(searchIntent?.requestedPlayer || "").trim()
    || String(searchIntent?.requestedProductType || "").trim());
  return deicticReference || !explicitOtherAnchor;
}

function parseExternalSourceHandoffPayload(payload = {}) {
  const sourceOrigin = normalizeOrigin(payload.sourceOrigin);
  const page = normalizeExternalSourcePage({
    sourceUrl: payload.sourcePageUrl,
    sourceTitle: payload.sourcePageTitle,
    expectedOrigin: sourceOrigin,
  });
  if (!sourceOrigin || !page || !safeId(payload.siteId) || !safeId(payload.siteSlug) || !safeId(payload.mascotCharacterId)) return null;
  return {
    siteId: safeId(payload.siteId),
    siteSlug: safeId(payload.siteSlug),
    mascotCharacterId: safeId(payload.mascotCharacterId),
    sourceOrigin,
    ...page,
  };
}

function classifyPageType(pathname, hasProductId) {
  if (hasProductId) return "product";
  if (pathname === "/") return "home";
  if (/\/(?:category|categories|collections|search|shop|kitshop)(?:\/|$)/i.test(pathname)) return "category";
  return "page";
}

function normalizeOrigin(value = "") {
  try {
    const url = new URL(String(value || "").trim());
    return isWebProtocol(url.protocol) && !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash
      ? url.origin
      : "";
  } catch {
    return "";
  }
}

function normalizePathname(value = "") {
  const raw = String(value || "").trim();
  if (!raw || raw.includes("\\") || /[\u0000-\u001f]/.test(raw)) return "";
  const normalized = `/${raw.replace(/^\/+/g, "")}`.replace(/\/+/g, "/");
  return normalized.length > 1 ? normalized.replace(/\/+$/, "") : "/";
}

function normalizePageTitle(value = "") {
  return String(value == null ? "" : value)
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_PAGE_TITLE_LENGTH);
}

function normalizeProductId(value = "") {
  const text = String(value || "").trim();
  return /^\d{1,20}$/.test(text) ? text : "";
}

function normalizeTimestamp(value = "") {
  const date = new Date(String(value || ""));
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function safeId(value = "") {
  return String(value || "").trim().slice(0, 128);
}

function isWebProtocol(value = "") {
  return value === "http:" || value === "https:";
}

function handoffSecret() {
  return SERVER_CONFIG.productApi.secretKey || SERVER_CONFIG.guestChat.networkPepper || "aiove-local-handoff-secret";
}
