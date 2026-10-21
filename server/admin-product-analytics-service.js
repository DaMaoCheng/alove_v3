import { getDbPool } from "./db.js";

const RANGE_DAYS = Object.freeze({ today: 1, "7d": 7, "30d": 30 });
const SOURCES = Object.freeze(["chat", "search", "kitshop"]);
const IMPRESSION_EVENTS = new Set([
  "product_bubble_impression",
  "product_search_result_impression",
  "product_kitshop_impression",
]);
const CLICK_EVENTS = new Set([
  "product_bubble_click",
  "product_search_result_click",
  "product_kitshop_card_click",
]);
const DETAIL_EVENT = "product_detail_open";
const CTA_EVENT = "product_detail_cta_click";
const FUNNEL_EVENT_TYPES = [...IMPRESSION_EVENTS, ...CLICK_EVENTS, DETAIL_EVENT, CTA_EVENT];

export async function getAdminProductAnalyticsOverview({ range = "7d", site = "all" } = {}) {
  const days = RANGE_DAYS[String(range || "").trim()] || RANGE_DAYS["7d"];
  const normalizedSite = safeString(site);
  const params = [days];
  const siteFilter = normalizedSite && normalizedSite !== "all" ? " AND (site_id = ? OR site_slug = ?)" : "";
  if (siteFilter) params.push(normalizedSite, normalizedSite);

  const [countRows] = await getDbPool().execute(
    `SELECT event_type, source, message_id, COUNT(*) AS count
     FROM product_analytics_events
     WHERE created_at >= DATE_SUB(NOW(3), INTERVAL ? DAY)
       ${siteFilter}
       AND event_type IN (${FUNNEL_EVENT_TYPES.map(() => "?").join(", ")})
     GROUP BY event_type, source, message_id`,
    [...params, ...FUNNEL_EVENT_TYPES]
  );
  const sources = buildSourceCounts(countRows);

  const [productRows] = await getDbPool().execute(
    `SELECT
       COALESCE(
         NULLIF(e.product_id, ''),
         NULLIF(e.product_url, ''),
         NULLIF(JSON_UNQUOTE(JSON_EXTRACT(m.product_payload_json, '$.url')), ''),
         NULLIF(e.product_title, ''),
         NULLIF(JSON_UNQUOTE(JSON_EXTRACT(m.product_payload_json, '$.name')), ''),
         NULLIF(m.text_content, ''),
         'unknown'
       ) AS product_key,
       CASE
         WHEN e.event_type IN ('product_search_result_impression', 'product_search_result_click') OR e.source = 'search' THEN 'search'
         WHEN e.event_type IN ('product_kitshop_impression', 'product_kitshop_card_click') OR e.source = 'kitshop' THEN 'kitshop'
         ELSE 'chat'
       END AS entry_source,
       MAX(COALESCE(
         NULLIF(e.product_title, ''),
         NULLIF(JSON_UNQUOTE(JSON_EXTRACT(m.product_payload_json, '$.name')), ''),
         NULLIF(m.text_content, '')
       )) AS product_title,
       MAX(COALESCE(
         NULLIF(e.product_url, ''),
         NULLIF(JSON_UNQUOTE(JSON_EXTRACT(m.product_payload_json, '$.url')), '')
       )) AS product_url,
       MAX(COALESCE(NULLIF(e.site_id, ''), NULLIF(JSON_UNQUOTE(JSON_EXTRACT(m.product_payload_json, '$.siteId')), ''))) AS site_id,
       MAX(COALESCE(NULLIF(e.site_slug, ''), NULLIF(JSON_UNQUOTE(JSON_EXTRACT(m.product_payload_json, '$.siteSlug')), ''))) AS site_slug,
       SUM(CASE WHEN e.event_type IN ('product_bubble_impression', 'product_search_result_impression', 'product_kitshop_impression') THEN 1 ELSE 0 END) AS impressions,
       SUM(CASE WHEN e.event_type IN ('product_bubble_click', 'product_search_result_click', 'product_kitshop_card_click') THEN 1 ELSE 0 END) AS clicks,
       SUM(CASE WHEN e.event_type = 'product_detail_open' THEN 1 ELSE 0 END) AS detail_opens,
       SUM(CASE WHEN e.event_type = 'product_detail_cta_click' THEN 1 ELSE 0 END) AS cta_clicks
     FROM product_analytics_events e
     LEFT JOIN chat_messages m ON m.id = e.message_id
     WHERE e.created_at >= DATE_SUB(NOW(3), INTERVAL ? DAY)
       ${siteFilter.replaceAll("site_id", "e.site_id").replaceAll("site_slug", "e.site_slug")}
       AND e.event_type IN (${FUNNEL_EVENT_TYPES.map(() => "?").join(", ")})
     GROUP BY product_key, entry_source
     ORDER BY clicks DESC, impressions DESC, cta_clicks DESC
     LIMIT 30`,
    [...params, ...FUNNEL_EVENT_TYPES]
  );

  const [siteRows] = await getDbPool().execute(
    "SELECT id, name, slug FROM sites WHERE site_status = 'active' ORDER BY is_default DESC, name ASC"
  );
  const sourceBreakdown = SOURCES.map((source) => ({ source, ...toFunnelMetrics(sources[source]) }));
  const summary = toFunnelMetrics(sumSourceCounts(sources));

  return {
    ok: true,
    range: normalizeRange(range),
    site: normalizedSite || "all",
    summary,
    sourceBreakdown,
    products: productRows.map(mapProductRankRow),
    sites: siteRows.map((row) => ({ id: row.id || "", name: row.name || "", slug: row.slug || "" })),
  };
}

function buildSourceCounts(rows = []) {
  const counts = Object.fromEntries(SOURCES.map((source) => [source, emptyCounts()]));
  for (const row of rows) {
    const source = resolveSource(row);
    if (!source) continue;
    const count = Number(row.count || 0);
    if (IMPRESSION_EVENTS.has(row.event_type)) counts[source].impressions += count;
    if (CLICK_EVENTS.has(row.event_type)) counts[source].clicks += count;
    if (row.event_type === DETAIL_EVENT) counts[source].detailOpens += count;
    if (row.event_type === CTA_EVENT) counts[source].ctaClicks += count;
  }
  return counts;
}

function resolveSource(row = {}) {
  const eventType = safeString(row.event_type);
  const source = safeString(row.source).toLowerCase();
  if (["product_search_result_impression", "product_search_result_click"].includes(eventType) || source === "search") return "search";
  if (["product_kitshop_impression", "product_kitshop_card_click"].includes(eventType) || source === "kitshop") return "kitshop";
  return "chat";
}

function emptyCounts() {
  return { impressions: 0, clicks: 0, detailOpens: 0, ctaClicks: 0 };
}

function sumSourceCounts(sources = {}) {
  return SOURCES.reduce((total, source) => {
    const value = sources[source] || emptyCounts();
    total.impressions += value.impressions;
    total.clicks += value.clicks;
    total.detailOpens += value.detailOpens;
    total.ctaClicks += value.ctaClicks;
    return total;
  }, emptyCounts());
}

function toFunnelMetrics(counts = {}) {
  const impressions = Number(counts.impressions || 0);
  const clicks = Number(counts.clicks || 0);
  const detailOpens = Number(counts.detailOpens || 0);
  const ctaClicks = Number(counts.ctaClicks || 0);
  return {
    impressions,
    clicks,
    detailOpens,
    ctaClicks,
    ctr: ratio(clicks, impressions),
    detailOpenRate: ratio(detailOpens, clicks),
    ctaClickRate: ratio(ctaClicks, detailOpens),
  };
}

function mapProductRankRow(row = {}) {
  return {
    productKey: row.product_key || "",
    productTitle: row.product_title || "Unknown product",
    productUrl: row.product_url || "",
    siteId: row.site_id || "",
    siteSlug: row.site_slug || "",
    source: row.entry_source || "chat",
    impressions: Number(row.impressions || 0),
    clicks: Number(row.clicks || 0),
    detailOpens: Number(row.detail_opens || 0),
    ctaClicks: Number(row.cta_clicks || 0),
    ctr: ratio(row.clicks, row.impressions),
    ctaClickRate: ratio(row.cta_clicks, row.detail_opens),
  };
}

function normalizeRange(value = "") {
  const normalized = safeString(value);
  return RANGE_DAYS[normalized] ? normalized : "7d";
}

function ratio(numerator, denominator) {
  const top = Number(numerator || 0);
  const bottom = Number(denominator || 0);
  if (!bottom || top > bottom) return null;
  return Number((top / bottom).toFixed(4));
}

function safeString(value = "") {
  return String(value == null ? "" : value).trim();
}
