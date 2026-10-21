import { createId } from "./security.js";

export const CHAT_IMAGE_STATUSES = Object.freeze({
  QUEUED: "queued",
  GENERATING: "generating",
  READY: "ready",
  FAILED: "failed",
  CANCELLED: "cancelled",
});

export const ACTIVE_CHAT_IMAGE_STATUSES = Object.freeze([
  CHAT_IMAGE_STATUSES.QUEUED,
  CHAT_IMAGE_STATUSES.GENERATING,
]);

// Shared across all characters; the first successful image starts a 72-hour window.
export const CHAT_IMAGE_WINDOW_DAYS = 3;
export const CHAT_IMAGE_WINDOW_LIMIT = 10;

export function isActiveChatImageStatus(status = "") {
  return ACTIVE_CHAT_IMAGE_STATUSES.includes(String(status || "").trim().toLowerCase());
}

export function getChatImageUsageDate(date = new Date()) {
  const value = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(value.getTime())) return getChatImageUsageDate(new Date());
  return [
    value.getFullYear(),
    String(value.getMonth() + 1).padStart(2, "0"),
    String(value.getDate()).padStart(2, "0"),
  ].join("-");
}

export async function hasActiveChatImageGeneration(db, sessionId) {
  const [rows] = await db.execute(
    `SELECT id
     FROM chat_image_assets
     WHERE session_id = ?
       AND status IN ('queued', 'generating')
     LIMIT 1`,
    [sessionId]
  );
  return Boolean(rows[0]);
}

export async function countReadyChatImagesForUsageDate(db, { userId, characterId, usageDate = getChatImageUsageDate() } = {}) {
  const normalizedUserId = String(userId || "").trim();
  const normalizedCharacterId = String(characterId || "").trim();
  if (!normalizedUserId || !normalizedCharacterId) return 0;
  const [rows] = await db.execute(
    `SELECT COUNT(*) AS usage_count
     FROM chat_image_usage
     WHERE internal_uid = ?
       AND character_id = ?
       AND usage_date = ?`,
    [normalizedUserId, normalizedCharacterId, usageDate]
  );
  return Number(rows[0]?.usage_count || 0);
}

export async function hasChatImageQuota(db, { userId } = {}) {
  const quota = await getChatImageQuota(db, { userId });
  return quota.allowed;
}

export async function recordChatImageUsage(db, { userId, sessionId, characterId = null, messageId, assetId, usageDate = getChatImageUsageDate() } = {}) {
  const normalizedUserId = String(userId || "").trim();
  const normalizedSessionId = String(sessionId || "").trim();
  const normalizedMessageId = String(messageId || "").trim();
  const normalizedAssetId = String(assetId || "").trim();
  if (!normalizedUserId || !normalizedSessionId || !normalizedMessageId || !normalizedAssetId) return null;

  const usageId = createId("chat_img_usage");
  await lockChatImageQuota(db, normalizedUserId);
  const [existing] = await db.execute("SELECT id FROM chat_image_usage WHERE message_id = ? FOR UPDATE", [normalizedMessageId]);
  if (existing.length) return existing[0].id;
  const [result] = await db.execute(
    `INSERT INTO chat_image_usage (
       id, internal_uid, session_id, character_id, usage_date, message_id, asset_id
     ) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE id = id`,
    [
      usageId,
      normalizedUserId,
      normalizedSessionId,
      characterId || null,
      usageDate,
      normalizedMessageId,
      normalizedAssetId,
    ]
  );
  if (Number(result?.affectedRows || 0) === 1) {
    await recordChatImageQuotaWindowUsage(db, {
      userId: normalizedUserId,
    });
  }
  return usageId;
}

export async function getChatImageQuota(db, { userId } = {}) {
  const normalizedUserId = String(userId || "").trim();
  if (!normalizedUserId) {
    return { allowed: false, count: 0, windowStartedAt: null, windowExpiresAt: null };
  }
  const [rows] = await db.execute(
    `SELECT window_started_at, image_count,
            NOW(3) >= DATE_ADD(window_started_at, INTERVAL 72 HOUR) AS expired
     FROM chat_image_quota_windows
     WHERE internal_uid = ?
     LIMIT 1 FOR UPDATE`,
    [normalizedUserId]
  );
  const row = rows[0] || null;
  const [pending] = await db.execute("SELECT id FROM chat_image_assets WHERE internal_uid = ? AND guest_session_id IS NULL AND status IN ('queued', 'generating') FOR UPDATE", [normalizedUserId]);
  const startedAt = row?.window_started_at ? new Date(row.window_started_at) : null;
  const expiresAt = startedAt ? new Date(startedAt.getTime() + CHAT_IMAGE_WINDOW_DAYS * 24 * 60 * 60 * 1000) : null;
  const expired = !startedAt || Boolean(row?.expired);
  const count = expired ? 0 : Number(row.image_count || 0);
  return {
    allowed: count + pending.length < CHAT_IMAGE_WINDOW_LIMIT,
    pending: pending.length,
    count,
    windowStartedAt: expired ? null : startedAt,
    windowExpiresAt: expired ? null : expiresAt,
  };
}

async function recordChatImageQuotaWindowUsage(db, { userId }) {
  await db.execute(
    `INSERT INTO chat_image_quota_windows (
       internal_uid, window_started_at, image_count
     ) VALUES (?, NOW(3), 1)
     ON DUPLICATE KEY UPDATE
       image_count = IF(
         window_started_at IS NULL
         OR NOW(3) >= DATE_ADD(window_started_at, INTERVAL ${CHAT_IMAGE_WINDOW_DAYS} DAY),
         1,
         image_count + 1
       ),
       window_started_at = IF(
         window_started_at IS NULL
         OR NOW(3) >= DATE_ADD(window_started_at, INTERVAL ${CHAT_IMAGE_WINDOW_DAYS} DAY),
         NOW(3),
         window_started_at
       ),
       updated_at = NOW(3)`,
    [userId]
  );
}

// Call within the same transaction as admission or successful usage recording.
export async function lockChatImageQuota(db, userId) {
  await db.execute(`INSERT INTO chat_image_quota_windows (internal_uid, window_started_at, image_count)
    VALUES (?, NULL, 0) ON DUPLICATE KEY UPDATE internal_uid = internal_uid`, [userId]);
}
