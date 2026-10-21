import { mapPromotionCampaignRow } from "./promotion-campaign-mapper.js";
import { buildCampaignProductPayload } from "./promotion-campaign-product-payload-service.js";

export async function resolvePromotionCampaignForChatRecommendation(db, {
  siteId,
  character = {},
  excludeCampaignIds = [],
  now = new Date(),
} = {}) {
  const normalizedSiteId = safeString(siteId);
  if (!normalizedSiteId || !db?.execute) return null;
  const excludedIds = new Set(
    (Array.isArray(excludeCampaignIds) ? excludeCampaignIds : [])
      .map((id) => safeString(id))
      .filter(Boolean)
  );

  const [rows] = await db.execute(
    `SELECT
       pc.id,
       pc.site_id,
       s.name AS site_name,
       s.slug AS site_slug,
       pc.title,
       pc.role_target,
       pc.product_id,
       pc.product_title,
       pc.product_url,
       pc.product_snapshot_json,
       pc.discount_code,
       pc.message_text,
       pc.keywords_json,
       pc.priority,
       pc.campaign_status,
       pc.starts_at,
       pc.ends_at,
       pc.source_type,
       pc.source_ref,
       pc.created_at,
       pc.updated_at
     FROM promotion_campaigns pc
     LEFT JOIN sites s ON s.id = pc.site_id
     WHERE pc.site_id = ?
       AND pc.campaign_status = 'active'
       AND (pc.starts_at IS NULL OR pc.starts_at <= ?)
       AND (pc.ends_at IS NULL OR pc.ends_at > ?)
     ORDER BY pc.priority ASC, pc.ends_at ASC, pc.created_at DESC`,
    [normalizedSiteId, now, now]
  );

  for (const row of rows) {
    const campaign = mapPromotionCampaignRow(row);
    if (excludedIds.has(campaign.id)) continue;
    if (!matchesRoleTarget(campaign.roleTarget, character.category_id || character.categoryId)) continue;
    const product = buildCampaignProductPayload(campaign);
    if (!product.name || !product.url) continue;
    return { campaign, product };
  }
  return null;
}

function matchesRoleTarget(roleTarget, categoryId) {
  if (roleTarget === "all") return true;
  return safeString(roleTarget) === safeString(categoryId);
}

function safeString(value) {
  return String(value == null ? "" : value).trim();
}
