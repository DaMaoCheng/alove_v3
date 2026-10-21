import { getDbPool } from "./db.js";

export async function loadPromotionCampaignStats(campaignIds = []) {
  const ids = campaignIds.map((id) => String(id || "").trim()).filter(Boolean);
  if (!ids.length) return new Map();

  const placeholders = ids.map(() => "?").join(", ");
  const [rows] = await getDbPool().execute(
    `SELECT
       d.campaign_id,
       COUNT(DISTINCT CASE WHEN d.delivery_status = 'sent' THEN d.id END) AS sent_count,
       SUM(CASE WHEN e.event_type = 'product_bubble_impression' THEN 1 ELSE 0 END) AS bubble_impressions,
       SUM(CASE WHEN e.event_type = 'product_bubble_click' THEN 1 ELSE 0 END) AS bubble_clicks,
       SUM(CASE WHEN e.event_type = 'product_detail_open' THEN 1 ELSE 0 END) AS detail_opens,
       SUM(CASE WHEN e.event_type = 'product_detail_cta_click' THEN 1 ELSE 0 END) AS cta_clicks
     FROM promotion_campaign_deliveries d
     LEFT JOIN product_analytics_events e ON e.message_id = d.message_id
     WHERE d.campaign_id IN (${placeholders})
     GROUP BY d.campaign_id`,
    ids
  );

  const stats = new Map(ids.map((id) => [id, emptyCampaignStats()]));
  for (const row of rows) {
    const sentCount = toCount(row.sent_count);
    const bubbleImpressions = toCount(row.bubble_impressions);
    const bubbleClicks = toCount(row.bubble_clicks);
    const detailOpens = toCount(row.detail_opens);
    const ctaClicks = toCount(row.cta_clicks);
    stats.set(row.campaign_id, {
      sentCount,
      bubbleImpressions,
      bubbleClicks,
      detailOpens,
      ctaClicks,
      ctr: ratio(bubbleClicks, bubbleImpressions),
      ctaClickRate: ratio(ctaClicks, detailOpens),
    });
  }
  return stats;
}

export function emptyCampaignStats() {
  return {
    sentCount: 0,
    bubbleImpressions: 0,
    bubbleClicks: 0,
    detailOpens: 0,
    ctaClicks: 0,
    ctr: 0,
    ctaClickRate: 0,
  };
}

export function toCount(value) {
  const count = Number(value || 0);
  return Number.isFinite(count) ? count : 0;
}

export function ratio(numerator, denominator) {
  const top = toCount(numerator);
  const bottom = toCount(denominator);
  if (!bottom) return 0;
  return Math.round((top / bottom) * 10000) / 10000;
}
