import { listCachedProductRows } from "./kitshop-repository.js";
import { mapCachedProducts } from "./kitshop-shelf-builder.js";
import { prepareProductCandidates } from "./product-candidate-ranking-service.js";
import { filterProductsBySearchCriteria } from "./product-search-match-service.js";
import { filterProductsByIntent } from "./product-intent-service.js";

export const PRODUCT_CACHE_FRESHNESS_MS = 4 * 60 * 60 * 1000;
export const PRODUCT_CACHE_STALE_FALLBACK_MS = 24 * 60 * 60 * 1000;

export async function searchCachedProducts({
  siteId = "",
  query = "",
  searchIntent = {},
  limit = 5,
  allowNearestAgeFallback = false,
  maxAgeMs = PRODUCT_CACHE_FRESHNESS_MS,
} = {}, { loadRows = listCachedProductRows, now = Date.now() } = {}) {
  if (!siteId) return { products: [], source: "cache", ageMs: null };
  const rows = await loadRows(siteId);
  const usableRows = rows.filter((row) => isWithinAge(row?.last_synced_at, maxAgeMs, now));
  const ageMs = latestAgeMs(usableRows, now);
  const products = mapCachedProducts(usableRows).map((row) => row.payload).filter(Boolean);
  const intentMatches = filterProductsByIntent(products, searchIntent, { allowNearestAgeFallback });
  const criteriaMatches = filterProductsBySearchCriteria(intentMatches, query, searchIntent);
  return {
    products: prepareProductCandidates(criteriaMatches, { searchIntent, limit }),
    source: "cache",
    ageMs,
  };
}

function isWithinAge(value, maxAgeMs, now) {
  const timestamp = new Date(value || 0).getTime();
  const ageMs = Number(now) - timestamp;
  return Number.isFinite(timestamp) && ageMs >= 0 && ageMs <= Math.max(0, Number(maxAgeMs) || 0);
}

function latestAgeMs(rows, now) {
  const timestamps = rows
    .map((row) => new Date(row?.last_synced_at || 0).getTime())
    .filter(Number.isFinite);
  return timestamps.length ? Math.max(0, Number(now) - Math.max(...timestamps)) : null;
}
