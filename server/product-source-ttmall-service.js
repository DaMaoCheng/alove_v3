import { SERVER_CONFIG } from "./config.js";
import { normalizeCurrency } from "./product-normalizer.js";
import { filterProductsByIntent } from "./product-intent-service.js";
import { assertSafeProductSourceFetchUrl } from "./product-source-http-service.js";
import {
  MAX_PRODUCTS,
  normalizeProductSourceLimit,
  safeString,
} from "./product-source-shared-service.js";
import {
  fetchTtmallJson,
  fetchTtmallWebsite,
  resetTtmallClientCachesForTests,
} from "./product-source-ttmall-client-service.js";
import {
  extractTtmallFloorProducts,
  normalizePublicOrigin,
  normalizeTtmallProduct,
  normalizeTtmallProductId,
  normalizeTtmallSizeChart,
} from "./product-source-ttmall-mapper.js";

const DETAIL_CONCURRENCY = 4;
const MAX_ENRICHED_DETAILS = 16;
const AGE_DETAIL_BATCH_SIZE = 10;
const AGE_MATCH_TARGET = 10;
const MAX_HOMEPAGE_FLOORS = 40;
const MAX_HOMEPAGE_SOURCE_FLOORS_SCAN = 200;
const MAX_HOMEPAGE_PRODUCTS_PER_FLOOR = 50;
const MAX_HOMEPAGE_SOURCE_PRODUCTS_SCAN = 200;
const TTMALL_FLOOR_TIMEOUT_MIN_MS = 10000;

export function isTtmallProductSource(value = "") {
  return Boolean(parseTtmallProductSource(value));
}

export function parseTtmallProductSource(value = "") {
  const text = safeString(value);
  if (!text) return null;
  try {
    const url = new URL(text);
    if (url.protocol !== "ttmall:") return null;
    const hostname = safeString(url.hostname).toLowerCase();
    const port = safeString(url.port);
    const websiteId = safeString(url.searchParams.get("websiteId"));
    if (!hostname || !/^[1-9]\d{0,9}$/.test(websiteId)) return null;
    const apiBaseUrl = `https://${hostname}${port ? `:${port}` : ""}`;
    return { apiBaseUrl, websiteId, cacheKey: `${apiBaseUrl}|${websiteId}` };
  } catch {
    return null;
  }
}

export async function fetchTtmallProducts(sourceValue, searchIntent = {}, {
  currency = "",
  timeoutMs = SERVER_CONFIG.productApi.timeoutMs,
  maxProducts = MAX_PRODUCTS,
  throwOnError = false,
} = {}) {
  const source = parseTtmallProductSource(sourceValue);
  if (!source) return [];
  try {
    await assertSafeProductSourceFetchUrl(source.apiBaseUrl);
    const limit = normalizeProductSourceLimit(maxProducts);
    const website = await fetchTtmallWebsite(source, { timeoutMs });
    const payload = await fetchTtmallJson(source, "/v1/search", {
      timeoutMs,
      searchParams: {
        keyword: normalizeTtmallQuery(searchIntent.query),
        page: "1",
        limit: String(limit),
        sort: "1",
        show_all: "1",
      },
    });
    const rows = Array.isArray(payload?.data?.list) ? payload.data.list.slice(0, limit) : [];
    const detailTimeoutMs = Math.min(
      Math.max(1000, Number(timeoutMs) || SERVER_CONFIG.productApi.ttmallTimeoutMs),
      Math.max(1000, Number(SERVER_CONFIG.productApi.ttmallDetailTimeoutMs) || 5000),
    );
    const { details, consumedRows } = await hydrateSearchRows(source, rows, {
      currency,
      website,
      timeoutMs,
      detailTimeoutMs,
      searchIntent,
    });
    const summaries = rows.slice(consumedRows).map((row) => normalizeTtmallProduct(row, { currency, source, website }));
    return [...details, ...summaries].filter((item) => item?.name).slice(0, limit);
  } catch (error) {
    console.warn("[aiove] TTMall product source failed", { name: safeErrorName(error) });
    if (throwOnError) throw error;
    return [];
  }
}

export async function fetchTtmallProductById(sourceValue, productIdValue = "", {
  currency = "",
  timeoutMs = SERVER_CONFIG.productApi.timeoutMs,
  throwOnError = false,
} = {}) {
  const source = parseTtmallProductSource(sourceValue);
  const productId = normalizeTtmallProductId(productIdValue);
  if (!source || !productId) return null;
  try {
    await assertSafeProductSourceFetchUrl(source.apiBaseUrl);
    const website = await fetchTtmallWebsite(source, { timeoutMs });
    const product = await hydrateTtmallProduct(source, { product_id: productId }, { currency, website, timeoutMs, requireDetail: true });
    return product?.name ? product : null;
  } catch (error) {
    console.warn("[aiove] TTMall product detail failed", { name: safeErrorName(error) });
    if (throwOnError) throw error;
    return null;
  }
}

export function extractTtmallProductId(value = "") {
  const text = safeString(value);
  if (!text) return "";
  try {
    const pathname = new URL(text).pathname;
    return normalizeTtmallProductId(pathname.match(/\/productdetail\/[^/]+\/([^/?#]+)/i)?.[1]);
  } catch {
    return "";
  }
}

export async function fetchTtmallHomepageProductSections(site = {}, { timeoutMs = SERVER_CONFIG.productApi.timeoutMs } = {}) {
  const source = parseTtmallProductSource(site.product_api_url || site.productApiUrl);
  if (!source) return null;
  await assertSafeProductSourceFetchUrl(source.apiBaseUrl);
  const website = await fetchTtmallWebsite(source, { timeoutMs });
  const floorTimeoutMs = Math.max(Number(timeoutMs) || 0, TTMALL_FLOOR_TIMEOUT_MIN_MS);
  const payload = await fetchTtmallJson(source, "/v1/floor", { timeoutMs: floorTimeoutMs });
  if (!Array.isArray(payload?.data?.list)) {
    throw new Error("TTMall floor response is missing data.list");
  }
  const floors = payload.data.list;
  const currency = normalizeCurrency(site.currency);
  return selectTtmallHomepageFloors(floors)
    .map((floor, index) => {
      const products = extractTtmallFloorProducts(floor, {
        limit: MAX_HOMEPAGE_PRODUCTS_PER_FLOOR,
        scanLimit: MAX_HOMEPAGE_SOURCE_PRODUCTS_SCAN,
        predicate: isUsableTtmallFloorProduct,
      })
        .map((product) => normalizeTtmallProduct(product, { currency, source, website }))
        .filter((product) => product.name);
      if (!products.length) return null;
      return {
        themeId: `ttmall:${source.websiteId}`,
        themeName: website?.website_name || "TTMall",
        sectionKey: `ttmall-floor-${normalizeTtmallProductId(floor.floor_id) || index + 1}`,
        sectionType: "ttmall-floor",
        sectionTitle: safeString(floor.floor_title) || "Homepage products",
        displayOrder: index + 1,
        productHandles: products.map((product) => product.id),
        products,
        rawSection: { floorId: normalizeTtmallProductId(floor.floor_id), source: "ttmall" },
      };
    })
    .filter(Boolean);
}

function selectTtmallHomepageFloors(floors = []) {
  const candidates = floors.slice(0, MAX_HOMEPAGE_SOURCE_FLOORS_SCAN);
  const hasDesktopProductFloor = candidates.some((floor) => (
    Number(floor?.display || 0) === 1
    && hasUsableTtmallFloorProduct(floor)
  ));
  const preferredDeviceDisplay = hasDesktopProductFloor ? 1 : 2;
  const selected = [];
  for (const floor of candidates) {
    const display = Number(floor?.display || 0);
    if ((display === 0 || display === preferredDeviceDisplay) && hasUsableTtmallFloorProduct(floor)) {
      selected.push(floor);
      if (selected.length >= MAX_HOMEPAGE_FLOORS) break;
    }
  }
  return selected;
}

function hasUsableTtmallFloorProduct(floor = {}) {
  return extractTtmallFloorProducts(floor, {
    limit: 1,
    scanLimit: MAX_HOMEPAGE_SOURCE_PRODUCTS_SCAN,
    predicate: isUsableTtmallFloorProduct,
  }).length > 0;
}

function isUsableTtmallFloorProduct(product = {}) {
  return Boolean(
    normalizeTtmallProductId(product.product_id || product.id)
    && safeString(product.title || product.name)
  );
}

export async function buildTtmallStorefrontUrl(sourceValue, { timeoutMs = SERVER_CONFIG.productApi.timeoutMs } = {}) {
  const source = parseTtmallProductSource(sourceValue);
  if (!source) return "";
  try {
    await assertSafeProductSourceFetchUrl(source.apiBaseUrl);
    const website = await fetchTtmallWebsite(source, { timeoutMs });
    return normalizePublicOrigin(website?.WEBSITE_DOMAIN);
  } catch {
    return "";
  }
}

export function resetTtmallProductSourceCachesForTests() {
  resetTtmallClientCachesForTests();
}

async function hydrateTtmallProduct(source, row, { currency, website, timeoutMs, requireDetail = false }) {
  const productId = normalizeTtmallProductId(row?.product_id || row?.id);
  if (!productId) return normalizeTtmallProduct(row, { currency, source, website });
  const detailPayload = await fetchTtmallJson(source, `/v1/product/${encodeURIComponent(productId)}`, { timeoutMs }).catch((error) => {
    if (requireDetail) throw error;
    return null;
  });
  if (!detailPayload) return normalizeTtmallProduct(row, { currency, source, website });
  const detail = detailPayload?.data && typeof detailPayload.data === "object" ? detailPayload.data : {};
  let sizeChart = null;
  let sizeChartResolved = requireDetail;
  const sizeChartId = requireDetail ? normalizeTtmallProductId(detail.sizechart_template_id) : "";
  if (sizeChartId) {
    try {
      const sizePayload = await fetchTtmallJson(source, `/v1/sizechart/${encodeURIComponent(sizeChartId)}`, { timeoutMs });
      sizeChart = normalizeTtmallSizeChart(sizePayload?.data);
      sizeChartResolved = Boolean(sizeChart);
    } catch { sizeChartResolved = false; }
  }
  return normalizeTtmallProduct({ ...row, ...detail }, {
    currency,
    source,
    website,
    sizeChart,
    sizeChartResolved,
  });
}

async function hydrateSearchRows(source, rows, { currency, website, timeoutMs, detailTimeoutMs = timeoutMs, searchIntent }) {
  if (!searchNeedsCompleteDetailHydration(searchIntent)) {
    const detailRows = rows.slice(0, Math.min(rows.length, MAX_ENRICHED_DETAILS));
    return {
      details: await mapWithConcurrency(detailRows, DETAIL_CONCURRENCY, (row) => (
        hydrateTtmallProduct(source, row, { currency, website, timeoutMs: detailTimeoutMs })
      )),
      consumedRows: detailRows.length,
    };
  }

  const details = [];
  for (let offset = 0; offset < rows.length; offset += AGE_DETAIL_BATCH_SIZE) {
    const batch = rows.slice(offset, offset + AGE_DETAIL_BATCH_SIZE);
    const hydrated = await mapWithConcurrency(batch, DETAIL_CONCURRENCY, (row) => (
      hydrateTtmallProduct(source, row, { currency, website, timeoutMs: detailTimeoutMs })
    ));
    details.push(...hydrated);
    const exactMatches = filterProductsByIntent(details, searchIntent, { allowNearestAgeFallback: false });
    if (exactMatches.length >= AGE_MATCH_TARGET) break;
  }
  return { details, consumedRows: details.length };
}

function normalizeTtmallQuery(value = "") {
  const text = safeString(value);
  return !text || text === "recommended" ? "jersey" : text.slice(0, 160);
}

function searchNeedsCompleteDetailHydration(searchIntent = {}) {
  return Boolean(safeString(searchIntent.requestedAgeRange));
}

async function mapWithConcurrency(values, concurrency, mapper) {
  const results = new Array(values.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(values[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

function safeErrorName(error) {
  return safeString(error?.name || "Error").slice(0, 64);
}
