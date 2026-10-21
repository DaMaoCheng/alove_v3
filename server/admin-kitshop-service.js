import { getDbPool } from "./db.js";
import { getKitshopShelves } from "./kitshop-service.js";

const DEFAULT_PRODUCT_LIMIT = 12;
const MAX_PRODUCT_LIMIT = 50;
const SECTION_LIMIT = 40;

export async function getAdminKitshop({ site = "", productPage = 1, productLimit = DEFAULT_PRODUCT_LIMIT } = {}) {
  const sites = await listKitshopSites();
  const activeSite = resolveSelectedSite(sites, site);
  if (!activeSite) {
    return {
      ok: true,
      sites,
      site: null,
      summary: emptySummary(),
      products: [],
      productPagination: emptyProductPagination(),
      sections: [],
      rules: kitshopRules(),
    };
  }

  const [productResult, sections, summary] = await Promise.all([
    listCachedProducts(activeSite.id, { page: productPage, limit: productLimit }),
    listHomeSections(activeSite.id),
    loadSummary(activeSite.id),
  ]);

  return {
    ok: true,
    sites,
    site: activeSite,
    summary,
    products: productResult.items,
    productPagination: productResult.pagination,
    sections,
    rules: kitshopRules(),
  };
}

export async function refreshAdminKitshop({ site = "" } = {}, options = {}) {
  const sites = await listKitshopSites();
  const activeSite = resolveSelectedSite(sites, site);
  if (!activeSite) {
    const error = new Error("站点不存在或已停用");
    error.statusCode = 404;
    throw error;
  }

  const before = await loadSummary(activeSite.id);
  const refresh = await getKitshopShelves({
    siteSlug: activeSite.slug,
    forceRefresh: true,
    fetchProducts: options.fetchProducts,
    fetchHomepageSections: options.fetchHomepageSections,
    fetchSalesSnapshot: options.fetchSalesSnapshot,
  });
  const result = await getAdminKitshop({ site: activeSite.id });
  return {
    ...result,
    refresh: {
      ok: refresh.ok !== false && Boolean(refresh.cache?.refreshed) && !refresh.error,
      refreshed: Boolean(refresh.cache?.refreshed),
      stale: Boolean(refresh.cache?.stale),
      warning: refresh.adminWarning || refresh.warning || "",
      error: refresh.error || "",
      before,
      after: result.summary,
    },
  };
}

async function listKitshopSites() {
  const [rows] = await getDbPool().execute(
    `SELECT id, name, slug, site_url, currency, product_api_url,
            product_access_token_encrypted, site_status, is_default, updated_at
     FROM sites
     WHERE site_status = 'active'
     ORDER BY is_default DESC, name ASC, slug ASC`
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name || row.slug || row.id,
    slug: row.slug || "",
    siteUrl: row.site_url || "",
    currency: row.currency || "",
    hasProductSource: Boolean(row.product_api_url),
    hasProductAccessToken: Boolean(row.product_access_token_encrypted),
    isDefault: Boolean(row.is_default),
    updatedAt: row.updated_at,
  }));
}

function resolveSelectedSite(sites = [], site = "") {
  const value = String(site || "").trim();
  if (value && value !== "all") {
    return sites.find((item) => item.id === value || item.slug === value) || null;
  }
  return sites[0] || null;
}

async function listCachedProducts(siteId = "", { page = 1, limit = DEFAULT_PRODUCT_LIMIT } = {}) {
  const safePage = Math.max(1, Number(page || 1));
  const safeLimit = Math.max(1, Math.min(MAX_PRODUCT_LIMIT, Number(limit || DEFAULT_PRODUCT_LIMIT)));
  const [[countRow]] = await getDbPool().execute(
    `SELECT COUNT(*) AS total
     FROM site_product_cache
     WHERE site_id = ?`,
    [siteId]
  );
  const total = Number(countRow?.total || 0);
  const pages = Math.max(1, Math.ceil(total / safeLimit));
  const safeCurrentPage = Math.min(safePage, pages);
  const safeOffset = (safeCurrentPage - 1) * safeLimit;
  const [rows] = await getDbPool().execute(
    `SELECT id, site_id, site_slug, external_product_key, product_title, product_subtitle,
            product_url, image_url, price_now, price_was, stock_text, available,
            source_type, source_rank, cached_status, last_synced_at, updated_at
     FROM site_product_cache
     WHERE site_id = ?
     ORDER BY cached_status = 'active' DESC, source_rank ASC, updated_at DESC, id ASC
     LIMIT ${safeLimit} OFFSET ${safeOffset}`,
    [siteId]
  );
  return {
    items: rows.map((row) => ({
      id: row.id,
      siteId: row.site_id,
      siteSlug: row.site_slug || "",
      externalProductKey: row.external_product_key || "",
      title: row.product_title || "",
      subtitle: row.product_subtitle || "",
      url: row.product_url || "",
      imageUrl: row.image_url || "",
      priceNow: row.price_now || "",
      priceWas: row.price_was || "",
      stock: row.stock_text || "",
      available: row.available == null ? null : Boolean(row.available),
      sourceType: row.source_type || "",
      sourceRank: Number(row.source_rank || 0),
      status: row.cached_status || "active",
      lastSyncedAt: row.last_synced_at,
      updatedAt: row.updated_at,
    })),
    pagination: {
      page: safeCurrentPage,
      pages,
      total,
      limit: safeLimit,
    },
  };
}

async function listHomeSections(siteId = "") {
  const [rows] = await getDbPool().execute(
    `SELECT id, site_id, site_slug, theme_id, theme_name, section_key, section_type,
            section_title, collection_handles_json, product_handles_json, product_keys_json,
            source_rank, section_status, last_synced_at, updated_at
     FROM site_home_product_sections
     WHERE site_id = ?
     ORDER BY section_status = 'active' DESC, source_rank ASC, updated_at DESC, id ASC
     LIMIT ${SECTION_LIMIT}`,
    [siteId]
  );
  return rows.map((row) => {
    const productKeys = parseJson(row.product_keys_json, []);
    return {
      id: row.id,
      siteId: row.site_id,
      siteSlug: row.site_slug || "",
      themeId: row.theme_id || "",
      themeName: row.theme_name || "",
      sectionKey: row.section_key || "",
      sectionType: row.section_type || "",
      title: row.section_title || "",
      collectionHandles: parseJson(row.collection_handles_json, []),
      productHandles: parseJson(row.product_handles_json, []),
      productKeys,
      productCount: productKeys.length,
      sourceRank: Number(row.source_rank || 0),
      status: row.section_status || "active",
      lastSyncedAt: row.last_synced_at,
      updatedAt: row.updated_at,
    };
  });
}

async function loadSummary(siteId = "") {
  const [[productCounts]] = await getDbPool().execute(
    `SELECT
       SUM(cached_status = 'active') AS active_products,
       SUM(cached_status <> 'active') AS inactive_products,
       COUNT(*) AS total_products,
       MAX(last_synced_at) AS last_product_synced_at
     FROM site_product_cache
     WHERE site_id = ?`,
    [siteId]
  );
  const [[sectionCounts]] = await getDbPool().execute(
    `SELECT
       SUM(section_status = 'active') AS active_sections,
       COUNT(*) AS total_sections,
       MAX(last_synced_at) AS last_section_synced_at
     FROM site_home_product_sections
     WHERE site_id = ?`,
    [siteId]
  );

  return {
    activeProducts: Number(productCounts?.active_products || 0),
    inactiveProducts: Number(productCounts?.inactive_products || 0),
    totalProducts: Number(productCounts?.total_products || 0),
    activeSections: Number(sectionCounts?.active_sections || 0),
    totalSections: Number(sectionCounts?.total_sections || 0),
    lastProductSyncedAt: productCounts?.last_product_synced_at || null,
    lastSectionSyncedAt: sectionCounts?.last_section_synced_at || null,
  };
}

function emptySummary() {
  return {
    activeProducts: 0,
    inactiveProducts: 0,
    totalProducts: 0,
    activeSections: 0,
    totalSections: 0,
    lastProductSyncedAt: null,
    lastSectionSyncedAt: null,
  };
}

function emptyProductPagination() {
  return {
    page: 1,
    pages: 1,
    total: 0,
    limit: DEFAULT_PRODUCT_LIMIT,
  };
}

function kitshopRules() {
  return {
    recommended: "固定第一层为独立站首页按顺序遇到的第一个有效商品栏目，保留栏目标题和公开商品顺序。",
    bestSellers: "固定第二层 AIOVE Best Sellers：最近 30 天净销量前五、最近 60 天最多五个未重复热销商品，再从首页其他栏目随机补足到最多 15 件；最终去重并混排。",
    refresh: "前台访问超过 4 小时会自动刷新；后台按钮可手动触发当前站点刷新。",
  };
}

function parseJson(value, fallback) {
  if (value && typeof value === "object") return value;
  try {
    return JSON.parse(String(value || ""));
  } catch {
    return fallback;
  }
}
