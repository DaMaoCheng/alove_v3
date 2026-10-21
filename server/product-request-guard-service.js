import { createPublicError } from "./public-error-utils.js";

const PRODUCT_WINDOW_MS = 10 * 60 * 1000;
export const AUTHENTICATED_PRODUCT_REQUEST_LIMIT = 120;
export const AUTHENTICATED_PRODUCT_IN_FLIGHT_LIMIT = 2;
export const ADMIN_PRODUCT_SEARCH_QUERY_LIMIT = 160;
const authenticatedProductBuckets = new Map();
const authenticatedProductInFlight = new Map();

export function resolveProductRequestSiteSlug(user, requestedSiteSlug = "") {
  const requestedText = String(requestedSiteSlug || "").trim();
  const requested = normalizeProductSiteSlug(requestedText);
  if (requestedText && !requested) {
    throw createPublicError("Product catalog site is invalid.", 400);
  }
  if (!user) return requested;
  if (isAdmin(user)) return requested;

  const accountSiteSlug = normalizeProductSiteSlug(user.site_slug || user.siteSlug);
  if (!accountSiteSlug || (requested && requested !== accountSiteSlug)) {
    throw createPublicError("This product catalog is not available for this account.", 403);
  }
  return accountSiteSlug;
}

export function consumeAuthenticatedProductRequestQuota(user, siteSlug = "", now = Date.now()) {
  if (!user) return () => {};
  const normalizedSiteSlug = normalizeProductSiteSlug(siteSlug);
  if (!normalizedSiteSlug) throw createPublicError("Product catalog access is unavailable.", 403);
  return consumeProductRequestQuota(user, `site-slug:${normalizedSiteSlug}`, now);
}

export function consumeAdminProductSearchQuota(user, siteId = "", now = Date.now()) {
  const normalizedSiteId = normalizeProductSiteId(siteId);
  if (!normalizedSiteId) throw createPublicError("Product catalog site is invalid.", 400);
  return consumeProductRequestQuota(user, `site-id:${normalizedSiteId}`, now);
}

export function assertAdminProductSearchQuery(query = "") {
  const text = String(query || "").trim();
  if (text.length > ADMIN_PRODUCT_SEARCH_QUERY_LIMIT) {
    throw createPublicError("Search text is too long.", 400);
  }
  return text;
}

export function resetAuthenticatedProductRequestQuotaForTests() {
  authenticatedProductBuckets.clear();
  authenticatedProductInFlight.clear();
}

function isAdmin(user) {
  return String(user?.account_type || "").trim().toLowerCase() === "admin";
}

export function normalizeProductSiteSlug(value) {
  const text = String(value || "").trim().toLowerCase();
  return /^[a-z0-9][a-z0-9-]{0,95}$/.test(text) ? text : "";
}

function normalizeProductSiteId(value) {
  const text = String(value || "").trim().toLowerCase();
  return /^[a-z0-9][a-z0-9_-]{0,127}$/.test(text) ? text : "";
}

function consumeProductRequestQuota(user, identity, now) {
  const userId = String(user?.id || "").trim();
  if (!userId || !identity) throw createPublicError("Product catalog access is unavailable.", 403);

  pruneAuthenticatedProductBuckets(now);
  const key = `${userId}:${identity}`;
  const inFlight = Number(authenticatedProductInFlight.get(key) || 0);
  if (inFlight >= AUTHENTICATED_PRODUCT_IN_FLIGHT_LIMIT) {
    throw createPublicError("Too many product requests. Please try again shortly.", 429);
  }
  const current = authenticatedProductBuckets.get(key);
  const bucket = !current || now - current.startedAt >= PRODUCT_WINDOW_MS
    ? { startedAt: now, count: 0 }
    : current;
  if (bucket.count >= AUTHENTICATED_PRODUCT_REQUEST_LIMIT) {
    throw createPublicError("Too many product requests. Please try again later.", 429);
  }
  bucket.count += 1;
  authenticatedProductBuckets.set(key, bucket);
  authenticatedProductInFlight.set(key, inFlight + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const active = Number(authenticatedProductInFlight.get(key) || 0);
    if (active <= 1) authenticatedProductInFlight.delete(key);
    else authenticatedProductInFlight.set(key, active - 1);
  };
}

function pruneAuthenticatedProductBuckets(now) {
  if (authenticatedProductBuckets.size < 5000) return;
  for (const [key, bucket] of authenticatedProductBuckets.entries()) {
    if (!bucket || now - bucket.startedAt >= PRODUCT_WINDOW_MS) authenticatedProductBuckets.delete(key);
  }
}
