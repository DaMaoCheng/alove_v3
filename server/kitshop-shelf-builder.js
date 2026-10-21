import { createHash } from "node:crypto";
import { createId } from "./security.js";

const KITSHOP_BEST_SELLERS_LIMIT = 15;
const KITSHOP_RECOMMENDED_LIMIT = 8;

export function normalizeCacheProducts(site = {}, products = []) {
  return (Array.isArray(products) ? products : [])
    .map((product, index) => normalizeCacheProduct(site, product, index))
    .filter(Boolean);
}

export function normalizeHomeProductSections(site = {}, sections = []) {
  return (Array.isArray(sections) ? sections : [])
    .map((section, index) => {
      const products = Array.isArray(section.products) ? section.products : [];
      const productKeys = uniqueStrings(products.map(normalizeProductKey));
      if (!section.sectionKey || !productKeys.length) return null;
      return {
        id: createId("hps"),
        siteId: site.id || "",
        siteSlug: site.slug || "",
        themeId: clip(section.themeId || "", 64),
        themeName: clip(section.themeName || "", 128),
        sectionKey: clip(section.sectionKey, 128),
        sectionType: clip(section.sectionType || "homepage-products", 96),
        sectionTitle: normalizeSectionTitle(section.sectionTitle || "Homepage products"),
        collectionHandles: Array.isArray(section.collectionHandles) ? section.collectionHandles : [],
        productHandles: Array.isArray(section.productHandles) ? section.productHandles : [],
        productKeys,
        sourceRank: Number(section.displayOrder || index + 1),
        rawSection: section.rawSection || {},
      };
    })
    .filter(Boolean);
}

export function mapCachedProducts(rows = []) {
  return (Array.isArray(rows) ? rows : []).map(mapCacheRow);
}

export function mapActiveHomepageSections(rows = []) {
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    sectionKey: row.section_key || "homepage-products",
    title: normalizeSectionTitle(row.section_title || "Homepage products"),
    productKeys: uniqueStrings(parseJson(row.product_keys_json, [])),
  }));
}

export function buildKitshopShelves(cacheRows = [], { homepageSections = [], salesSnapshot = null } = {}) {
  const rows = Array.isArray(cacheRows) ? cacheRows : [];
  const primary = buildPrimaryHomepageShelf(rows, homepageSections);
  const baseShelves = [primary.shelf || { key: "recommended", title: "Recommended", items: buildRecommendedProducts(rows) }];
  const used = new Set(baseShelves.flatMap((shelf) => shelf.items).map(productIdentity).filter(Boolean));
  const bestSellers = [];
  addRankedSalesProducts(bestSellers, used, rows, salesSnapshot?.rank30d, 5);
  addRankedSalesProducts(bestSellers, used, rows, salesSnapshot?.rank60d, 5);

  const remainingHomepageRows = buildRemainingHomepageRows(rows, homepageSections, primary.sectionIndex);
  for (const row of seededShuffle(remainingHomepageRows, `${salesSnapshot?.shuffleSeed || "kitshop"}:fallback`)) {
    addBestSeller(bestSellers, used, row);
    if (bestSellers.length >= KITSHOP_BEST_SELLERS_LIMIT) break;
  }
  const mixed = seededShuffle(bestSellers, `${salesSnapshot?.shuffleSeed || "kitshop"}:mixed`);
  return [...baseShelves, { key: "best_sellers", title: "Best Sellers", items: mixed }];
}

export function buildPreservedSalesProducts(cacheRows = [], salesSnapshot = null) {
  const keys = new Set([
    ...(Array.isArray(salesSnapshot?.rank30d) ? salesSnapshot.rank30d : []),
    ...(Array.isArray(salesSnapshot?.rank60d) ? salesSnapshot.rank60d : []),
  ].map((item) => normalizeIdentity(item?.productId)).filter(Boolean));
  return cacheRows.filter((row) => [...keys].some((key) => row.matches?.has(key))).map((row) => row.payload);
}

export function needsKitshopRefresh(cacheRows = [], now = new Date(), ttlMs = 0) {
  if (!cacheRows.length) return true;
  const last = latestKitshopSyncedAt(cacheRows);
  if (!last) return true;
  return new Date(now).getTime() - new Date(last).getTime() > ttlMs;
}

export function latestKitshopSyncedAt(cacheRows = []) {
  const times = cacheRows
    .map((row) => row.last_synced_at)
    .filter(Boolean)
    .map((value) => new Date(value).getTime())
    .filter(Number.isFinite);
  if (!times.length) return "";
  return new Date(Math.max(...times)).toISOString();
}

export function uniqueProducts(products = []) {
  const seen = new Set();
  const rows = [];
  for (const product of products) {
    const key = normalizeIdentity(normalizeProductKey(product));
    if (!key || seen.has(key)) continue;
    seen.add(key);
    rows.push(product);
  }
  return rows;
}

export function resolvePublicStorefrontUrl(cacheRows = []) {
  for (const row of Array.isArray(cacheRows) ? cacheRows : []) {
    const value = row?.payload?.url || row?.product_url || "";
    try {
      const url = new URL(value);
      if (url.protocol === "https:") return url.origin;
    } catch {
      // Ignore malformed cached URLs and continue to the next trusted product.
    }
  }
  return "";
}

export function shouldReplaceStorefrontUrl(value = "") {
  const text = String(value || "").trim();
  if (!text || text.startsWith("shopify-admin:")) return true;
  try {
    return new URL(text).hostname.toLowerCase().endsWith(".myshopify.com");
  } catch {
    return true;
  }
}

function normalizeCacheProduct(site = {}, product = {}, index = 0) {
  if (!product || typeof product !== "object") return null;
  const title = clip(product.name || product.title || "Product", 255);
  if (!title) return null;
  const externalProductKey = clip(normalizeProductKey(product), 191);
  const imageUrls = uniqueStrings([
    product.imageUrl,
    ...(Array.isArray(product.imageUrls) ? product.imageUrls : []),
  ]).slice(0, 8);
  const payload = {
    id: product.id || product.productId || externalProductKey,
    productId: product.productId || product.id || externalProductKey,
    name: title,
    subtitle: clip(product.subtitle || product.summary || product.stock || "", 255),
    imageUrl: imageUrls[0] || product.imageUrl || "/assets/jersey_product.png",
    imageUrls,
    priceNow: product.priceNow || product.price || "",
    priceWas: product.priceWas || "",
    currency: product.currency || "",
    code: product.code || "",
    tag: product.tag || (product.available === false ? "Sold out" : "Recommended"),
    url: product.url || "",
    stock: product.stock || "",
    summary: product.summary || product.description || "",
    available: product.available ?? null,
    sizes: Array.isArray(product.sizes) ? product.sizes : [],
    sizeChart: product.sizeChart && typeof product.sizeChart === "object" ? product.sizeChart : null,
    sizeChartResolved: product.sizeChartResolved === true,
    customizationOptions: Array.isArray(product.customizationOptions) ? product.customizationOptions : [],
    paymentMethods: Array.isArray(product.paymentMethods) ? product.paymentMethods : [],
    purchaseMode: product.purchaseMode || "",
    features: Array.isArray(product.features) ? product.features : [],
    siteId: site.id || "",
    siteSlug: site.slug || "",
  };
  return {
    id: createId("spc"),
    siteId: site.id || "",
    siteSlug: site.slug || "",
    externalProductKey,
    productTitle: title,
    productSubtitle: payload.subtitle,
    productUrl: clip(product.url || "", 512),
    imageUrl: clip(payload.imageUrl, 512),
    imageUrls,
    priceNow: clip(payload.priceNow, 64),
    priceWas: clip(payload.priceWas, 64),
    stockText: clip(product.stock || "", 128),
    available: product.available === true ? 1 : product.available === false ? 0 : null,
    sizes: payload.sizes,
    features: payload.features,
    payload,
    sourceType: "site_source",
    sourceRank: index + 1,
  };
}

function mapCacheRow(row = {}) {
  const payload = parseJson(row.product_payload_json, {});
  const normalizedPayload = {
    ...payload,
    id: payload.id || row.external_product_key || row.id || "",
    productId: payload.productId || payload.id || row.external_product_key || "",
    name: payload.name || row.product_title || "Product",
    subtitle: payload.subtitle || row.product_subtitle || "",
    imageUrl: payload.imageUrl || row.image_url || "/assets/jersey_product.png",
    imageUrls: Array.isArray(payload.imageUrls) ? payload.imageUrls : parseJson(row.image_urls_json, []),
    priceNow: payload.priceNow || row.price_now || "",
    priceWas: payload.priceWas || row.price_was || "",
    currency: payload.currency || "",
    url: payload.url || row.product_url || "",
    stock: payload.stock || row.stock_text || "",
    available: payload.available ?? (row.available == null ? null : Boolean(row.available)),
    sizes: Array.isArray(payload.sizes) ? payload.sizes : parseJson(row.sizes_json, []),
    sizeChart: payload.sizeChart && typeof payload.sizeChart === "object" ? payload.sizeChart : null,
    sizeChartResolved: payload.sizeChartResolved === true,
    customizationOptions: Array.isArray(payload.customizationOptions) ? payload.customizationOptions : [],
    paymentMethods: Array.isArray(payload.paymentMethods) ? payload.paymentMethods : [],
    purchaseMode: payload.purchaseMode || "",
    features: Array.isArray(payload.features) ? payload.features : parseJson(row.features_json, []),
    siteId: payload.siteId || row.site_id || "",
    siteSlug: payload.siteSlug || row.site_slug || "",
  };
  const matches = new Set([
    normalizeIdentity(row.external_product_key),
    normalizeIdentity(normalizedPayload.id),
    normalizeIdentity(normalizedPayload.productId),
    normalizeIdentity(normalizedPayload.url),
    normalizeIdentity(normalizedPayload.name),
  ].filter(Boolean));
  return {
    ...row,
    payload: normalizedPayload,
    matches,
  };
}

function buildPrimaryHomepageShelf(rows = [], homepageSections = []) {
  const sections = Array.isArray(homepageSections) ? homepageSections : [];
  for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex += 1) {
    const section = sections[sectionIndex];
    const items = buildProductsFromKeys(rows, section.productKeys);
    if (!items.length) continue;
    return {
      sectionIndex,
      shelf: {
        key: `homepage:${section.sectionKey}`,
        title: section.title || "Homepage products",
        items,
      },
    };
  }
  return { sectionIndex: -1, shelf: null };
}

function buildRemainingHomepageRows(rows, homepageSections, primarySectionIndex) {
  const candidates = [];
  const seen = new Set();
  const sections = Array.isArray(homepageSections) ? homepageSections : [];
  for (let index = 0; index < sections.length; index += 1) {
    if (index === primarySectionIndex) continue;
    for (const key of Array.isArray(sections[index]?.productKeys) ? sections[index].productKeys : []) {
      const matchKey = normalizeIdentity(key);
      const match = rows.find((row) => row.matches.has(matchKey));
      const identity = productIdentity(match?.payload);
      if (!match || !identity || seen.has(identity)) continue;
      seen.add(identity);
      candidates.push(match);
    }
  }
  return candidates;
}

function addRankedSalesProducts(target, used, rows, ranking, limit) {
  let added = 0;
  for (const item of Array.isArray(ranking) ? ranking : []) {
    const key = normalizeIdentity(typeof item === "string" ? item : item?.productId);
    const match = key ? rows.find((row) => row.matches.has(key)) : null;
    if (!addBestSeller(target, used, match)) continue;
    added += 1;
    if (added >= limit || target.length >= KITSHOP_BEST_SELLERS_LIMIT) break;
  }
}

function addBestSeller(target, used, row) {
  const identity = productIdentity(row?.payload);
  if (!row || !identity || used.has(identity)) return false;
  target.push({ ...row.payload, tag: row.payload.tag || "Best Seller" });
  used.add(identity);
  return true;
}

function seededShuffle(values, seed) {
  const shuffled = [...values];
  let state = seedToUint32(seed);
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const swapIndex = Math.floor((state / 0x100000000) * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

function seedToUint32(seed) {
  const hex = createHash("sha256").update(String(seed || "kitshop")).digest("hex").slice(0, 8);
  return Number.parseInt(hex, 16) >>> 0;
}

function buildProductsFromKeys(rows = [], productKeys = []) {
  const products = [];
  const used = new Set();
  for (const key of productKeys) {
    const matchKey = normalizeIdentity(key);
    const match = rows.find((row) => row.matches.has(matchKey));
    if (!match) continue;
    const identity = productIdentity(match.payload);
    if (used.has(identity)) continue;
    products.push(match.payload);
    used.add(identity);
  }
  return products;
}

function buildRecommendedProducts(rows = []) {
  const recommended = [];
  const used = new Set();
  for (const row of rows) {
    const identity = productIdentity(row.payload);
    if (used.has(identity)) continue;
    recommended.push(row.payload);
    used.add(identity);
    if (recommended.length >= KITSHOP_RECOMMENDED_LIMIT) break;
  }
  return recommended;
}

function normalizeProductKey(product = {}) {
  const key = product.productId || product.id || product.sku || product.url || product.name || product.title;
  if (key) return String(key).trim();
  return createHash("sha1").update(JSON.stringify(product || {})).digest("hex");
}

function productIdentity(product = {}) {
  return normalizeIdentity(product.productId || product.id || product.url || product.name);
}

function normalizeIdentity(value = "") {
  return String(value || "").trim().toLowerCase();
}

function uniqueStrings(values = []) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function parseJson(value, fallback) {
  if (value == null || value === "") return fallback;
  if (typeof value === "object") return value;
  try {
    const parsed = JSON.parse(value);
    return parsed == null ? fallback : parsed;
  } catch {
    return fallback;
  }
}

function clip(value, max) {
  const text = String(value == null ? "" : value).trim().replace(/\s+/g, " ");
  return text.length > max ? text.slice(0, max) : text;
}

function normalizeSectionTitle(value = "") {
  return clip(String(value || "").replace(/<[^>]*>/g, " "), 255) || "Homepage products";
}
