const DEFAULT_PROMOTION_CAMPAIGN_SEEN_HOURS = 24;

export async function listRecentlySeenPromotionCampaignIds(db, {
  userId,
  siteId = "",
  withinHours = DEFAULT_PROMOTION_CAMPAIGN_SEEN_HOURS,
  now = new Date(),
} = {}) {
  const normalizedUserId = safeString(userId);
  if (!normalizedUserId || !db?.execute) return [];

  const normalizedSiteId = safeString(siteId);
  const since = new Date(toDate(now).getTime() - normalizeHours(withinHours) * 60 * 60 * 1000);
  const params = [normalizedUserId, since];
  let siteClause = "";
  if (normalizedSiteId) {
    siteClause = "AND JSON_UNQUOTE(JSON_EXTRACT(m.product_payload_json, '$.siteId')) = ?";
    params.push(normalizedSiteId);
  }

  const [rows] = await db.execute(
    `SELECT DISTINCT JSON_UNQUOTE(JSON_EXTRACT(m.product_payload_json, '$.campaignId')) AS campaign_id
     FROM chat_messages m
     INNER JOIN chat_sessions s ON s.id = m.session_id
     WHERE s.internal_uid = ?
       AND m.content_type = 'product'
       AND m.source_type = 'promotion_campaign'
       AND m.source_ref = 'promotion-campaign-product'
       AND m.sent_at >= ?
       ${siteClause}
       AND JSON_UNQUOTE(JSON_EXTRACT(m.product_payload_json, '$.campaignId')) IS NOT NULL
       AND JSON_UNQUOTE(JSON_EXTRACT(m.product_payload_json, '$.campaignId')) <> ''`,
    params
  );
  return Array.from(new Set(rows.map((row) => safeString(row.campaign_id)).filter(Boolean)));
}

export async function hasRecentlySeenPromotionCampaign(db, {
  userId,
  campaignId,
  siteId = "",
  withinHours = DEFAULT_PROMOTION_CAMPAIGN_SEEN_HOURS,
  now = new Date(),
} = {}) {
  const normalizedCampaignId = safeString(campaignId);
  if (!normalizedCampaignId) return false;
  const recentIds = await listRecentlySeenPromotionCampaignIds(db, {
    userId,
    siteId,
    withinHours,
    now,
  });
  return recentIds.includes(normalizedCampaignId);
}

function normalizeHours(value) {
  const hours = Number(value);
  return Number.isFinite(hours) && hours > 0 ? hours : DEFAULT_PROMOTION_CAMPAIGN_SEEN_HOURS;
}

function toDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function safeString(value) {
  return String(value == null ? "" : value).trim();
}
