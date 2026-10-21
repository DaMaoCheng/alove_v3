import {
  assertSafeProductSourceFetchUrl,
  fetchSafeProductSourceBytes,
  fetchSafeProductSourceJson,
} from "./product-source-http-service.js";
import { safeString } from "./product-source-shared-service.js";
import { normalizePublicOrigin } from "./product-source-ttmall-mapper.js";

const TOKEN_REFRESH_SKEW_MS = 60_000;
const TOKEN_FALLBACK_TTL_MS = 10 * 60_000;
const TOKEN_MAX_TTL_MS = 60 * 60_000;
const WEBSITE_CACHE_TTL_MS = 60 * 60_000;
const MAX_CACHE_ENTRIES = 64;
const tokenCache = new Map();
const tokenFlights = new Map();
const websiteCache = new Map();

export async function fetchTtmallWebsite(source, { timeoutMs }) {
  pruneCache(websiteCache);
  const cached = websiteCache.get(source.cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const payload = await fetchTtmallJson(source, "/v1/website", { timeoutMs });
  const rawWebsite = payload?.data && typeof payload.data === "object" ? payload.data : {};
  const storefront = normalizePublicOrigin(rawWebsite.WEBSITE_DOMAIN);
  const cdn = normalizePublicOrigin(rawWebsite.CDN_LINK);
  if (!storefront) throw new Error("TTMall website response is missing a HTTPS storefront origin");
  await assertSafeProductSourceFetchUrl(storefront);
  if (cdn) await assertSafeProductSourceFetchUrl(cdn);
  const website = { ...rawWebsite, WEBSITE_DOMAIN: storefront, CDN_LINK: cdn };
  setBoundedCache(websiteCache, source.cacheKey, { value: website, expiresAt: Date.now() + WEBSITE_CACHE_TTL_MS });
  return website;
}

export async function fetchTtmallJson(source, pathname, { timeoutMs, searchParams = null, retryAuth = true } = {}) {
  return fetchTtmallApiJson(source, pathname, { timeoutMs, searchParams, retryAuth });
}

export async function fetchTtmallApiJson(source, pathname, {
  timeoutMs,
  searchParams = null,
  retryAuth = true,
  method = "GET",
  body = null,
  sessionCookie = "",
  allowErrorPayload = false,
  includeResponseMeta = false,
} = {}) {
  const token = await getTtmallToken(source, { timeoutMs });
  const url = new URL(pathname, `${source.apiBaseUrl}/`);
  for (const [key, value] of Object.entries(searchParams || {})) {
    if (safeString(value)) url.searchParams.set(key, safeString(value));
  }
  const response = await fetchSafeProductSourceJson(url, {
    timeoutMs,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "AIOVE TTMall Product Reader",
      ...(safeString(sessionCookie) ? { Cookie: safeString(sessionCookie) } : {}),
      ...(body == null ? {} : { "Content-Type": "application/json" }),
    },
    method,
    body: body == null ? null : JSON.stringify(body),
  });
  if (response.status === 401 && retryAuth) {
    tokenCache.delete(source.cacheKey);
    return fetchTtmallApiJson(source, pathname, {
      timeoutMs,
      searchParams,
      method,
      body,
      sessionCookie,
      allowErrorPayload,
      includeResponseMeta,
      retryAuth: false,
    });
  }
  if ((!response.ok && !allowErrorPayload) || (!allowErrorPayload && Number(response.payload?.code || response.status) >= 400)) {
    throw new Error(`TTMall API HTTP ${response.status}`);
  }
  return includeResponseMeta ? { status: response.status, payload: response.payload } : response.payload;
}

export async function fetchTtmallApiBytes(source, pathname, {
  timeoutMs,
  searchParams = null,
  retryAuth = true,
  maxBytes = 1024 * 1024,
} = {}) {
  const token = await getTtmallToken(source, { timeoutMs });
  const url = new URL(pathname, `${source.apiBaseUrl}/`);
  for (const [key, value] of Object.entries(searchParams || {})) {
    if (safeString(value)) url.searchParams.set(key, safeString(value));
  }
  const response = await fetchSafeProductSourceBytes(url, {
    timeoutMs,
    maxBytes,
    headers: {
      Accept: "image/*",
      Authorization: `Bearer ${token}`,
      "User-Agent": "AIOVE TTMall Account Binding",
    },
  });
  if (response.status === 401 && retryAuth) {
    tokenCache.delete(source.cacheKey);
    return fetchTtmallApiBytes(source, pathname, { timeoutMs, searchParams, maxBytes, retryAuth: false });
  }
  if (!response.ok) throw new Error(`TTMall API HTTP ${response.status}`);
  return response;
}

export function resetTtmallClientCachesForTests() {
  tokenCache.clear();
  tokenFlights.clear();
  websiteCache.clear();
}

async function getTtmallToken(source, { timeoutMs }) {
  pruneCache(tokenCache);
  const cached = tokenCache.get(source.cacheKey);
  if (cached && cached.expiresAt > Date.now() + TOKEN_REFRESH_SKEW_MS) return cached.token;
  if (tokenFlights.has(source.cacheKey)) return tokenFlights.get(source.cacheKey);
  const flight = (async () => {
    const response = await fetchSafeProductSourceJson(
      new URL(`/v1/token/${encodeURIComponent(source.websiteId)}`, `${source.apiBaseUrl}/`),
      {
        timeoutMs,
        headers: { Accept: "application/json", "User-Agent": "AIOVE TTMall Product Reader" },
      },
    );
    const token = safeString(response.payload?.data || response.payload?.token);
    if (!response.ok || !token) throw new Error(`TTMall token HTTP ${response.status}`);
    setBoundedCache(tokenCache, source.cacheKey, { token, expiresAt: resolveJwtExpiry(token) });
    return token;
  })();
  tokenFlights.set(source.cacheKey, flight);
  try {
    return await flight;
  } finally {
    tokenFlights.delete(source.cacheKey);
  }
}

function resolveJwtExpiry(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    const expiresAt = Number(payload?.exp || 0) * 1000;
    if (Number.isFinite(expiresAt) && expiresAt > Date.now()) {
      return Math.min(expiresAt, Date.now() + TOKEN_MAX_TTL_MS);
    }
  } catch {
    // Some TTMall installations may return opaque tokens.
  }
  return Date.now() + TOKEN_FALLBACK_TTL_MS;
}

function pruneCache(cache) {
  const now = Date.now();
  for (const [key, value] of cache.entries()) {
    if (!value || Number(value.expiresAt || 0) <= now) cache.delete(key);
  }
}

function setBoundedCache(cache, key, value) {
  cache.delete(key);
  while (cache.size >= MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value);
  cache.set(key, value);
}
