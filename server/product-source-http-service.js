import dns from "node:dns/promises";
import net from "node:net";
import { Agent } from "undici";
import { SERVER_CONFIG } from "./config.js";
import { normalizeProducts } from "./product-normalizer.js";
import {
  fetchJsonWithTimeout,
  MAX_PRODUCTS,
  normalizeProductSourceLimit,
  normalizePathname,
  safeString,
} from "./product-source-shared-service.js";

export async function fetchHttpProducts(productApiUrl, searchIntent = {}, { currency = "", timeoutMs = SERVER_CONFIG.productApi.timeoutMs, maxProducts = MAX_PRODUCTS, throwOnError = false } = {}) {
  try {
    await assertSafeProductSourceFetchUrl(productApiUrl);
  } catch (error) {
    console.warn("[aiove] mascot product API blocked:", error.message);
    if (throwOnError) throw error;
    return [];
  }
  const url = buildProductApiUrl(productApiUrl, searchIntent, { maxProducts });
  if (!url) return [];

  try {
    const payload = await fetchJsonWithTimeout(url, timeoutMs);
    return normalizeProducts(payload, { currency, maxProducts });
  } catch (error) {
    console.warn("[aiove] mascot product API failed:", error.message);
    if (throwOnError) throw error;
    return [];
  }
}

export function isBlockedProductAdminUrl(value) {
  const text = safeString(value);
  if (!text) return false;
  try {
    const url = new URL(text);
    const pathname = normalizePathname(url.pathname);
    return pathname.startsWith("/admin/") || pathname.includes("/admin/api/");
  } catch {
    return false;
  }
}

export function buildProductApiUrl(value, searchIntent = {}, { maxProducts = MAX_PRODUCTS } = {}) {
  const text = safeString(value);
  if (!text) return "";
  try {
    const url = new URL(text);
    if (!["http:", "https:"].includes(url.protocol)) return "";
    if (searchIntent.query) url.searchParams.set("q", searchIntent.query);
    if (searchIntent.intent) url.searchParams.set("intent", searchIntent.intent);
    url.searchParams.set("limit", String(normalizeProductSourceLimit(maxProducts)));
    return url.toString();
  } catch {
    return "";
  }
}

export function isUnsafeConfiguredProductSourceUrl(value) {
  const text = safeString(value);
  if (!text) return false;
  try {
    const url = new URL(text);
    if (!["http:", "https:"].includes(url.protocol)) return true;
    if (url.username || url.password) return true;
    const hostname = normalizeHostname(url.hostname);
    if (!hostname) return true;
    return isBlockedHostname(hostname) || isNonPublicIpAddress(hostname);
  } catch {
    return true;
  }
}

export async function assertSafeProductSourceFetchUrl(value) {
  await resolveSafeProductSourceRecords(value);
}

export async function fetchSafeProductSourceJson(value, { timeoutMs = 3000, headers = {}, method = "GET", body = null } = {}) {
  const url = new URL(safeString(value));
  const pinnedRecords = await resolveSafeProductSourceRecords(url);
  const dispatcher = pinnedRecords.length ? createPinnedDispatcher(url.hostname, pinnedRecords) : null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, Number(timeoutMs || 3000)));
  try {
    const response = await fetch(url, {
      method: normalizeSafeFetchMethod(method),
      headers,
      ...(body == null ? {} : { body }),
      signal: controller.signal,
      redirect: "error",
      ...(dispatcher ? { dispatcher } : {}),
    });
    const payload = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, payload };
  } finally {
    clearTimeout(timer);
    if (dispatcher) await dispatcher.close().catch(() => {});
  }
}

export async function fetchSafeProductSourceBytes(value, {
  timeoutMs = 3000,
  headers = {},
  method = "GET",
  body = null,
  maxBytes = 1024 * 1024,
} = {}) {
  const url = new URL(safeString(value));
  const pinnedRecords = await resolveSafeProductSourceRecords(url);
  const dispatcher = pinnedRecords.length ? createPinnedDispatcher(url.hostname, pinnedRecords) : null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, Number(timeoutMs || 3000)));
  try {
    const response = await fetch(url, {
      method: normalizeSafeFetchMethod(method),
      headers,
      ...(body == null ? {} : { body }),
      signal: controller.signal,
      redirect: "error",
      ...(dispatcher ? { dispatcher } : {}),
    });
    const contentLength = Number(response.headers.get("content-length") || 0);
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      throw new Error("Product API binary response exceeds the configured limit");
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > maxBytes) {
      throw new Error("Product API binary response exceeds the configured limit");
    }
    return {
      ok: response.ok,
      status: response.status,
      buffer,
      contentType: String(response.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase(),
      setCookies: readSetCookies(response.headers),
    };
  } finally {
    clearTimeout(timer);
    if (dispatcher) await dispatcher.close().catch(() => {});
  }
}

function readSetCookies(headers) {
  if (typeof headers?.getSetCookie === "function") return headers.getSetCookie();
  const value = headers?.get?.("set-cookie");
  return value ? [value] : [];
}

function normalizeSafeFetchMethod(value = "GET") {
  const method = safeString(value).toUpperCase();
  return ["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method) ? method : "GET";
}

async function resolveSafeProductSourceRecords(value) {
  const text = safeString(value);
  if (!text) throw new Error("Product API URL is empty");
  if (isSelfCheckLocalProductSourceAllowed(text)) return [];
  if (isUnsafeConfiguredProductSourceUrl(text)) {
    throw new Error("Product API URL must use a public http/https host");
  }
  const url = new URL(text);
  const hostname = normalizeHostname(url.hostname);
  let records = await dns.lookup(hostname, { all: true, verbatim: true }).catch(() => []);
  if (!records.length) throw new Error("Product API host could not be resolved");
  if (records.every((record) => isBenchmarkFakeIpv4(record?.address || ""))) {
    records = await resolveProductSourceRecordsViaTrustedDoh(hostname);
  }
  if (records.some((record) => isNonPublicIpAddress(record?.address || ""))) {
    throw new Error("Product API host resolves to a private or reserved address");
  }
  return records;
}

async function resolveProductSourceRecordsViaTrustedDoh(hostname) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const url = new URL("https://cloudflare-dns.com/dns-query");
    url.searchParams.set("name", hostname);
    url.searchParams.set("type", "A");
    const response = await fetch(url, {
      headers: { Accept: "application/dns-json", "User-Agent": "AIOVE Product Source Resolver" },
      signal: controller.signal,
      redirect: "error",
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error("Trusted DNS resolver request failed");
    const records = (Array.isArray(payload?.Answer) ? payload.Answer : [])
      .filter((answer) => Number(answer?.type) === 1 && net.isIP(safeString(answer?.data)) === 4)
      .map((answer) => ({ address: safeString(answer.data), family: 4 }));
    if (!records.length || records.some((record) => isNonPublicIpAddress(record.address))) {
      throw new Error("Trusted DNS resolver did not return a public address");
    }
    return records;
  } finally {
    clearTimeout(timer);
  }
}

function createPinnedDispatcher(expectedHostname, records) {
  const normalizedExpected = normalizeHostname(expectedHostname);
  return new Agent({
    connect: {
      lookup(hostname, options, callback) {
        if (normalizeHostname(hostname) !== normalizedExpected) {
          callback(new Error("Product API connection host changed after validation"));
          return;
        }
        const family = Number(options?.family || 0);
        const candidates = family ? records.filter((record) => Number(record.family) === family) : records;
        const selected = candidates.length ? candidates : records;
        if (options?.all) {
          callback(null, selected.map((record) => ({ address: record.address, family: Number(record.family) })));
          return;
        }
        callback(null, selected[0].address, Number(selected[0].family));
      },
    },
  });
}

function isSelfCheckLocalProductSourceAllowed(value = "") {
  if (process.env.NODE_ENV !== "test") return false;
  if (process.env.AIOVE_ALLOW_LOCAL_PRODUCT_SOURCE_SELF_CHECK !== "true") return false;
  try {
    const hostname = normalizeHostname(new URL(value).hostname);
    return hostname === "127.0.0.1" || hostname === "::1" || hostname === "localhost";
  } catch {
    return false;
  }
}

function normalizeHostname(value = "") {
  return safeString(value).replace(/^\[|\]$/g, "").toLowerCase();
}

function isBlockedHostname(hostname = "") {
  if (!hostname) return true;
  if (BLOCKED_HOSTNAMES.has(hostname)) return true;
  return BLOCKED_HOSTNAME_SUFFIXES.some((suffix) => hostname.endsWith(suffix));
}

function isNonPublicIpAddress(hostname = "") {
  const normalized = normalizeHostname(hostname);
  const ipVersion = net.isIP(normalized);
  if (ipVersion === 4) return isNonPublicIpv4(normalized);
  if (ipVersion === 6) return isNonPublicIpv6(normalized);
  return false;
}

function isNonPublicIpv4(value = "") {
  const octets = value.split(".").map((part) => Number.parseInt(part, 10));
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = octets;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 0) return true;
  if (a === 192 && b === 168) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a >= 224) return true;
  return false;
}

function isBenchmarkFakeIpv4(value = "") {
  const octets = safeString(value).split(".").map((part) => Number.parseInt(part, 10));
  return octets.length === 4 && octets[0] === 198 && (octets[1] === 18 || octets[1] === 19);
}

function isNonPublicIpv6(value = "") {
  const normalized = normalizeHostname(value);
  if (!normalized) return true;
  if (normalized === "::" || normalized === "::1") return true;
  const mappedIpv4 = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mappedIpv4?.[1]) return isNonPublicIpv4(mappedIpv4[1]);
  return normalized.startsWith("fc")
    || normalized.startsWith("fd")
    || normalized.startsWith("fe8")
    || normalized.startsWith("fe9")
    || normalized.startsWith("fea")
    || normalized.startsWith("feb")
    || normalized.startsWith("ff")
    || normalized.startsWith("2001:db8");
}

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "host.docker.internal",
  "gateway.docker.internal",
  "kubernetes.docker.internal",
  "metadata",
  "metadata.google.internal",
]);

const BLOCKED_HOSTNAME_SUFFIXES = [
  ".internal",
  ".local",
  ".localhost",
  ".localdomain",
  ".home.arpa",
];
