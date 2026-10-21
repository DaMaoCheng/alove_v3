import { SERVER_CONFIG } from "./config.js";
import { normalizeCurrency, normalizeShopifyAdminProduct } from "./product-normalizer.js";
import { isVisibleShopifyAdminProduct, parseShopifyAdminSource, resolveShopifyAdminToken } from "./product-source-shopify-admin-service.js";
import { resolveShopifyMarketContext } from "./shopify-market-context-service.js";
import { safeString } from "./product-source-shared-service.js";

const HOMEPAGE_PRODUCT_SECTION_TYPES = new Set([
  "featured-collection",
  "featured_collection",
  "collection-list",
  "collection_list",
  "featured-product",
  "featured_product",
]);
const MAX_HOMEPAGE_SECTIONS = 12;
const DEFAULT_SECTION_PRODUCTS = 8;
const MAX_SECTION_PRODUCTS = 16;
const COLLECTION_PAGE_SIZE = 50;
const MAX_COLLECTION_PAGES = 5;
const PAGEFLY_SECTION_TYPE_PREFIX = "pagefly";
const PAGEFLY_COLLECTION_ASSIGNMENT = /\{%[-\s]*assign\s+(collection_[A-Za-z0-9_]+)\s*=\s*collections\[\s*["']([^"']+)["']\s*\]\s*[-]?%\}/g;
const PAGEFLY_COLLECTION_LOOP = /\{%[-\s]*paginate\s+(collection_[A-Za-z0-9_]+)\.products\s+by\s+(\d+)\s*[-]?%\}/g;

export async function fetchShopifyHomepageProductSections(site = {}, { timeoutMs = SERVER_CONFIG.productApi.timeoutMs } = {}) {
  const source = parseShopifyAdminSource(site.product_api_url || "");
  if (!source) return [];
  const token = resolveShopifyAdminToken(source.tokenEnv, site.product_access_token_encrypted || "");
  if (!token) throw new Error("Shopify Admin access token is not configured");
  const marketContext = await resolveShopifyMarketContext({
    endpoint: source.endpoint,
    token,
    currency: site.currency,
    countryCode: site.market_country_code || site.marketCountryCode || "",
    timeoutMs,
  });
  const marketSite = { ...site, currency: marketContext.currency };

  const mainTheme = await fetchMainTheme(source, token, timeoutMs);
  if (!mainTheme?.id) throw new Error("Shopify main theme was not found");
  const homepageTemplate = await fetchThemeAssetJson(source, token, mainTheme.id, "templates/index.json", timeoutMs);
  const nativeSectionRefs = extractHomepageSectionRefs(homepageTemplate);
  const sectionRefs = nativeSectionRefs.length
    ? nativeSectionRefs
    : await fetchPageflyHomepageSectionRefs(source, token, mainTheme.id, homepageTemplate, timeoutMs);
  const sections = [];
  for (const sectionRef of sectionRefs) {
    const resolved = await fetchSectionProducts(source, token, marketSite, sectionRef, marketContext.countryCode, timeoutMs);
    sections.push({
      ...sectionRef,
      sectionTitle: resolved.collectionTitle || sectionRef.sectionTitle,
      themeId: String(mainTheme.id),
      themeName: mainTheme.name || "",
      products: resolved.products,
    });
  }
  return sections.filter((section) => section.products.length);
}

export function extractHomepageSectionRefs(template = {}) {
  const sections = template?.sections && typeof template.sections === "object" ? template.sections : {};
  const order = Array.isArray(template?.order) ? template.order : Object.keys(sections);
  const refs = [];
  for (const sectionKey of order) {
    const section = sections[sectionKey];
    if (!section || section.disabled) continue;
    const type = normalizeSectionType(section.type);
    if (!HOMEPAGE_PRODUCT_SECTION_TYPES.has(type)) continue;
    const settings = section.settings && typeof section.settings === "object" ? section.settings : {};
    const collectionHandles = extractCollectionHandles(settings);
    const productHandles = extractProductHandles(settings);
    if (!collectionHandles.length && !productHandles.length) continue;
    refs.push({
      sectionKey: safeString(sectionKey),
      sectionType: type,
      sectionTitle: safeString(settings.title || settings.heading || settings.main_heading || section.type || "Homepage products"),
      collectionHandles,
      productHandles,
      productLimit: normalizeProductLimit(settings.products_to_show || settings.product_limit || settings.limit || DEFAULT_SECTION_PRODUCTS),
      displayOrder: refs.length + 1,
      rawSection: section,
    });
    if (refs.length >= MAX_HOMEPAGE_SECTIONS) break;
  }
  return refs;
}

export function extractPageflyHomepageSectionRefs(liquid = "", { sectionKey = "pagefly-home", displayOrder = 1 } = {}) {
  const source = safeString(liquid);
  if (!source) return [];

  const collectionHandles = new Map();
  for (const match of source.matchAll(PAGEFLY_COLLECTION_ASSIGNMENT)) {
    const alias = safeString(match[1]);
    const handle = extractHandle(match[2]);
    if (alias && handle) collectionHandles.set(alias, handle);
  }

  const refs = [];
  const seenHandles = new Set();
  for (const match of source.matchAll(PAGEFLY_COLLECTION_LOOP)) {
    const handle = collectionHandles.get(safeString(match[1])) || "";
    if (!handle || seenHandles.has(handle)) continue;
    seenHandles.add(handle);
    refs.push({
      sectionKey: `${safeString(sectionKey) || "pagefly-home"}:${handle}`.slice(0, 128),
      sectionType: "pagefly-collection",
      sectionTitle: "",
      collectionHandles: [handle],
      productHandles: [],
      productLimit: normalizeProductLimit(match[2]),
      displayOrder: Number(displayOrder || 1) + refs.length,
      rawSection: { type: "pagefly-home", collectionHandle: handle },
    });
    if (refs.length >= MAX_HOMEPAGE_SECTIONS) break;
  }
  return refs;
}

async function fetchMainTheme(source, token, timeoutMs) {
  const payload = await shopifyRestGet(source, token, "/themes.json", {}, timeoutMs);
  const themes = Array.isArray(payload?.themes) ? payload.themes : [];
  return themes.find((theme) => theme.role === "main") || null;
}

async function fetchThemeAssetJson(source, token, themeId, assetKey, timeoutMs) {
  const value = await fetchThemeAssetValue(source, token, themeId, assetKey, timeoutMs);
  return JSON.parse(value);
}

async function fetchThemeAssetValue(source, token, themeId, assetKey, timeoutMs) {
  const payload = await shopifyRestGet(source, token, `/themes/${encodeURIComponent(themeId)}/assets.json`, {
    "asset[key]": assetKey,
  }, timeoutMs);
  const value = payload?.asset?.value || "";
  if (!value) throw new Error(`Shopify theme asset was not found: ${assetKey}`);
  return value;
}

async function fetchPageflyHomepageSectionRefs(source, token, themeId, homepageTemplate, timeoutMs) {
  const sections = homepageTemplate?.sections && typeof homepageTemplate.sections === "object" ? homepageTemplate.sections : {};
  const order = Array.isArray(homepageTemplate?.order) ? homepageTemplate.order : Object.keys(sections);
  const refs = [];
  for (const sectionKey of order) {
    const section = sections[sectionKey];
    const type = safeString(section?.type).toLowerCase();
    if (!section || section.disabled || !type.startsWith(PAGEFLY_SECTION_TYPE_PREFIX)) continue;
    try {
      const liquid = await fetchThemeAssetValue(source, token, themeId, `sections/${type}.liquid`, timeoutMs);
      refs.push(...extractPageflyHomepageSectionRefs(liquid, {
        sectionKey: safeString(sectionKey),
        displayOrder: refs.length + 1,
      }));
    } catch {
      // PageFly assets are optional; retain the existing empty-homepage fallback if one cannot be read.
    }
    if (refs.length >= MAX_HOMEPAGE_SECTIONS) break;
  }
  return refs.slice(0, MAX_HOMEPAGE_SECTIONS);
}

async function fetchSectionProducts(source, token, site, sectionRef, marketCountryCode, timeoutMs) {
  const products = [];
  const seen = new Set();
  let collectionTitle = "";
  for (const handle of sectionRef.productHandles) {
    const product = await fetchProductByHandle(source, token, site, handle, marketCountryCode, timeoutMs);
    addProduct(products, seen, product);
    if (products.length >= sectionRef.productLimit) return { products, collectionTitle };
  }
  for (const handle of sectionRef.collectionHandles) {
    const collection = await fetchCollectionProducts(source, token, site, handle, sectionRef.productLimit, marketCountryCode, timeoutMs);
    if (!collectionTitle && collection.title) collectionTitle = collection.title;
    for (const product of collection.products) {
      addProduct(products, seen, product);
      if (products.length >= sectionRef.productLimit) return { products, collectionTitle };
    }
  }
  return { products, collectionTitle };
}

async function fetchCollectionProducts(source, token, site, handle, productLimit, marketCountryCode, timeoutMs) {
  const limit = normalizeProductLimit(productLimit);
  const products = [];
  let title = "";
  let after = null;
  for (let page = 0; page < MAX_COLLECTION_PAGES && products.length < limit; page += 1) {
    const payload = await shopifyGraphql(source, token, buildCollectionProductsQuery(), {
      handle,
      first: COLLECTION_PAGE_SIZE,
      after,
      country: marketCountryCode,
    }, timeoutMs);
    const collection = payload?.data?.collectionByHandle;
    if (!title) title = safeString(collection?.title);
    const connection = collection?.products;
    products.push(...normalizeVisibleShopifyHomepageProducts(connection?.edges, {
      currency: normalizeCurrency(site.currency),
      shopDomain: source.shopDomain,
      limit: limit - products.length,
    }));
    if (!connection?.pageInfo?.hasNextPage || !connection.pageInfo.endCursor) break;
    after = connection.pageInfo.endCursor;
  }
  return { products: products.slice(0, limit), title };
}

async function fetchProductByHandle(source, token, site, handle, marketCountryCode, timeoutMs) {
  const payload = await shopifyGraphql(source, token, buildProductByHandleQuery(), { handle, country: marketCountryCode }, timeoutMs);
  const product = payload?.data?.productByHandle;
  if (!isVisibleShopifyAdminProduct(product)) return null;
  return normalizeShopifyAdminProduct(product, { currency: normalizeCurrency(site.currency), shopDomain: source.shopDomain });
}

export function normalizeVisibleShopifyHomepageProducts(edges = [], { currency = "", shopDomain = "", limit = MAX_SECTION_PRODUCTS } = {}) {
  return (Array.isArray(edges) ? edges : [])
    .map((edge) => edge?.node)
    .filter(isVisibleShopifyAdminProduct)
    .map((product) => normalizeShopifyAdminProduct(product, { currency, shopDomain }))
    .filter((product) => product.name)
    .slice(0, normalizeProductLimit(limit));
}

async function shopifyRestGet(source, token, path, params = {}, timeoutMs = SERVER_CONFIG.productApi.timeoutMs) {
  const url = new URL(`/admin/api/${source.apiVersion}${path}`, `https://${source.shopDomain}`);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  const response = await shopifyFetch(url, token, timeoutMs, { method: "GET" });
  return response.json();
}

async function shopifyGraphql(source, token, query, variables = {}, timeoutMs = SERVER_CONFIG.productApi.timeoutMs) {
  const response = await shopifyFetch(source.endpoint, token, timeoutMs, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const payload = await response.json();
  if (Array.isArray(payload.errors) && payload.errors.length) {
    throw new Error(payload.errors.map((item) => item?.message).filter(Boolean).join("; ") || "Shopify GraphQL error");
  }
  return payload;
}

async function shopifyFetch(url, token, timeoutMs, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, Number(timeoutMs || 3000)));
  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        Accept: "application/json",
        "User-Agent": "AIOVE Shopify Homepage Reader",
        "X-Shopify-Access-Token": token,
        ...(options.headers || {}),
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Shopify homepage read HTTP ${response.status}`);
    return response;
  } finally {
    clearTimeout(timer);
  }
}

function buildCollectionProductsQuery() {
  return `
query AioveHomepageCollection($handle: String!, $first: Int!, $after: String, $country: CountryCode!) {
  collectionByHandle(handle: $handle) {
    id
    handle
    title
    products(first: $first, after: $after) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id
          title
          handle
          status
          vendor
          productType
          totalInventory
          onlineStoreUrl
          featuredImage { url }
          images(first: 8) { edges { node { url } } }
          customization: metafield(namespace: "alove", key: "customization_options") {
            type
            value
            updatedAt
          }
          variants(first: 100) {
            nodes {
                id
                title
                sku
                contextualPricing(context: { country: $country }) {
                  price { amount currencyCode }
                  compareAtPrice { amount currencyCode }
                }
                availableForSale
                inventoryQuantity
                selectedOptions { name value }
              }
            }
          }
        }
      }
    }
  }
`;
}

function buildProductByHandleQuery() {
  return `
query AioveHomepageProduct($handle: String!, $country: CountryCode!) {
  productByHandle(handle: $handle) {
    id
    title
    handle
    status
    vendor
    productType
    totalInventory
    onlineStoreUrl
    featuredImage { url }
    images(first: 8) { edges { node { url } } }
    customization: metafield(namespace: "alove", key: "customization_options") {
      type
      value
      updatedAt
    }
    variants(first: 100) {
      nodes {
          id
          title
          sku
          contextualPricing(context: { country: $country }) {
            price { amount currencyCode }
            compareAtPrice { amount currencyCode }
          }
          availableForSale
          inventoryQuantity
          selectedOptions { name value }
        }
      }
    }
  }
`;
}

function extractCollectionHandles(settings = {}) {
  return uniqueHandles([
    settings.collection,
    settings.collection_handle,
    settings.featured_collection,
    settings.collection_1,
    settings.collection_2,
    settings.collection_3,
    ...(Array.isArray(settings.collection_list) ? settings.collection_list : []),
    ...(Array.isArray(settings.collections) ? settings.collections : []),
  ]);
}

function extractProductHandles(settings = {}) {
  return uniqueHandles([
    settings.product,
    settings.product_handle,
    settings.featured_product,
    settings.product_1,
    settings.product_2,
    settings.product_3,
    ...(Array.isArray(settings.product_list) ? settings.product_list : []),
    ...(Array.isArray(settings.products) ? settings.products : []),
  ]);
}

function uniqueHandles(values = []) {
  return [...new Set(values.map(extractHandle).filter(Boolean))];
}

function extractHandle(value = "") {
  const text = safeString(value);
  if (!text) return "";
  const gidMatch = text.match(/\/(?:Collection|Product)\/([^/?#]+)$/i);
  if (gidMatch) return safeString(gidMatch[1]);
  try {
    const url = new URL(text, "https://example.test");
    const parts = url.pathname.split("/").filter(Boolean);
    return safeString(parts.at(-1) || text);
  } catch {
    return text.replace(/^collections\//, "").replace(/^products\//, "");
  }
}

function addProduct(products, seen, product) {
  if (!product?.name) return;
  const key = safeString(product.id || product.url || product.name).toLowerCase();
  if (!key || seen.has(key)) return;
  seen.add(key);
  products.push(product);
}

function normalizeSectionType(value = "") {
  return safeString(value).toLowerCase().replace(/_/g, "-");
}

function normalizeProductLimit(value = DEFAULT_SECTION_PRODUCTS) {
  const limit = Number(value);
  if (!Number.isFinite(limit)) return DEFAULT_SECTION_PRODUCTS;
  return Math.max(1, Math.min(MAX_SECTION_PRODUCTS, Math.trunc(limit)));
}
