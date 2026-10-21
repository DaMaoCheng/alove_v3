import crypto from "node:crypto";
import { getDbPool } from "./db.js";
import { mapPromotionCampaignRow } from "./promotion-campaign-mapper.js";
import { normalizePromotionCampaignPayload } from "./promotion-campaign-normalizers.js";
import { assertPromotionCampaignSiteExists, getPromotionCampaignById, getPromotionCampaignRowById } from "./promotion-campaign-query-service.js";

export async function createPromotionCampaign(payload = {}) {
  const normalized = await normalizePromotionCampaignPayload(payload, {
    mode: "create",
    assertSiteExists: assertPromotionCampaignSiteExists,
  });
  const item = {
    id: `campaign_${crypto.randomUUID()}`,
    ...normalized,
  };

  await getDbPool().execute(
    `INSERT INTO promotion_campaigns (
       id, site_id, title, role_target, product_id, product_title, product_url,
       product_snapshot_json, discount_code, message_text, keywords_json, priority,
       campaign_status, starts_at, ends_at, source_type, source_ref
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      item.id,
      item.siteId,
      item.title,
      item.roleTarget,
      item.productId,
      item.productTitle,
      item.productUrl,
      JSON.stringify(item.productSnapshot || null),
      item.discountCode,
      item.messageText,
      JSON.stringify(item.keywords),
      item.priority,
      item.status,
      item.startsAt,
      item.endsAt,
      item.sourceType,
      item.sourceRef,
    ]
  );

  return {
    ok: true,
    item: await getPromotionCampaignById(item.id),
  };
}

export async function updatePromotionCampaign(campaignId, payload = {}) {
  const current = await getPromotionCampaignRowById(campaignId);
  if (!current) throw new Error("活动不存在");

  const normalized = await normalizePromotionCampaignPayload(payload, {
    mode: "update",
    current: mapPromotionCampaignRow(current),
    assertSiteExists: assertPromotionCampaignSiteExists,
  });

  await getDbPool().execute(
    `UPDATE promotion_campaigns
     SET site_id = ?,
         title = ?,
         role_target = ?,
         product_id = ?,
         product_title = ?,
         product_url = ?,
         product_snapshot_json = ?,
         discount_code = ?,
         message_text = ?,
         keywords_json = ?,
         priority = ?,
         campaign_status = ?,
         starts_at = ?,
         ends_at = ?,
         source_ref = ?
     WHERE id = ?
     LIMIT 1`,
    [
      normalized.siteId,
      normalized.title,
      normalized.roleTarget,
      normalized.productId,
      normalized.productTitle,
      normalized.productUrl,
      JSON.stringify(normalized.productSnapshot || null),
      normalized.discountCode,
      normalized.messageText,
      JSON.stringify(normalized.keywords),
      normalized.priority,
      normalized.status,
      normalized.startsAt,
      normalized.endsAt,
      normalized.sourceRef,
      campaignId,
    ]
  );

  return {
    ok: true,
    item: await getPromotionCampaignById(campaignId),
  };
}
