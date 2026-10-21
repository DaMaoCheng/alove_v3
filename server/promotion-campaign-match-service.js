import crypto from "node:crypto";
import { getDbPool, withTransaction } from "./db.js";
import { assertMemoryJobLease } from "./memory-job-service.js";
import { listRecentlySeenPromotionCampaignIds } from "./promotion-campaign-dedup-service.js";

export async function resolvePromotionCampaignForProactive({ userId, characterId, sessionId, now = new Date(), recentMessages = null } = {}) {
  const context = await loadMatchContext({ userId, characterId, sessionId });
  if (!context) return { matched: false, reason: "invalid_scope" };

  const messages = Array.isArray(recentMessages) && recentMessages.length
    ? recentMessages
    : await listRecentMessages(sessionId);
  const campaigns = await listEligibleCampaignRows({
    siteId: context.user.site_id,
    userId,
    now,
  });
  if (!campaigns.length) return { matched: false, reason: "no_campaign" };
  const recentlySeenCampaignIds = await listRecentlySeenPromotionCampaignIds(getDbPool(), {
    userId,
    siteId: context.user.site_id,
    now,
  });
  const recentlySeenCampaignIdSet = new Set(recentlySeenCampaignIds);

  const scored = campaigns
    .filter((row) => !recentlySeenCampaignIdSet.has(row.id))
    .map((row) => buildCampaignScore({ row, context, messages }))
    .filter((item) => item.eligible)
    .sort(compareCampaignScore);

  if (!scored.length) return { matched: false, reason: "no_campaign" };
  const best = scored[0];
  return {
    matched: true,
    campaign: best.campaign,
    matchScore: best.matchScore,
    matchReason: best.matchReason,
  };
}

export async function reservePromotionCampaignDelivery(input = {}, executor = getDbPool()) {
  const { campaign, userId, characterId, sessionId, matchScore = 0, matchReason = "", deliveryId = "" } = input;
  if (input.job?.id) {
    return withTransaction(async (db) => {
      await assertMemoryJobLease(db, input.job, { lock: true });
      return reservePromotionCampaignDelivery({ ...input, job: null }, db);
    });
  }
  if (!campaign?.id || !userId) return { reserved: false, reason: "missing_scope" };
  const normalizedDeliveryId = String(deliveryId || "").trim() || `campaign_delivery_${crypto.randomUUID()}`;
  try {
    await executor.execute(
      `INSERT INTO promotion_campaign_deliveries (
         id, campaign_id, internal_uid, character_id, session_id, site_id,
         delivery_status, match_score, match_reason
       ) VALUES (?, ?, ?, ?, ?, ?, 'reserved', ?, ?)`,
      [
        normalizedDeliveryId,
        campaign.id,
        userId,
        characterId || null,
        sessionId || null,
        campaign.siteId,
        Number(matchScore || 0),
        String(matchReason || "").slice(0, 255),
      ]
    );
    return { reserved: true, deliveryId: normalizedDeliveryId };
  } catch (error) {
    if (error?.code === "ER_DUP_ENTRY" && deliveryId) {
      const [rows] = await executor.execute(
        `SELECT id, campaign_id, internal_uid, character_id, session_id, site_id, delivery_status
         FROM promotion_campaign_deliveries
         WHERE id = ?
         LIMIT 1`,
        [normalizedDeliveryId]
      );
      const existing = rows[0];
      if (
        existing?.campaign_id === campaign.id
        && existing?.internal_uid === userId
        && (existing?.character_id || null) === (characterId || null)
        && (existing?.session_id || null) === (sessionId || null)
        && existing?.site_id === campaign.siteId
        && ["reserved", "sent"].includes(existing.delivery_status)
      ) {
        return { reserved: true, deliveryId: normalizedDeliveryId, resumed: true };
      }
    }
    if (error?.code === "ER_DUP_ENTRY") return { reserved: false, reason: "already_delivered" };
    throw error;
  }
}

export async function completePromotionCampaignDelivery({ deliveryId, messageId } = {}, executor = getDbPool()) {
  if (!deliveryId) return { ok: true, updated: false };
  const [result] = await executor.execute(
    `UPDATE promotion_campaign_deliveries
     SET delivery_status = 'sent',
         message_id = ?,
         sent_at = NOW(3)
     WHERE id = ? AND delivery_status = 'reserved'
     LIMIT 1`,
    [messageId || null, deliveryId]
  );
  return { ok: true, updated: Number(result.affectedRows || 0) === 1 };
}

export async function cancelPromotionCampaignDelivery({ deliveryId, job = null } = {}, executor = getDbPool()) {
  if (job?.id) {
    return withTransaction(async (db) => {
      await assertMemoryJobLease(db, job, { lock: true });
      return cancelPromotionCampaignDelivery({ deliveryId }, db);
    });
  }
  if (!deliveryId) return { ok: true, deleted: false };
  const [result] = await executor.execute(
    `DELETE FROM promotion_campaign_deliveries
     WHERE id = ?
       AND delivery_status = 'reserved'
     LIMIT 1`,
    [deliveryId]
  );
  return { ok: true, deleted: Number(result.affectedRows || 0) > 0 };
}

async function loadMatchContext({ userId, characterId, sessionId }) {
  const [rows] = await getDbPool().execute(
    `SELECT
       u.id AS user_id,
       u.site_id,
       c.id AS character_id,
       c.category_id,
       s.id AS session_id
     FROM users u
     INNER JOIN ai_characters c ON c.id = ?
     INNER JOIN chat_sessions s ON s.id = ? AND s.internal_uid = u.id AND s.character_id = c.id
     WHERE u.id = ?
     LIMIT 1`,
    [characterId, sessionId, userId]
  );
  if (!rows.length) return null;
  return {
    user: rows[0],
    character: rows[0],
    session: rows[0],
  };
}

async function listEligibleCampaignRows({ siteId, userId, now }) {
  const [rows] = await getDbPool().execute(
    `SELECT
       pc.id,
       pc.site_id,
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
     LEFT JOIN promotion_campaign_deliveries pcd
       ON pcd.campaign_id = pc.id
      AND pcd.internal_uid = ?
     WHERE pc.site_id = ?
       AND pc.campaign_status = 'active'
       AND (pc.starts_at IS NULL OR pc.starts_at <= ?)
       AND (pc.ends_at IS NULL OR pc.ends_at > ?)
       AND pcd.id IS NULL`,
    [userId, siteId, now, now]
  );
  return rows;
}

function buildCampaignScore({ row, context, messages }) {
  const campaign = mapCampaignRow(row);
  if (!matchesRoleTarget(campaign.roleTarget, context.character.category_id)) {
    return { eligible: false };
  }

  const haystack = normalizeSearchText(messages.map((item) => item.text || "").join(" "));
  const titleTokens = tokenize(campaign.productTitle);
  const keywords = campaign.keywords.length ? campaign.keywords : titleTokens;

  let hits = 0;
  const hitTerms = [];
  for (const keyword of keywords) {
    if (!keyword) continue;
    if (haystack.includes(keyword)) {
      hits += 1;
      hitTerms.push(keyword);
    }
  }

  let matchScore = 1000;
  matchScore += Math.min(10, hits) * 100;
  if (!hits && titleTokens.some((token) => haystack.includes(token))) {
    matchScore += 60;
  }
  matchScore -= Number(campaign.priority || 100);

  return {
    eligible: true,
    campaign,
    matchScore,
    matchReason: hitTerms.length ? `keyword:${hitTerms.join("|")}` : "active_fallback",
  };
}

function compareCampaignScore(left, right) {
  if (right.matchScore !== left.matchScore) return right.matchScore - left.matchScore;
  if (left.campaign.priority !== right.campaign.priority) return left.campaign.priority - right.campaign.priority;
  const leftEndsAt = left.campaign.endsAt ? Date.parse(left.campaign.endsAt) : Number.POSITIVE_INFINITY;
  const rightEndsAt = right.campaign.endsAt ? Date.parse(right.campaign.endsAt) : Number.POSITIVE_INFINITY;
  if (leftEndsAt !== rightEndsAt) return leftEndsAt - rightEndsAt;
  const leftCreatedAt = left.campaign.createdAt ? Date.parse(left.campaign.createdAt) : 0;
  const rightCreatedAt = right.campaign.createdAt ? Date.parse(right.campaign.createdAt) : 0;
  if (leftCreatedAt !== rightCreatedAt) return leftCreatedAt - rightCreatedAt;
  return left.campaign.id.localeCompare(right.campaign.id);
}

function matchesRoleTarget(roleTarget, categoryId) {
  if (roleTarget === "all") return true;
  return String(roleTarget || "") === String(categoryId || "");
}

function mapCampaignRow(row) {
  return {
    id: row.id,
    siteId: row.site_id,
    siteSlug: row.site_slug || "",
    title: row.title || "",
    roleTarget: row.role_target || "all",
    productId: row.product_id || "",
    productTitle: row.product_title || "",
    productUrl: row.product_url || "",
    productSnapshot: parseProductSnapshot(row.product_snapshot_json),
    discountCode: row.discount_code || "",
    messageText: row.message_text || "",
    keywords: parseKeywords(row.keywords_json),
    priority: Number(row.priority || 100),
    status: row.campaign_status || "draft",
    startsAt: toIso(row.starts_at),
    endsAt: toIso(row.ends_at),
    sourceType: row.source_type || "admin",
    sourceRef: row.source_ref || "",
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

async function listRecentMessages(sessionId) {
  const [rows] = await getDbPool().execute(
    `SELECT sender_type, text_content
     FROM chat_messages
     WHERE session_id = ?
       AND content_type = 'text'
       AND text_content IS NOT NULL
     ORDER BY display_order DESC, sent_at DESC
     LIMIT 20`,
    [sessionId]
  );
  return rows.map((row) => ({ senderType: row.sender_type, text: row.text_content || "" }));
}

function normalizeSearchText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokenize(value) {
  return Array.from(new Set(normalizeSearchText(value).split(/\s+/).filter((token) => token.length >= 2))).slice(0, 12);
}

function parseProductSnapshot(value) {
  if (!value) return null;
  if (typeof value === "object") return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function parseKeywords(value) {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return Array.isArray(parsed)
      ? parsed.map((item) => normalizeSearchText(item)).filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

function toIso(value) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}
