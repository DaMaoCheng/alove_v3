import { createId } from "./security.js";
import { getDbPool } from "./db.js";
import { createPublicError } from "./public-error-utils.js";
import { consumeGuestNetworkQuota } from "./guest-network-rate-limit-service.js";
import { acquireDbAdvisoryLock } from "./db-advisory-lock-service.js";
import { GUEST_MESSAGE_LIMIT, GUEST_RATE_LIMIT } from "./guest-message-quota-policy.js";

const WINDOW_24H_MS = 24 * 60 * 60 * 1000;
const WINDOW_10M_MS = 10 * 60 * 1000;
const PROCESSING_LEASE_MS = 2 * 60 * 1000;
const MAX_ASR_ATTEMPTS_PER_REQUEST = 2;
const MAX_ASR_ATTEMPTS_PER_GUEST_WINDOW = 20;
const GUEST_INFLIGHT_LIMIT = 1;
const NETWORK_INFLIGHT_LIMIT = 2;
const GLOBAL_INFLIGHT_LIMIT = 4;

export async function reserveGuestVoiceRequest({ guest, requestKey, networkHash }) {
  const normalizedRequestKey = String(requestKey || "").trim().slice(0, 128);
  const normalizedNetworkHash = String(networkHash || "").trim();
  if (!guest?.id || !normalizedRequestKey) throw createPublicError("Voice message id is required.", 400);
  if (!normalizedNetworkHash) throw createPublicError("Guest voice input is unavailable.", 503);
  const connection = await getDbPool().getConnection();
  let releaseReservationLock = async () => {};
  try {
    releaseReservationLock = await acquireDbAdvisoryLock(connection, "guest_voice_reservation", 10);
    await connection.beginTransaction();
    const [guestRows] = await connection.execute(
      `SELECT *, NOW(3) AS db_now FROM guest_sessions
       WHERE id = ? AND session_status = 'active' AND expires_at > NOW(3)
         AND claimed_user_id IS NULL AND claimed_at IS NULL
       LIMIT 1 FOR UPDATE`,
      [guest.id]
    );
    const lockedGuest = guestRows[0] || null;
    if (!lockedGuest) throw createPublicError("Please start a guest chat first.", 401);
    const characterId = String(guest.mascot_character_id || "").trim();
    const [quotaRows] = await connection.execute(
      `SELECT *, NOW(3) AS db_now FROM guest_character_sessions
       WHERE guest_session_id = ? AND character_id = ?
       LIMIT 1 FOR UPDATE`,
      [guest.id, characterId]
    );
    // Older guest rows are migrated lazily on their next chat read. Keep the
    // legacy root window as a safe compatibility fallback for a voice request
    // that races that first read; all new/migrated role sessions use GCS.
    const quotaSession = quotaRows[0] || lockedGuest;
    const [existingRows] = await connection.execute(
      "SELECT * FROM guest_voice_requests WHERE guest_session_id = ? AND character_id = ? AND request_key = ? LIMIT 1",
      [guest.id, characterId, normalizedRequestKey]
    );
    const existing = existingRows[0] || null;
    if (["transcribed", "consumed"].includes(existing?.request_status) && String(existing.transcript_text || "").trim()) {
      await connection.commit();
      return { id: existing.id, attemptToken: "", shouldTranscribe: false, transcriptText: String(existing.transcript_text).trim() };
    }
    const now = new Date(lockedGuest.db_now).getTime();
    if (existing?.request_status === "processing" && now - new Date(existing.updated_at).getTime() < PROCESSING_LEASE_MS) {
      throw createPublicError("This voice message is still being transcribed.", 409);
    }
    if (existing && Number(existing.attempt_count || 0) >= MAX_ASR_ATTEMPTS_PER_REQUEST) {
      throw createPublicError("Voice transcription could not be completed. Please record a new message.", 422);
    }
    const [[inflight]] = await connection.execute(
      `SELECT
         COUNT(*) AS global_count,
         SUM(CASE WHEN network_hash = ? THEN 1 ELSE 0 END) AS network_count,
         SUM(CASE WHEN guest_session_id = ? AND character_id = ? THEN 1 ELSE 0 END) AS guest_count
       FROM guest_voice_requests
       WHERE request_status = 'processing' AND updated_at >= DATE_SUB(NOW(3), INTERVAL 2 MINUTE)
         AND (? = '' OR id <> ?)`,
      [normalizedNetworkHash, guest.id, characterId, existing?.id || "", existing?.id || ""]
    );
    if (Number(inflight?.global_count || 0) >= GLOBAL_INFLIGHT_LIMIT
      || Number(inflight?.network_count || 0) >= NETWORK_INFLIGHT_LIMIT
      || Number(inflight?.guest_count || 0) >= GUEST_INFLIGHT_LIMIT) {
      throw createPublicError("Too many guest voice messages are being processed. Please try again shortly.", 429);
    }
    await assertVoiceCapacity(connection, {
      guest: { ...lockedGuest, ...quotaSession, db_now: quotaSession.db_now || lockedGuest.db_now },
      characterId,
      requestKey: normalizedRequestKey,
    });
    await consumeGuestNetworkQuota(connection, { networkHash: normalizedNetworkHash, siteId: lockedGuest.site_id, action: "message" });
    const [[attemptUsage]] = await connection.execute(
      `SELECT COALESCE(SUM(attempt_count), 0) AS attempts
       FROM guest_voice_requests
       WHERE guest_session_id = ? AND character_id = ? AND updated_at >= DATE_SUB(NOW(3), INTERVAL 10 MINUTE)`,
      [guest.id, characterId]
    );
    if (Number(attemptUsage?.attempts || 0) >= MAX_ASR_ATTEMPTS_PER_GUEST_WINDOW) {
      throw createPublicError("Voice transcription limit reached. Please try again later.", 429);
    }
    const attemptToken = createId("voice_request_attempt");
    const id = existing?.id || createId("guest_voice_request");
    if (existing) {
      await connection.execute(
        `UPDATE guest_voice_requests
         SET request_status = 'processing', network_hash = ?, character_id = ?, attempt_token = ?, attempt_count = attempt_count + 1,
             error_message = NULL, updated_at = NOW(3)
         WHERE id = ?`,
        [normalizedNetworkHash, characterId, attemptToken, id]
      );
    } else {
      await connection.execute(
        `INSERT INTO guest_voice_requests (
           id, guest_session_id, character_id, network_hash, request_key, request_status, attempt_token, attempt_count, expires_at
         ) VALUES (?, ?, ?, ?, ?, 'processing', ?, 1, ?)`,
        [id, guest.id, characterId, normalizedNetworkHash, normalizedRequestKey, attemptToken, lockedGuest.expires_at]
      );
    }
    await connection.commit();
    return { id, attemptToken, shouldTranscribe: true, transcriptText: "" };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    await releaseReservationLock().catch(() => {});
    connection.release();
  }
}

export async function completeGuestVoiceTranscription({ requestId, attemptToken, transcriptText }) {
  const normalizedText = String(transcriptText || "").replace(/\s+/g, " ").trim().slice(0, 2000);
  if (!normalizedText) throw createPublicError("Voice transcription returned no text.", 422);
  const [result] = await getDbPool().execute(
    `UPDATE guest_voice_requests
     SET request_status = 'transcribed', transcript_text = ?, attempt_token = NULL, error_message = NULL, updated_at = NOW(3)
     WHERE id = ? AND request_status = 'processing' AND attempt_token = ?`,
    [normalizedText, requestId, attemptToken]
  );
  if (Number(result.affectedRows || 0) !== 1) throw createPublicError("Voice transcription request expired.", 409);
  return normalizedText;
}

export async function failGuestVoiceTranscription({ requestId, attemptToken, error }) {
  await getDbPool().execute(
    `UPDATE guest_voice_requests
     SET request_status = 'failed', attempt_token = NULL, error_message = ?, updated_at = NOW(3)
     WHERE id = ? AND request_status = 'processing' AND attempt_token = ?`,
    [String(error?.message || "Voice transcription failed.").slice(0, 500), requestId, attemptToken]
  );
}

export async function markGuestVoiceRequestConsumed({ guestSessionId, characterId, requestKey }) {
  await getDbPool().execute(
    `UPDATE guest_voice_requests SET request_status = 'consumed', updated_at = NOW(3)
     WHERE guest_session_id = ? AND character_id = ? AND request_key = ? AND request_status IN ('transcribed', 'consumed')`,
    [guestSessionId, String(characterId || "").trim(), requestKey]
  );
}

async function assertVoiceCapacity(db, { guest, characterId, requestKey }) {
  const now = new Date(guest.db_now).getTime();
  const dailyStart = new Date(guest.message_window_started_at || 0).getTime();
  const rateStart = new Date(guest.rate_window_started_at || 0).getTime();
  const dailyCount = !dailyStart || now - dailyStart >= WINDOW_24H_MS ? 0 : Number(guest.message_window_count || 0);
  const rateCount = !rateStart || now - rateStart >= WINDOW_10M_MS ? 0 : Number(guest.rate_window_count || 0);
  const [[reserved]] = await db.execute(
    `SELECT COUNT(*) AS count FROM guest_voice_requests
     WHERE guest_session_id = ? AND character_id = ? AND request_key <> ? AND request_status IN ('processing', 'transcribed')`,
    [guest.id, String(characterId || "").trim(), requestKey]
  );
  const reservedCount = Number(reserved?.count || 0);
  if (dailyCount + reservedCount >= GUEST_MESSAGE_LIMIT || rateCount + reservedCount >= GUEST_RATE_LIMIT) {
    throw createPublicError("Please sign in to continue chatting.", 429);
  }
}
