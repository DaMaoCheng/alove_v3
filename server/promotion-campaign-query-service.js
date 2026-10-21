import { getDbPool } from "./db.js";
import { mapPromotionCampaignRow } from "./promotion-campaign-mapper.js";
import { archiveExpiredPromotionCampaigns } from "./promotion-campaign-lifecycle-service.js";

const CAMPAIGN_STATUS = new Set(["draft", "active", "paused", "archived"]);

const PROMOTION_CAMPAIGN_SELECT = `SELECT
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
 LEFT JOIN sites s ON s.id = pc.site_id`;

export async function listPromotionCampaignRows({ status, site, query } = {}) {
  await archiveExpiredPromotionCampaigns();
  const filters = [];
  const values = [];

  if (status && CAMPAIGN_STATUS.has(String(status))) {
    filters.push("pc.campaign_status = ?");
    values.push(String(status));
  }
  if (site) {
    filters.push("pc.site_id = ?");
    values.push(String(site).trim());
  }
  if (query) {
    filters.push("(pc.title LIKE ? OR pc.product_title LIKE ? OR pc.product_id LIKE ? OR pc.discount_code LIKE ?)");
    const keyword = `%${String(query).trim()}%`;
    values.push(keyword, keyword, keyword, keyword);
  }

  const [rows] = await getDbPool().execute(
    `${PROMOTION_CAMPAIGN_SELECT}
     ${filters.length ? `WHERE ${filters.join(" AND ")}` : ""}
     ORDER BY
       CASE pc.campaign_status
         WHEN 'active' THEN 0
         WHEN 'draft' THEN 1
         WHEN 'paused' THEN 2
         ELSE 3
       END,
       pc.priority ASC,
       pc.ends_at ASC,
       pc.created_at DESC`,
    values
  );
  return rows;
}

export async function getPromotionCampaignRowById(campaignId) {
  const [rows] = await getDbPool().execute(
    `${PROMOTION_CAMPAIGN_SELECT}
     WHERE pc.id = ?
     LIMIT 1`,
    [campaignId]
  );
  return rows[0] || null;
}

export async function getPromotionCampaignById(campaignId) {
  const row = await getPromotionCampaignRowById(campaignId);
  if (!row) throw new Error("活动不存在");
  return mapPromotionCampaignRow(row);
}

export async function assertPromotionCampaignSiteExists(siteId) {
  if (!siteId) throw new Error("站点不能为空");
  const [rows] = await getDbPool().execute("SELECT id FROM sites WHERE id = ? LIMIT 1", [siteId]);
  if (!rows.length) throw new Error("站点不存在");
}
