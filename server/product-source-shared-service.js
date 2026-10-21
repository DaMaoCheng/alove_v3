export const MAX_PRODUCTS = 5;
export const MAX_PRODUCT_SOURCE_LIMIT = 50;

export function normalizeProductSourceLimit(value = MAX_PRODUCTS) {
  const limit = Number(value);
  if (!Number.isFinite(limit)) return MAX_PRODUCTS;
  return Math.max(1, Math.min(MAX_PRODUCT_SOURCE_LIMIT, Math.trunc(limit)));
}

export function fetchJsonWithTimeout(url, timeoutMs, {
  accept = "application/json",
  userAgent = "AIOVE Mascot Product Context",
  errorLabel = "Product API",
} = {}) {
  return fetchWithTimeout(url, timeoutMs, {
    accept,
    userAgent,
    errorLabel,
    parse: (response) => response.json(),
  });
}

export function fetchTextWithTimeout(url, timeoutMs, {
  accept = "text/html",
  userAgent = "AIOVE Mascot Product Context",
  errorLabel = "Product search page",
} = {}) {
  return fetchWithTimeout(url, timeoutMs, {
    accept,
    userAgent,
    errorLabel,
    parse: (response) => response.text(),
  });
}

export function normalizePathname(value = "") {
  return `/${safeString(value).replace(/^\/+|\/+$/g, "")}`;
}

export function shopifySearchQuery(query = "") {
  const text = safeString(query);
  if (!text || text === "recommended") return "football shirt";
  return text;
}

export function safeString(value) {
  return String(value == null ? "" : value).trim();
}

async function fetchWithTimeout(url, timeoutMs, { accept, userAgent, errorLabel, parse }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, Number(timeoutMs || 3000)));
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: accept,
        "User-Agent": userAgent,
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`${errorLabel} HTTP ${response.status}`);
    return await parse(response);
  } finally {
    clearTimeout(timer);
  }
}
