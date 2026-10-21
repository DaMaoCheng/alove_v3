import { assessProactiveContent, classifyProactiveContent, allowsProactiveShopping, loadLatestProactiveUserMessageId } from "./proactive-content-policy-service.js";
import { listRecentMessagesForPrompt } from "./proactive-message-context-service.js";
import { createProactivePromotionCampaignMessages } from "./chat-proactive-message-service.js";
import { getDbPool, withTransaction } from "./db.js";
import { MEMORY_JOB_TYPES, enqueueMemoryJob } from "./memory-job-service.js";
import {
  cancelPromotionCampaignDelivery,
  completePromotionCampaignDelivery,
  reservePromotionCampaignDelivery,
} from "./promotion-campaign-match-service.js";
import { getPromotionCampaignById } from "./promotion-campaign-query-service.js";

const TARGET_BATCH_SIZE = 5;
const MAX_TARGET_ATTEMPTS = 3;
const TARGET_RETRY_DELAY_MS = 2_000;
const SOURCE_REF_PREFIX = "manual-mascot-campaign";

export async function sendMascotCampaignBatchFromJob(job = {}, { generateVoiceAudio = null, afterMessagesCommitted = null, classifyContent = classifyProactiveContent } = {}) {
  const deliveryId = normalizeId(job.payload?.deliveryId);
  if (!deliveryId) return { ok: true, handled: false, reason: "missing_delivery" };

  await getDbPool().execute(
    `UPDATE mascot_ad_delivery_targets
     SET target_status = 'queued', started_at = NULL, available_at = NOW(3), updated_at = NOW(3)
     WHERE delivery_id = ?
       AND target_status = 'sending'
       AND started_at < DATE_SUB(NOW(3), INTERVAL 10 MINUTE)`,
    [deliveryId]
  );

  const delivery = await loadDelivery(deliveryId);
  if (!delivery || !["queued", "sending"].includes(delivery.delivery_status)) {
    return { ok: true, handled: false, reason: "delivery_not_active" };
  }

  let currentCampaign = null;
  try {
    currentCampaign = await getPromotionCampaignById(delivery.campaign_id);
  } catch {
    await failRemainingTargets(deliveryId, "campaign_unavailable");
    return { ok: true, handled: true, reason: "campaign_unavailable", ...await refreshDeliveryProgress(deliveryId) };
  }
  const campaign = parseJsonObject(delivery.campaign_snapshot_json) || currentCampaign;
  if (!isDeliveryScopeEligible({ delivery, currentCampaign, campaign })) {
    await failRemainingTargets(deliveryId, "campaign_ineligible");
    return { ok: true, handled: true, reason: "campaign_ineligible", ...await refreshDeliveryProgress(deliveryId) };
  }

  let handled = 0;
  for (let index = 0; index < TARGET_BATCH_SIZE; index += 1) {
    const target = await claimNextTarget(deliveryId);
    if (!target) break;
    handled += 1;
    await processTarget({ delivery, campaign, target, generateVoiceAudio, afterMessagesCommitted, classifyContent });
  }

  const progress = await refreshDeliveryProgress(deliveryId);
  if (progress.remaining > 0) {
    await enqueueMemoryJob({
      jobType: MEMORY_JOB_TYPES.SEND_MASCOT_CAMPAIGN_BATCH,
      characterId: delivery.mascot_character_id,
      priority: 65,
      maxRetries: 3,
      availableAt: progress.nextAvailableAt || new Date(Date.now() + TARGET_RETRY_DELAY_MS),
      payload: { deliveryId },
    });
  }
  return { ok: true, handled: true, handledCount: handled, ...progress };
}

export async function reconcileFailedMascotCampaignDeliveries({ deliveryId = "" } = {}) {
  const normalizedDeliveryId = normalizeId(deliveryId);
  const params = [MEMORY_JOB_TYPES.SEND_MASCOT_CAMPAIGN_BATCH, MEMORY_JOB_TYPES.SEND_MASCOT_CAMPAIGN_BATCH];
  const deliveryClause = normalizedDeliveryId ? "AND delivery.id = ?" : "";
  if (normalizedDeliveryId) params.push(normalizedDeliveryId);
  const [rows] = await getDbPool().execute(
    `SELECT delivery.id
     FROM mascot_ad_deliveries delivery
     WHERE delivery.delivery_status IN ('queued', 'sending')
       AND EXISTS (
         SELECT 1 FROM memory_jobs failed_job
         WHERE failed_job.job_type = ?
           AND failed_job.job_status = 'failed'
           AND JSON_UNQUOTE(JSON_EXTRACT(failed_job.payload_json, '$.deliveryId')) = delivery.id
       )
       AND NOT EXISTS (
         SELECT 1 FROM memory_jobs active_job
         WHERE active_job.job_type = ?
           AND active_job.job_status IN ('queued', 'running')
           AND JSON_UNQUOTE(JSON_EXTRACT(active_job.payload_json, '$.deliveryId')) = delivery.id
       )
       ${deliveryClause}
     LIMIT 100`,
    params
  );
  for (const row of rows) {
    await closeFailedDelivery(row.id);
  }
  return rows.length;
}

async function processTarget({ delivery, campaign, target, generateVoiceAudio = null, afterMessagesCommitted = null, classifyContent = classifyProactiveContent }) {
  const sourceRef = `${SOURCE_REF_PREFIX}:${target.id}`.slice(0, 128);
  const campaignDeliveryId = buildReservationId("campaign", target.id);
  let campaignReserved = Boolean(target.campaign_delivery_id);
  let messagesCommitted = false;
  try {
    const recovered = await reconcileCommittedMessages({
      delivery,
      campaign,
      target,
      sourceRef,
      campaignDeliveryId,
    });
    if (recovered) {
      await markTargetSent(target.id, recovered.messageId, campaignDeliveryId);
      return;
    }

    if (!await isTargetStillEligible({ delivery, target })) {
      await cancelStoredTargetReservation({ campaignDeliveryId, campaignReserved });
      await markTargetFailed(target.id, "target_scope_changed");
      return;
    }

    const latestUserMessageId = await loadLatestProactiveUserMessageId(getDbPool(), target.session_id);
    const { recentMessages, contextTruncated } = await listRecentMessagesForPrompt(getDbPool(), target.session_id, { includeContextStatus: true });
    const state = await assessProactiveContent(classifyContent, { recentMessages, contextTruncated });
    if (!allowsProactiveShopping(state)) {
      await cancelStoredTargetReservation({ campaignDeliveryId, campaignReserved });
      await markTargetFailed(target.id, state.state === "unknown" ? "proactive_state_unavailable" : "proactive_after_sales_protected");
      return;
    }

    const campaignReservation = await reservePromotionCampaignDelivery({
      campaign,
      userId: target.internal_uid,
      characterId: delivery.mascot_character_id,
      sessionId: target.session_id,
      matchScore: 2000,
      matchReason: "manual_mascot_campaign",
      deliveryId: campaignDeliveryId,
    });
    if (!campaignReservation.reserved) {
      await markTargetFailed(target.id, campaignReservation.reason || "campaign_not_reserved");
      return;
    }
    campaignReserved = true;
    await saveTargetReservationIds(target.id, { campaignDeliveryId });

    const created = await createProactivePromotionCampaignMessages({
      userId: target.internal_uid,
      characterId: delivery.mascot_character_id,
      sessionId: target.session_id,
      text: campaign.messageText,
      speechText: campaign.messageText,
      campaign,
      sourceRef,
      generateVoiceAudio,
      proactivePolicy: { ...state, latestUserMessageId, candidateText: String(campaign.messageText || "").trim() },
    });
    if (created.sent === false) {
      await cancelStoredTargetReservation({ campaignDeliveryId, campaignReserved });
      await markTargetFailed(target.id, created.reason || "proactive_policy_rejected");
      return;
    }
    messagesCommitted = true;
    if (typeof afterMessagesCommitted === "function") {
      await afterMessagesCommitted({ delivery, campaign, target, created });
    }
    const messageId = created.productMessage?.id || created.items.at(-1)?.id || "";
    await completePromotionCampaignDelivery({ deliveryId: campaignDeliveryId, messageId });
    await markTargetSent(target.id, messageId, campaignDeliveryId);
  } catch (error) {
    let reservationCleanupFailed = false;
    if (!messagesCommitted) {
      if (campaignReserved) {
        await cancelPromotionCampaignDelivery({ deliveryId: campaignDeliveryId }).catch(() => {
          reservationCleanupFailed = true;
        });
      }
    }
    const retryable = messagesCommitted || reservationCleanupFailed || isRetryableTargetError(error);
    console.warn(`[aiove] mascot campaign target ${retryable ? "retry" : "failed"}:`, {
      deliveryId: delivery.id,
      targetId: target.id,
      code: safeErrorCode(error),
    });
    if (retryable) {
      await scheduleTargetRetry(target.id, error);
    } else {
      await markTargetFailed(target.id, safeErrorCode(error));
    }
  }
}

async function cancelStoredTargetReservation({ campaignDeliveryId, campaignReserved }) {
  if (campaignReserved) {
    await cancelPromotionCampaignDelivery({ deliveryId: campaignDeliveryId });
  }
}

async function isTargetStillEligible({ delivery, target }) {
  const [rows] = await getDbPool().execute(
    `SELECT users.id
     FROM users
     INNER JOIN chat_sessions sessions
       ON sessions.id = ?
      AND sessions.internal_uid = users.id
      AND sessions.character_id = ?
      AND sessions.session_status = 'active'
      AND sessions.source_type = 'user'
     INNER JOIN user_character_activations activations
       ON activations.internal_uid = users.id
      AND activations.character_id = ?
      AND activations.activation_status = 'active'
     WHERE users.id = ?
       AND users.account_status = 'active'
       AND users.site_id = ?
     LIMIT 1`,
    [
      target.session_id,
      delivery.mascot_character_id,
      delivery.mascot_character_id,
      target.internal_uid,
      delivery.site_id,
    ]
  );
  return Boolean(rows[0]?.id);
}

async function reconcileCommittedMessages({ delivery, campaign, target, sourceRef, campaignDeliveryId }) {
  const [messageRows] = await getDbPool().execute(
    `SELECT id, source_ref
     FROM chat_messages
     WHERE session_id = ?
       AND character_id = ?
       AND source_type = 'promotion_campaign'
       AND source_ref IN (?, ?)
     ORDER BY display_order ASC`,
    [target.session_id, delivery.mascot_character_id, sourceRef, `${sourceRef}-product`.slice(0, 128)]
  );
  if (messageRows.length < 2) return null;

  const messageId = messageRows.find((row) => row.source_ref.endsWith("-product"))?.id || messageRows.at(-1)?.id || "";
  const [campaignRows] = await getDbPool().execute(
    `SELECT id FROM promotion_campaign_deliveries
     WHERE id = ? AND campaign_id = ? AND internal_uid = ? LIMIT 1`,
    [campaignDeliveryId, campaign.id, target.internal_uid]
  );
  if (!campaignRows[0]?.id) throw new Error("delivery_record_missing");
  await completePromotionCampaignDelivery({ deliveryId: campaignDeliveryId, messageId });
  return { messageId };
}

async function loadDelivery(deliveryId) {
  const [rows] = await getDbPool().execute(
    `SELECT mad.*, COALESCE(NULLIF(s.time_zone, ''), 'UTC') AS time_zone,
            s.site_status, s.mascot_character_id AS current_mascot_character_id,
            mascot_character.category_id AS mascot_category_id,
            mascot_character.character_status AS mascot_character_status,
            mascot_character.site_id AS mascot_site_id
     FROM mascot_ad_deliveries mad
     INNER JOIN sites s ON s.id = mad.site_id
     LEFT JOIN ai_characters mascot_character ON mascot_character.id = mad.mascot_character_id
     WHERE mad.id = ?
     LIMIT 1`,
    [deliveryId]
  );
  return rows[0] || null;
}

async function claimNextTarget(deliveryId) {
  return withTransaction(async (db) => {
    const [rows] = await db.execute(
      `SELECT * FROM mascot_ad_delivery_targets
       WHERE delivery_id = ?
         AND target_status = 'queued'
         AND available_at <= NOW(3)
       ORDER BY available_at ASC, created_at ASC, id ASC
       LIMIT 1 FOR UPDATE`,
      [deliveryId]
    );
    const target = rows[0] || null;
    if (!target) return null;
    await db.execute(
      `UPDATE mascot_ad_delivery_targets
       SET target_status = 'sending', started_at = NOW(3), failure_reason = NULL, updated_at = NOW(3)
       WHERE id = ?`,
      [target.id]
    );
    return target;
  });
}

async function saveTargetReservationIds(targetId, { campaignDeliveryId = null } = {}) {
  await getDbPool().execute(
    `UPDATE mascot_ad_delivery_targets
     SET campaign_delivery_id = COALESCE(?, campaign_delivery_id),
         updated_at = NOW(3)
     WHERE id = ?`,
    [campaignDeliveryId, targetId]
  );
}

async function markTargetSent(targetId, messageId, campaignDeliveryId = null) {
  await getDbPool().execute(
    `UPDATE mascot_ad_delivery_targets
     SET target_status = 'sent', message_id = ?,
         campaign_delivery_id = COALESCE(?, campaign_delivery_id),
         failure_reason = NULL, completed_at = NOW(3), updated_at = NOW(3)
     WHERE id = ?`,
    [messageId || null, campaignDeliveryId, targetId]
  );
}

async function markTargetFailed(targetId, reason) {
  await getDbPool().execute(
    `UPDATE mascot_ad_delivery_targets
     SET target_status = 'failed', failure_reason = ?,
         completed_at = NOW(3), updated_at = NOW(3)
     WHERE id = ?`,
    [normalizeReason(reason), targetId]
  );
}

async function scheduleTargetRetry(targetId, error) {
  const [result] = await getDbPool().execute(
    `UPDATE mascot_ad_delivery_targets
     SET retry_count = retry_count + 1,
         target_status = CASE WHEN retry_count + 1 >= ? THEN 'failed' ELSE 'queued' END,
         failure_reason = ?,
         available_at = DATE_ADD(NOW(3), INTERVAL ? MICROSECOND),
         started_at = NULL,
         completed_at = CASE WHEN retry_count + 1 >= ? THEN NOW(3) ELSE NULL END,
         updated_at = NOW(3)
     WHERE id = ? AND target_status = 'sending'`,
    [MAX_TARGET_ATTEMPTS, safeErrorCode(error), TARGET_RETRY_DELAY_MS * 1000, MAX_TARGET_ATTEMPTS, targetId]
  );
  return Number(result.affectedRows || 0) === 1;
}

async function failRemainingTargets(deliveryId, reason) {
  await getDbPool().execute(
    `UPDATE mascot_ad_delivery_targets
     SET target_status = 'failed', failure_reason = ?,
         completed_at = NOW(3), updated_at = NOW(3)
     WHERE delivery_id = ? AND target_status IN ('queued', 'sending')`,
    [normalizeReason(reason), deliveryId]
  );
}

async function refreshDeliveryProgress(deliveryId) {
  return withTransaction(async (db) => {
    const [rows] = await db.execute(
      `SELECT
         COUNT(*) AS total_count,
         SUM(target_status = 'sent') AS sent_count,
         SUM(target_status = 'failed') AS failed_count,
         SUM(target_status IN ('queued', 'sending')) AS remaining_count,
         MIN(CASE WHEN target_status = 'queued' THEN available_at ELSE NULL END) AS next_available_at
       FROM mascot_ad_delivery_targets
       WHERE delivery_id = ?`,
      [deliveryId]
    );
    const total = Number(rows[0]?.total_count || 0);
    const sent = Number(rows[0]?.sent_count || 0);
    const failed = Number(rows[0]?.failed_count || 0);
    const remaining = Number(rows[0]?.remaining_count || 0);
    await db.execute(
      `UPDATE mascot_ad_deliveries
       SET target_count = ?, sent_count = ?, failed_count = ?,
           delivery_status = CASE WHEN ? = 0 THEN 'completed' ELSE 'sending' END,
           completed_at = CASE WHEN ? = 0 THEN NOW(3) ELSE completed_at END,
           active_key = CASE WHEN ? = 0 THEN NULL ELSE active_key END,
           updated_at = NOW(3)
       WHERE id = ?`,
      [total, sent, failed, remaining, remaining, remaining, deliveryId]
    );
    return {
      total,
      sent,
      failed,
      remaining,
      processed: sent + failed,
      nextAvailableAt: toDate(rows[0]?.next_available_at),
    };
  });
}

async function closeFailedDelivery(deliveryId) {
  await withTransaction(async (db) => {
    const [deliveryRows] = await db.execute(
      "SELECT delivery_status FROM mascot_ad_deliveries WHERE id = ? LIMIT 1 FOR UPDATE",
      [deliveryId]
    );
    if (!["queued", "sending"].includes(deliveryRows[0]?.delivery_status)) return;
    const [activeJobs] = await db.execute(
      `SELECT id FROM memory_jobs
       WHERE job_type = ?
         AND JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.deliveryId')) = ?
         AND job_status IN ('queued', 'running')
       LIMIT 1`,
      [MEMORY_JOB_TYPES.SEND_MASCOT_CAMPAIGN_BATCH, deliveryId]
    );
    if (activeJobs[0]) return;
    await db.execute(
      `UPDATE mascot_ad_delivery_targets
       SET target_status = 'failed', failure_reason = 'delivery_job_failed',
           completed_at = NOW(3), updated_at = NOW(3)
       WHERE delivery_id = ? AND target_status IN ('queued', 'sending')`,
      [deliveryId]
    );
    const [counts] = await db.execute(
      `SELECT COUNT(*) AS total_count,
              SUM(target_status = 'sent') AS sent_count,
              SUM(target_status = 'failed') AS failed_count
       FROM mascot_ad_delivery_targets WHERE delivery_id = ?`,
      [deliveryId]
    );
    await db.execute(
      `UPDATE mascot_ad_deliveries
       SET delivery_status = 'failed', active_key = NULL,
           target_count = ?, sent_count = ?, failed_count = ?,
           completed_at = NOW(3), updated_at = NOW(3)
       WHERE id = ?`,
      [
        Number(counts[0]?.total_count || 0),
        Number(counts[0]?.sent_count || 0),
        Number(counts[0]?.failed_count || 0),
        deliveryId,
      ]
    );
  });
}

function isDeliveryScopeEligible({ delivery, currentCampaign, campaign, now = new Date() }) {
  const startsAt = currentCampaign?.startsAt ? new Date(currentCampaign.startsAt) : null;
  const endsAt = currentCampaign?.endsAt ? new Date(currentCampaign.endsAt) : null;
  return currentCampaign?.id === delivery.campaign_id
    && currentCampaign?.siteId === delivery.site_id
    && currentCampaign?.status === "active"
    && ["all", "mascot"].includes(currentCampaign?.roleTarget)
    && (!startsAt || startsAt <= now)
    && (!endsAt || endsAt > now)
    && campaign?.id === delivery.campaign_id
    && campaign?.siteId === delivery.site_id
    && delivery.site_status === "active"
    && delivery.current_mascot_character_id === delivery.mascot_character_id
    && delivery.mascot_category_id === "mascot"
    && delivery.mascot_character_status === "published"
    && (!delivery.mascot_site_id || delivery.mascot_site_id === delivery.site_id);
}

function isRetryableTargetError(error) {
  if (error?.retryable === false) return false;
  const statusCode = Number(error?.statusCode || 0);
  return !(statusCode >= 400 && statusCode < 500);
}

function buildReservationId(prefix, targetId) {
  return `${prefix}_${normalizeId(targetId)}`.slice(0, 64);
}

function safeErrorCode(error) {
  return normalizeReason(error?.code || error?.message || "delivery_failed");
}

function normalizeReason(value) {
  return String(value || "delivery_failed").trim().slice(0, 255) || "delivery_failed";
}

function parseJsonObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function toDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeId(value) {
  return String(value || "").trim();
}
