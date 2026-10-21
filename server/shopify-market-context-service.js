import { createProductSourceError, createProductSourceGraphqlError, normalizeProductSourceError, PRODUCT_SOURCE_ERROR_CODE } from "./product-source-error-service.js";

const MARKET_CONTEXT_CACHE_TTL_MS = 15 * 60 * 1000;
const marketContextCache = new Map();
const marketPricingContextCache = new Map();

export async function resolveShopifyMarketContext({ endpoint = "", token = "", currency = "", countryCode = "", timeoutMs = 3000, fetchImpl = fetch } = {}) {
  const normalizedEndpoint = String(endpoint || "").trim();
  const normalizedToken = String(token || "").trim();
  const normalizedCurrency = String(currency || "").trim().toUpperCase();
  const normalizedCountryCode = normalizeCountryCode(countryCode);
  if (!normalizedEndpoint || !normalizedToken || (!normalizedCurrency && !normalizedCountryCode)) {
    throw createProductSourceError(normalizedToken ? PRODUCT_SOURCE_ERROR_CODE.SOURCE_UNCONFIGURED : PRODUCT_SOURCE_ERROR_CODE.CREDENTIALS_UNAVAILABLE, { provider: "shopify" });
  }

  const cacheKey = `${normalizedEndpoint}:country:${normalizedCountryCode}:currency:${normalizedCurrency}`;
  const cached = marketContextCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, Number(timeoutMs || 3000)));
  try {
    const response = await fetchImpl(normalizedEndpoint, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": "AIOVE Shopify Market Reader",
        "X-Shopify-Access-Token": normalizedToken,
      },
      body: JSON.stringify({ query: buildShopifyMarketsQuery() }),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw createProductSourceError(normalizeProductSourceError({ statusCode: response.status }).code, { provider: "shopify", statusCode: response.status });
    if (Array.isArray(payload.errors) && payload.errors.length) {
      throw createProductSourceGraphqlError(payload.errors, { provider: "shopify" });
    }
    if (!Array.isArray(payload?.data?.markets?.nodes)) {
      throw createProductSourceError(PRODUCT_SOURCE_ERROR_CODE.SOURCE_INTERNAL, { provider: "shopify" });
    }
    const activeRegions = flattenActiveMarketRegions(payload.data.markets.nodes);
    if (normalizedCountryCode) {
      const matchingRegions = activeRegions.filter((region) => region.countryCode === normalizedCountryCode);
      if (matchingRegions.length !== 1) {
        throw createProductSourceError(PRODUCT_SOURCE_ERROR_CODE.MARKET_COUNTRY_AMBIGUOUS, { provider: "shopify" });
      }
      const value = Object.freeze({ countryCode: normalizedCountryCode, currency: matchingRegions[0].currency });
      marketContextCache.set(cacheKey, { value, expiresAt: Date.now() + MARKET_CONTEXT_CACHE_TTL_MS });
      return value;
    }
    const countryCodes = uniqueStrings(activeRegions
      .filter((region) => region.currency === normalizedCurrency)
      .map((region) => region.countryCode));
    if (countryCodes.length !== 1) {
      throw createProductSourceError(countryCodes.length ? PRODUCT_SOURCE_ERROR_CODE.MARKET_COUNTRY_AMBIGUOUS : PRODUCT_SOURCE_ERROR_CODE.MARKET_CURRENCY_MISMATCH, { provider: "shopify" });
    }
    const value = Object.freeze({ countryCode: countryCodes[0], currency: normalizedCurrency });
    marketContextCache.set(cacheKey, { value, expiresAt: Date.now() + MARKET_CONTEXT_CACHE_TTL_MS });
    return value;
  } catch (error) {
    const metadata = normalizeProductSourceError(error, { provider: "shopify" });
    throw createProductSourceError(metadata.code, metadata);
  } finally {
    clearTimeout(timer);
  }
}

export function clearShopifyMarketContextCacheForTest() {
  marketContextCache.clear();
  marketPricingContextCache.clear();
}

/**
 * Returns only the market information that can safely support a local fixed-
 * amount discount preview. This is deliberately separate from the country
 * resolver used by product fetching: a site without read_markets must still be
 * able to load products, it simply will not get a cross-currency estimate.
 */
export async function resolveShopifyMarketPricingContext({ endpoint = "", token = "", currency = "", countryCode = "", timeoutMs = 3000, fetchImpl = fetch } = {}) {
  const normalizedEndpoint = String(endpoint || "").trim();
  const normalizedToken = String(token || "").trim();
  const normalizedCurrency = String(currency || "").trim().toUpperCase();
  const normalizedCountryCode = normalizeCountryCode(countryCode);
  if (!normalizedEndpoint || !normalizedToken || !normalizedCurrency) return null;

  const cacheKey = `${normalizedEndpoint}:country:${normalizedCountryCode}:currency:${normalizedCurrency}`;
  const cached = marketPricingContextCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, Number(timeoutMs || 3000)));
  try {
    const response = await fetchImpl(normalizedEndpoint, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": "AIOVE Shopify Market Reader",
        "X-Shopify-Access-Token": normalizedToken,
      },
      body: JSON.stringify({ query: buildShopifyMarketPricingQuery() }),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || (Array.isArray(payload.errors) && payload.errors.length)) return null;

    const activeMarkets = (payload?.data?.markets?.nodes || [])
      .filter((market) => String(market?.status || "").toUpperCase() === "ACTIVE")
      .filter((market) => (market?.regions?.nodes || []).some((region) => (
        String(region?.currency?.currencyCode || "").toUpperCase() === normalizedCurrency
        && (!normalizedCountryCode || normalizeCountryCode(region?.code) === normalizedCountryCode)
      )));
    if (activeMarkets.length !== 1) return null;

    const settings = activeMarkets[0]?.currencySettings || {};
    const baseCurrency = String(settings?.baseCurrency?.currencyCode || "").trim().toUpperCase();
    const shopCurrency = String(payload?.data?.shop?.currencyCode || "").trim().toUpperCase();
    const manualRate = Number(settings?.baseCurrency?.manualRate);
    if (
      baseCurrency !== normalizedCurrency
      || !shopCurrency
      || settings?.localCurrencies === true
      || !Number.isFinite(manualRate)
      || manualRate <= 0
    ) return null;

    const value = Object.freeze({
      currency: normalizedCurrency,
      shopCurrency,
      manualRate,
      fractionDigits: resolveCurrencyFractionDigits(normalizedCurrency),
    });
    marketPricingContextCache.set(cacheKey, { value, expiresAt: Date.now() + MARKET_CONTEXT_CACHE_TTL_MS });
    return value;
  } finally {
    clearTimeout(timer);
  }
}

function buildShopifyMarketsQuery() {
  return `
query AioveMarkets {
  markets(first: 100) {
    nodes {
      status
      regions(first: 250) {
        nodes {
          ... on MarketRegionCountry {
            code
            currency { currencyCode }
          }
        }
      }
    }
  }
}
`;
}

function buildShopifyMarketPricingQuery() {
  return `
query AioveMarketPricing {
  shop { currencyCode }
  markets(first: 100) {
    nodes {
      status
      currencySettings {
        baseCurrency { currencyCode manualRate }
        localCurrencies
      }
      regions(first: 250) {
        nodes {
          ... on MarketRegionCountry {
            code
            currency { currencyCode }
          }
        }
      }
    }
  }
}
`;
}

function resolveCurrencyFractionDigits(currency) {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits;
  } catch {
    return 2;
  }
}

function uniqueStrings(values = []) {
  return [...new Set(values.map((value) => String(value || "").trim().toUpperCase()).filter(Boolean))];
}

function flattenActiveMarketRegions(markets = []) {
  return (Array.isArray(markets) ? markets : [])
    .filter((market) => String(market?.status || "").toUpperCase() === "ACTIVE")
    .flatMap((market) => market?.regions?.nodes || [])
    .map((region) => ({
      countryCode: normalizeCountryCode(region?.code),
      currency: String(region?.currency?.currencyCode || "").trim().toUpperCase(),
    }))
    .filter((region) => region.countryCode && /^[A-Z]{3}$/.test(region.currency));
}

function normalizeCountryCode(value = "") {
  const code = String(value || "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : "";
}
