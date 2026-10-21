import { getDbPool } from "./db.js";

const KITSHOP_CACHE_READ_LIMIT = 256;

export async function upsertProductCacheRows(siteId = "", rows = [], now = new Date()) {
  if (!rows.length) return;
  const syncedAt = toMysqlDate(now);
  for (const row of rows) {
    await getDbPool().execute(
      `INSERT INTO site_product_cache (
         id, site_id, site_slug, external_product_key, product_title, product_subtitle,
         product_url, image_url, image_urls_json, price_now, price_was, stock_text,
         available, sizes_json, features_json, product_payload_json, source_type,
         source_rank, cached_status, last_synced_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), ?, ?, ?, ?, CAST(? AS JSON), CAST(? AS JSON), CAST(? AS JSON), ?, ?, 'active', ?)
       ON DUPLICATE KEY UPDATE
         site_slug = VALUES(site_slug),
         product_title = VALUES(product_title),
         product_subtitle = VALUES(product_subtitle),
         product_url = VALUES(product_url),
         image_url = VALUES(image_url),
         image_urls_json = VALUES(image_urls_json),
         price_now = VALUES(price_now),
         price_was = VALUES(price_was),
         stock_text = VALUES(stock_text),
         available = VALUES(available),
         sizes_json = VALUES(sizes_json),
         features_json = VALUES(features_json),
         product_payload_json = VALUES(product_payload_json),
         source_type = VALUES(source_type),
         source_rank = VALUES(source_rank),
         cached_status = 'active',
         last_synced_at = VALUES(last_synced_at),
         updated_at = CURRENT_TIMESTAMP(3)`,
      [
        row.id,
        row.siteId,
        row.siteSlug,
        row.externalProductKey,
        row.productTitle,
        row.productSubtitle,
        row.productUrl,
        row.imageUrl,
        JSON.stringify(row.imageUrls),
        row.priceNow,
        row.priceWas,
        row.stockText,
        row.available,
        JSON.stringify(row.sizes),
        JSON.stringify(row.features),
        JSON.stringify(row.payload),
        row.sourceType,
        row.sourceRank,
        syncedAt,
      ]
    );
  }
  await markMissingProductsInactive(siteId, rows.map((row) => row.externalProductKey));
}

export async function upsertHomeProductSectionRows(siteId = "", rows = [], now = new Date()) {
  if (!rows.length) {
    await markAllHomeSectionsInactive(siteId);
    return;
  }
  const syncedAt = toMysqlDate(now);
  for (const row of rows) {
    await getDbPool().execute(
      `INSERT INTO site_home_product_sections (
         id, site_id, site_slug, theme_id, theme_name, section_key, section_type, section_title,
         collection_handles_json, product_handles_json, product_keys_json, source_rank,
         section_status, raw_section_json, last_synced_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), CAST(? AS JSON), CAST(? AS JSON), ?, 'active', CAST(? AS JSON), ?)
       ON DUPLICATE KEY UPDATE
         site_slug = VALUES(site_slug),
         theme_id = VALUES(theme_id),
         theme_name = VALUES(theme_name),
         section_type = VALUES(section_type),
         section_title = VALUES(section_title),
         collection_handles_json = VALUES(collection_handles_json),
         product_handles_json = VALUES(product_handles_json),
         product_keys_json = VALUES(product_keys_json),
         source_rank = VALUES(source_rank),
         section_status = 'active',
         raw_section_json = VALUES(raw_section_json),
         last_synced_at = VALUES(last_synced_at),
         updated_at = CURRENT_TIMESTAMP(3)`,
      [
        row.id,
        row.siteId,
        row.siteSlug,
        row.themeId,
        row.themeName,
        row.sectionKey,
        row.sectionType,
        row.sectionTitle,
        JSON.stringify(row.collectionHandles),
        JSON.stringify(row.productHandles),
        JSON.stringify(row.productKeys),
        row.sourceRank,
        JSON.stringify(row.rawSection),
        syncedAt,
      ]
    );
  }
  await markMissingHomeSectionsInactive(siteId, rows.map((row) => row.sectionKey));
}

export async function listCachedProductRows(siteId = "") {
  const [rows] = await getDbPool().execute(
    `SELECT id, site_id, site_slug, external_product_key, product_title, product_subtitle,
            product_url, image_url, image_urls_json, price_now, price_was, stock_text,
            available, sizes_json, features_json, product_payload_json, source_rank,
            last_synced_at, updated_at
     FROM site_product_cache
     WHERE site_id = ? AND cached_status = 'active'
     ORDER BY source_rank ASC, updated_at DESC, id ASC
     LIMIT ${KITSHOP_CACHE_READ_LIMIT}`,
    [siteId]
  );
  return rows;
}

export async function listActiveHomepageSectionRows(siteId = "") {
  const [rows] = await getDbPool().execute(
    `SELECT section_key, section_title, product_keys_json
     FROM site_home_product_sections
     WHERE site_id = ? AND section_status = 'active'
     ORDER BY source_rank ASC, updated_at DESC, id ASC
     LIMIT 40`,
    [siteId]
  );
  return rows;
}

export async function getKitshopSalesSnapshot(siteId = "") {
  const [rows] = await getDbPool().execute(
    `SELECT site_id, site_slug, rank_30d_json, rank_60d_json, shuffle_seed,
            included_order_count, sync_status, last_attempt_at, last_synced_at
     FROM site_kitshop_sales_cache
     WHERE site_id = ?
     LIMIT 1`,
    [siteId]
  );
  const row = rows[0];
  if (!row) return null;
  return {
    rank30d: parseJson(row.rank_30d_json, []),
    rank60d: parseJson(row.rank_60d_json, []),
    shuffleSeed: row.shuffle_seed || "",
    includedOrderCount: Number(row.included_order_count || 0),
    syncStatus: row.sync_status || "ready",
    lastAttemptAt: row.last_attempt_at ? new Date(row.last_attempt_at).toISOString() : "",
    generatedAt: row.last_synced_at ? new Date(row.last_synced_at).toISOString() : "",
  };
}

export async function upsertKitshopSalesSnapshot(site = {}, snapshot = {}, now = new Date()) {
  await getDbPool().execute(
    `INSERT INTO site_kitshop_sales_cache (
       site_id, site_slug, rank_30d_json, rank_60d_json, shuffle_seed,
       included_order_count, sync_status, last_attempt_at, last_synced_at
     ) VALUES (?, ?, CAST(? AS JSON), CAST(? AS JSON), ?, ?, 'ready', ?, ?)
     ON DUPLICATE KEY UPDATE
       site_slug = VALUES(site_slug),
       rank_30d_json = VALUES(rank_30d_json),
       rank_60d_json = VALUES(rank_60d_json),
       shuffle_seed = VALUES(shuffle_seed),
       included_order_count = VALUES(included_order_count),
       sync_status = 'ready',
       last_attempt_at = VALUES(last_attempt_at),
       last_synced_at = VALUES(last_synced_at),
       updated_at = CURRENT_TIMESTAMP(3)`,
    [
      site.id || "",
      site.slug || "",
      JSON.stringify(sanitizeSalesRanking(snapshot.rank30d)),
      JSON.stringify(sanitizeSalesRanking(snapshot.rank60d)),
      String(snapshot.shuffleSeed || "").slice(0, 64),
      Math.max(0, Number(snapshot.includedOrderCount || 0)),
      toMysqlDate(now),
      toMysqlDate(now),
    ]
  );
}

export async function markKitshopSalesSnapshotFailed(site = {}, now = new Date()) {
  if (!site.id) return;
  await getDbPool().execute(
    `INSERT INTO site_kitshop_sales_cache (
       site_id, site_slug, rank_30d_json, rank_60d_json, shuffle_seed,
       included_order_count, sync_status, last_attempt_at, last_synced_at
     ) VALUES (?, ?, JSON_ARRAY(), JSON_ARRAY(), '', 0, 'stale', ?, NULL)
     ON DUPLICATE KEY UPDATE
       site_slug = VALUES(site_slug),
       sync_status = 'stale',
       last_attempt_at = VALUES(last_attempt_at),
       updated_at = CURRENT_TIMESTAMP(3)`,
    [site.id, site.slug || "", toMysqlDate(now)]
  );
}

async function markAllHomeSectionsInactive(siteId = "") {
  if (!siteId) return;
  await getDbPool().execute(
    `UPDATE site_home_product_sections
     SET section_status = 'inactive', updated_at = CURRENT_TIMESTAMP(3)
     WHERE site_id = ? AND section_status = 'active'`,
    [siteId]
  );
}

async function markMissingHomeSectionsInactive(siteId = "", activeSectionKeys = []) {
  const keys = uniqueStrings(activeSectionKeys);
  if (!siteId || !keys.length) return;
  const placeholders = keys.map(() => "?").join(", ");
  await getDbPool().execute(
    `UPDATE site_home_product_sections
     SET section_status = 'inactive', updated_at = CURRENT_TIMESTAMP(3)
     WHERE site_id = ?
       AND section_status = 'active'
       AND section_key NOT IN (${placeholders})`,
    [siteId, ...keys]
  );
}

async function markMissingProductsInactive(siteId = "", activeProductKeys = []) {
  const keys = uniqueStrings(activeProductKeys);
  if (!siteId || !keys.length) return;
  const placeholders = keys.map(() => "?").join(", ");
  await getDbPool().execute(
    `UPDATE site_product_cache
     SET cached_status = 'inactive', updated_at = CURRENT_TIMESTAMP(3)
     WHERE site_id = ?
       AND cached_status = 'active'
       AND external_product_key NOT IN (${placeholders})`,
    [siteId, ...keys]
  );
}

function uniqueStrings(values = []) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function parseJson(value, fallback) {
  if (value == null || value === "") return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function sanitizeSalesRanking(values) {
  return (Array.isArray(values) ? values : []).map((item) => ({
    productId: String(item?.productId || "").trim(),
    units: Math.max(0, Number(item?.units || 0)),
  })).filter((item) => item.productId && item.units > 0);
}

function toMysqlDate(value = new Date()) {
  const date = new Date(value);
  const pad = (number, size = 2) => String(number).padStart(size, "0");
  return [
    date.getFullYear(),
    "-",
    pad(date.getMonth() + 1),
    "-",
    pad(date.getDate()),
    " ",
    pad(date.getHours()),
    ":",
    pad(date.getMinutes()),
    ":",
    pad(date.getSeconds()),
    ".",
    pad(date.getMilliseconds(), 3),
  ].join("");
}
