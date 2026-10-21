import { getDbPool, withTransaction } from "./db.js";
import { MEMORY_JOB_TYPES, enqueueMemoryJob } from "./memory-job-service.js";
import { getPromotionCampaignById, listPromotionCampaignRows } from "./promotion-campaign-query-service.js";
import { mapPromotionCampaignRow } from "./promotion-campaign-mapper.js";
import { createId } from "./security.js";
import { reconcileFailedMascotCampaignDeliveries } from "./mascot-campaign-delivery-job-service.js";

const ACTIVE_DELIVERY_STATUSES = new Set(["queued", "sending"]);

export async function listAdminMascotCampaigns(siteId, { now = new Date() } = {}) {
  const site = await loadSiteWithMascot(siteId);
  const rows = await listPromotionCampaignRows({ status: "active", site: site.id });
  const items = rows
    .map(mapPromotionCampaignRow)
    .filter((campaign) => isCampaignEligibleForMascot(campaign, site, now))
    .map((campaign) => ({
      id: campaign.id,
      title: campaign.title,
      endsAt: campaign.endsAt,
    }));
  return { ok: true, siteId: site.id, items };
}

export async function createAdminMascotCampaignDelivery(siteId, payload = {}, { now = new Date() } = {}) {
  const campaignId = normalizeId(payload.campaignId || payload.campaign_id);
  if (!campaignId) throwUserError("请选择广告活动");

  const site = await loadSiteWithMascot(siteId);
  const campaign = await getPromotionCampaignById(campaignId);
  if (!isCampaignEligibleForMascot(campaign, site, now)) {
    throwUserError("该广告活动当前不可用于本站前台投放");
  }

  const deliveryId = createId("mad");
  const activeKey = `${site.id}:${campaign.id}`;
  try {
    await withTransaction(async (db) => {
      await db.execute(
        `INSERT INTO mascot_ad_deliveries (
           id, site_id, mascot_character_id, campaign_id, title, delivery_status,
           active_key, campaign_snapshot_json, target_count, sent_count, failed_count
         ) VALUES (?, ?, ?, ?, ?, 'queued', ?, ?, 0, 0, 0)`,
        [deliveryId, site.id, site.mascotCharacterId, campaign.id, campaign.title, activeKey, JSON.stringify(campaign)]
      );
      await db.execute(
        `INSERT INTO mascot_ad_delivery_targets (
           id, delivery_id, internal_uid, session_id, target_status
         )
         SELECT CONCAT('mad_target_', UUID()), ?, ranked.internal_uid, ranked.session_id, 'queued'
         FROM (
           SELECT
             sessions.id AS session_id,
             sessions.internal_uid,
             ROW_NUMBER() OVER (
               PARTITION BY sessions.internal_uid
               ORDER BY COALESCE(sessions.last_message_at, sessions.updated_at) DESC, sessions.updated_at DESC
             ) AS row_num
           FROM chat_sessions sessions
           INNER JOIN users users
             ON users.id = sessions.internal_uid
            AND users.account_status = 'active'
            AND users.site_id = ?
           INNER JOIN user_character_activations activations
             ON activations.internal_uid = sessions.internal_uid
            AND activations.character_id = sessions.character_id
            AND activations.activation_status = 'active'
           WHERE sessions.character_id = ?
             AND sessions.session_status = 'active'
             AND sessions.source_type = 'user'
         ) ranked
         WHERE ranked.row_num = 1`,
        [deliveryId, site.id, site.mascotCharacterId]
      );
      const [countRows] = await db.execute(
        "SELECT COUNT(*) AS target_count FROM mascot_ad_delivery_targets WHERE delivery_id = ?",
        [deliveryId]
      );
      const targetCount = Number(countRows[0]?.target_count || 0);
      await db.execute(
        `UPDATE mascot_ad_deliveries
         SET target_count = ?,
             delivery_status = ?,
             started_at = CASE WHEN ? > 0 THEN NOW(3) ELSE NULL END,
             completed_at = CASE WHEN ? = 0 THEN NOW(3) ELSE NULL END,
             active_key = CASE WHEN ? = 0 THEN NULL ELSE active_key END
         WHERE id = ?`,
        [targetCount, targetCount > 0 ? "sending" : "completed", targetCount, targetCount, targetCount, deliveryId]
      );
      if (targetCount > 0) {
        await enqueueMemoryJob({
          jobType: MEMORY_JOB_TYPES.SEND_MASCOT_CAMPAIGN_BATCH,
          characterId: site.mascotCharacterId,
          priority: 65,
          maxRetries: 3,
          payload: { deliveryId },
        }, db);
      }
    });
  } catch (error) {
    if (error?.code === "ER_DUP_ENTRY") {
      const existing = await findDeliveryAfterDuplicate({ activeKey, siteId: site.id, campaignId: campaign.id });
      if (existing) return mapDeliveryRow(existing);
    }
    throw error;
  }
  return getAdminMascotCampaignDelivery(site.id, deliveryId);
}

export async function getAdminMascotCampaignDelivery(siteId, deliveryId) {
  const normalizedSiteId = normalizeId(siteId);
  const normalizedDeliveryId = normalizeId(deliveryId);
  await reconcileFailedMascotCampaignDeliveries({ deliveryId: normalizedDeliveryId });
  const [rows] = await getDbPool().execute(
    `SELECT *
     FROM mascot_ad_deliveries
     WHERE id = ? AND site_id = ?
     LIMIT 1`,
    [normalizedDeliveryId, normalizedSiteId]
  );
  if (!rows[0]) {
    const error = new Error("投放任务不存在");
    error.statusCode = 404;
    throw error;
  }
  const failureReasons = Number(rows[0].failed_count || 0) > 0 && !ACTIVE_DELIVERY_STATUSES.has(rows[0].delivery_status)
    ? await loadFailureReasonSummary(normalizedDeliveryId)
    : [];
  return mapDeliveryRow(rows[0], { failureReasons });
}

export function isCampaignEligibleForMascot(campaign = {}, site = {}, now = new Date()) {
  const current = new Date(now);
  const startsAt = campaign.startsAt ? new Date(campaign.startsAt) : null;
  const endsAt = campaign.endsAt ? new Date(campaign.endsAt) : null;
  return campaign.siteId === site.id
    && campaign.status === "active"
    && ["all", "mascot"].includes(campaign.roleTarget)
    && Boolean(site.mascotCharacterId)
    && (!startsAt || startsAt <= current)
    && (!endsAt || endsAt > current);
}

async function loadSiteWithMascot(siteId) {
  const normalizedSiteId = normalizeId(siteId);
  const [rows] = await getDbPool().execute(
    `SELECT s.id, s.name, s.slug, s.site_status, s.mascot_character_id,
            c.category_id, c.character_status, c.site_id AS character_site_id
     FROM sites s
     LEFT JOIN ai_characters c ON c.id = s.mascot_character_id
     WHERE s.id = ?
     LIMIT 1`,
    [normalizedSiteId]
  );
  const row = rows[0];
  if (!row || row.site_status !== "active") throwUserError("站点不存在或已停用");
  if (!normalizeId(row.mascot_character_id)) throwUserError("该站点尚未绑定前台角色");
  if (row.category_id !== "mascot" || row.character_status !== "published") {
    throwUserError("该站点前台角色当前不可用");
  }
  if (row.character_site_id && row.character_site_id !== row.id) {
    throwUserError("该站点前台角色绑定关系无效");
  }
  return {
    id: row.id,
    name: row.name || "",
    slug: row.slug || "",
    mascotCharacterId: row.mascot_character_id,
  };
}

async function findDeliveryAfterDuplicate({ activeKey, siteId, campaignId }) {
  const [rows] = await getDbPool().execute(
    `SELECT * FROM mascot_ad_deliveries
     WHERE active_key = ?
        OR (site_id = ? AND campaign_id = ? AND created_at >= DATE_SUB(NOW(3), INTERVAL 1 MINUTE))
     ORDER BY created_at DESC
     LIMIT 1`,
    [activeKey, siteId, campaignId]
  );
  return rows[0] || null;
}

async function loadFailureReasonSummary(deliveryId) {
  const [rows] = await getDbPool().execute(
    `SELECT failure_reason, COUNT(*) AS failure_count
     FROM mascot_ad_delivery_targets
     WHERE delivery_id = ? AND target_status = 'failed'
     GROUP BY failure_reason`,
    [deliveryId]
  );
  const summary = new Map();
  for (const row of rows) {
    const reason = publicFailureReason(row.failure_reason);
    const count = Math.max(0, Number(row.failure_count || 0));
    const current = summary.get(reason.code) || { ...reason, count: 0 };
    current.count += count;
    summary.set(reason.code, current);
  }
  return [...summary.values()].sort((left, right) => right.count - left.count || left.label.localeCompare(right.label, "zh-CN"));
}

function publicFailureReason(value) {
  const reason = normalizeId(value).toLowerCase();
  if (reason === "target_scope_changed") {
    return { code: "target_ineligible", label: "用户已不再符合发送条件" };
  }
  if (reason === "already_delivered") {
    return { code: "already_delivered", label: "该广告已向用户发送过" };
  }
  if (["campaign_unavailable", "campaign_ineligible", "no_campaign"].includes(reason)) {
    return { code: "campaign_unavailable", label: "广告活动已失效或不再适用" };
  }
  if (["missing_scope", "invalid_scope", "campaign_not_reserved"].includes(reason)) {
    return { code: "campaign_not_reserved", label: "广告发送资格校验失败" };
  }
  if (reason === "delivery_job_failed") {
    return { code: "delivery_job_failed", label: "后台发送任务异常" };
  }
  if (reason === "delivery_record_missing") {
    return { code: "delivery_record_missing", label: "发送记录状态异常" };
  }
  return { code: "delivery_failed", label: "消息生成或发送失败" };
}

function mapDeliveryRow(row = {}, { failureReasons = [] } = {}) {
  const status = ACTIVE_DELIVERY_STATUSES.has(row.delivery_status)
    ? "sending"
    : row.delivery_status === "completed"
      ? "completed"
      : "failed";
  const total = Number(row.target_count || 0);
  const sent = Number(row.sent_count || 0);
  const failed = Number(row.failed_count || 0);
  return {
    ok: true,
    delivery: {
      id: row.id,
      siteId: row.site_id,
      campaignId: row.campaign_id || "",
      title: row.title || "",
      status,
      total,
      sent,
      failed,
      failureReasons,
      processed: Math.min(total, sent + failed),
      startedAt: toIso(row.started_at),
      completedAt: toIso(row.completed_at),
    },
  };
}

function normalizeId(value) {
  return String(value || "").trim();
}

function throwUserError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  throw error;
}

function toIso(value) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}
