import { createPublicError } from "./public-error-utils.js";
import { getDbPool } from "./db.js";
import { createId, hashSessionToken } from "./security.js";
import { GUEST_MESSAGE_LIMIT } from "./guest-message-quota-policy.js";

export const GUEST_CALL_MESSAGE_LIMIT = GUEST_MESSAGE_LIMIT;
const MESSAGE_WINDOW_MILLISECONDS = 24 * 60 * 60 * 1000;
const ACTIVE_CALL_LEASE_MILLISECONDS = 10 * 1000;
const GUEST_NETWORK_ACTIVE_CALL_LIMIT = 1;
const GUEST_GLOBAL_ACTIVE_CALL_LIMIT = 50;
const GUEST_CALL_ADMISSION_LOCK = "guest_call_admission";
const GUEST_GUARDED_INPUT_LIMIT_MILLISECONDS = 10 * 60 * 1000;
const NETWORK_GUARDED_INPUT_LIMIT_MILLISECONDS = 20 * 60 * 1000;
const CALL_START_WINDOW_MINUTES = 10;
const CALL_START_LIMIT = 10;

export async function startGuestCall({ token, callSessionId, characterId, networkHash }) {
  const tokenHash = hashSessionToken(token);
  const normalizedCallId = normalizeCallId(callSessionId);
  const normalizedCharacterId = String(characterId || "").trim();
  const normalizedNetworkHash = String(networkHash || "").trim();
  if (!tokenHash || !normalizedCallId || !normalizedCharacterId || !/^[a-f0-9]{64}$/.test(normalizedNetworkHash)) {
    throw createPublicError("Guest call is unavailable.", 401);
  }
  const db = await getDbPool().getConnection();
  let rejection = null;
  let admissionLocked = false;
  try {
    const [[admission]] = await db.execute("SELECT GET_LOCK(?, 5) AS locked", [GUEST_CALL_ADMISSION_LOCK]);
    admissionLocked = Number(admission?.locked || 0) === 1;
    if (!admissionLocked) throw createPublicError("Guest calls are busy. Please try again.", 503);
    await db.beginTransaction();
    const [guestRows] = await db.execute(
      `SELECT g.*, s.site_status, s.guest_chat_enabled, NOW(3) AS db_now
       FROM guest_sessions g
       JOIN sites s ON s.id = g.site_id
       WHERE g.token_hash = ?
       LIMIT 1 FOR UPDATE`,
      [tokenHash]
    );
    const guest = guestRows[0] || null;
    const scopedGuest = guest && await loadGuestCharacterQuotaForDb(db, guest, normalizedCharacterId);
    if (!isAvailableGuest(guest) || !scopedGuest) {
      throw createPublicError("Guest call is unavailable.", 401);
    }
    if (guest.active_call_id) {
      const [activeRows] = await db.execute(
        "SELECT * FROM guest_call_sessions WHERE id = ? AND guest_session_id = ? LIMIT 1 FOR UPDATE",
        [guest.active_call_id, guest.id]
      );
      const active = activeRows[0] || null;
      if (active?.call_status === "active" && active.id === normalizedCallId) {
        await db.commit();
        return callUsageResult({ guest: scopedGuest, call: active });
      }
      if (active?.call_status === "active") {
        const leaseAge = millisecondsBetween(active.last_accounted_at, guest.db_now);
        if (leaseAge < ACTIVE_CALL_LEASE_MILLISECONDS) {
          throw createPublicError("Another guest call is already active.", 409);
        }
        await db.execute(
          `UPDATE guest_call_sessions
           SET call_status = 'interrupted', duration_milliseconds = duration_milliseconds + ?,
               guarded_input_milliseconds = guarded_input_milliseconds + pending_input_milliseconds,
               guarded_input_updated_at = CASE WHEN pending_input_milliseconds > 0 THEN ? ELSE guarded_input_updated_at END,
               pending_input_milliseconds = 0,
               last_accounted_at = ?, ended_at = ?, updated_at = NOW(3)
           WHERE id = ? AND call_status = 'active'`,
          [leaseAge, guest.db_now, guest.db_now, guest.db_now, active.id]
        );
      }
    }
    const [[activeCounts]] = await db.execute(
      `SELECT
         SUM(CASE WHEN network_hash = ? THEN 1 ELSE 0 END) AS network_active,
         COUNT(*) AS global_active
       FROM guest_call_sessions
       WHERE call_status = 'active' AND last_accounted_at > DATE_SUB(?, INTERVAL 10 SECOND)`,
      [normalizedNetworkHash, guest.db_now]
    );
    const [[guardedUsage]] = await db.execute(
      `SELECT
         COALESCE(SUM(CASE WHEN guest_session_id = ? THEN guarded_input_milliseconds ELSE 0 END), 0) AS guest_guarded_ms,
         COALESCE(SUM(CASE WHEN network_hash = ? THEN guarded_input_milliseconds ELSE 0 END), 0) AS network_guarded_ms
       FROM guest_call_sessions
       WHERE guarded_input_updated_at >= DATE_SUB(?, INTERVAL 24 HOUR)`,
      [guest.id, normalizedNetworkHash, guest.db_now]
    );
    const [[recentStarts]] = await db.execute(
      `SELECT
         SUM(guest_session_id = ?) AS guest_starts,
         SUM(network_hash = ?) AS network_starts
       FROM guest_call_sessions
       WHERE started_at >= DATE_SUB(?, INTERVAL ${CALL_START_WINDOW_MINUTES} MINUTE)`,
      [guest.id, normalizedNetworkHash, guest.db_now]
    );
    const messageCount = currentGuestMessageCount(scopedGuest);
    await db.execute("UPDATE guest_sessions SET active_call_id = NULL WHERE id = ?", [guest.id]);
    if (Number(activeCounts.network_active || 0) >= GUEST_NETWORK_ACTIVE_CALL_LIMIT) {
      rejection = createPublicError("Another guest call is already active on this network.", 409);
      await db.commit();
    } else if (Number(activeCounts.global_active || 0) >= GUEST_GLOBAL_ACTIVE_CALL_LIMIT) {
      rejection = createPublicError("Guest calls are busy. Please try again later.", 503);
      await db.commit();
    } else if (messageCount >= GUEST_CALL_MESSAGE_LIMIT) {
      rejection = createPublicError("Please sign in to continue chatting.", 429);
      rejection.code = "GUEST_MESSAGE_LIMIT_REACHED";
      await db.commit();
    } else if (Number(guardedUsage.guest_guarded_ms || 0) >= GUEST_GUARDED_INPUT_LIMIT_MILLISECONDS
      || Number(guardedUsage.network_guarded_ms || 0) >= NETWORK_GUARDED_INPUT_LIMIT_MILLISECONDS) {
      rejection = createPublicError("Guest call is temporarily unavailable. Please try again later.", 429);
      rejection.code = "GUEST_PROVIDER_GUARD_REACHED";
      await db.commit();
    } else if (Number(recentStarts.guest_starts || 0) >= CALL_START_LIMIT || Number(recentStarts.network_starts || 0) >= CALL_START_LIMIT) {
      rejection = createPublicError("Guest calls are starting too frequently. Please try again later.", 429);
      rejection.code = "GUEST_CALL_START_RATE_REACHED";
      await db.commit();
    } else {
      const leaseToken = createId("call_lease");
      await db.execute(
        `INSERT INTO guest_call_sessions (
           id, guest_session_id, site_id, character_id, network_hash, lease_token, call_status,
           duration_milliseconds, started_at, last_accounted_at, expires_at
         ) VALUES (?, ?, ?, ?, ?, ?, 'active', 0, ?, ?, ?)`,
        [normalizedCallId, guest.id, guest.site_id, normalizedCharacterId, normalizedNetworkHash, leaseToken, guest.db_now, guest.db_now, guest.expires_at]
      );
      await db.execute("UPDATE guest_sessions SET active_call_id = ? WHERE id = ?", [normalizedCallId, guest.id]);
      await db.commit();
      return {
        guestSessionId: scopedGuest.id,
        callSessionId: normalizedCallId,
        leaseToken,
        messageCount,
        messageLimit: GUEST_CALL_MESSAGE_LIMIT,
        remainingMessages: Math.max(0, GUEST_CALL_MESSAGE_LIMIT - messageCount),
      };
    }
  } catch (error) {
    await db.rollback();
    throw error;
  } finally {
    if (admissionLocked) await db.execute("SELECT RELEASE_LOCK(?)", [GUEST_CALL_ADMISSION_LOCK]).catch(() => {});
    db.release();
  }
  throw rejection;
}

export function accountGuestCall({ guestSessionId, callSessionId, leaseToken, pendingInputMilliseconds = 0, pendingInputEpoch = 0 }) {
  return settleGuestCall({ guestSessionId, callSessionId, leaseToken, endStatus: "", guardedInputMilliseconds: 0, pendingInputMilliseconds, pendingInputEpoch });
}

export function endGuestCall({ guestSessionId, callSessionId, leaseToken, status = "ended", guardedInputMilliseconds = 0 }) {
  const normalizedStatus = ["ended", "interrupted", "claimed", "message_limit_reached", "provider_guard"].includes(status) ? status : "ended";
  return settleGuestCall({ guestSessionId, callSessionId, leaseToken, endStatus: normalizedStatus, guardedInputMilliseconds, pendingInputMilliseconds: 0, pendingInputEpoch: 0 });
}

export async function claimGuestCallForDb(db, { guestSessionId, callSessionId }) {
  const guestId = String(guestSessionId || "").trim();
  const callId = normalizeCallId(callSessionId);
  if (!guestId || !callId) return { claimed: false, durationMilliseconds: 0 };
  const [[clock]] = await db.execute("SELECT NOW(3) AS db_now");
  const [rows] = await db.execute(
    "SELECT * FROM guest_call_sessions WHERE id = ? AND guest_session_id = ? LIMIT 1 FOR UPDATE",
    [callId, guestId]
  );
  const call = rows[0] || null;
  if (!call || call.call_status !== "active") {
    return { claimed: false, durationMilliseconds: Number(call?.duration_milliseconds || 0) };
  }
  const consumed = millisecondsBetween(call.last_accounted_at, clock.db_now);
  await closeCallRow(db, { call, dbNow: clock.db_now, status: "claimed", consumed, guardedInputMilliseconds: 0 });
  return {
    claimed: true,
    durationMilliseconds: Number(call.duration_milliseconds || 0) + consumed,
  };
}

async function settleGuestCall({ guestSessionId, callSessionId, leaseToken, endStatus, guardedInputMilliseconds, pendingInputMilliseconds, pendingInputEpoch }) {
  const normalizedGuestId = String(guestSessionId || "").trim();
  const normalizedCallId = normalizeCallId(callSessionId);
  const normalizedLeaseToken = String(leaseToken || "").trim();
  if (!normalizedGuestId || !normalizedCallId || !normalizedLeaseToken) {
    return { active: false, reason: "unavailable", messageCount: 0, messageLimit: GUEST_CALL_MESSAGE_LIMIT, remainingMessages: 0 };
  }
  const db = await getDbPool().getConnection();
  try {
    await db.beginTransaction();
    const [guestRows] = await db.execute(
      `SELECT g.*, s.site_status, s.guest_chat_enabled, NOW(3) AS db_now
       FROM guest_sessions g
       LEFT JOIN sites s ON s.id = g.site_id
       WHERE g.id = ? LIMIT 1 FOR UPDATE`,
      [normalizedGuestId]
    );
    const guest = guestRows[0] || null;
    const [callRows] = await db.execute(
      `SELECT * FROM guest_call_sessions
       WHERE id = ? AND guest_session_id = ? AND lease_token = ? LIMIT 1 FOR UPDATE`,
      [normalizedCallId, normalizedGuestId, normalizedLeaseToken]
    );
    const call = callRows[0] || null;
    const scopedGuest = guest && call ? await loadGuestCharacterQuotaForDb(db, guest, call.character_id) : null;
    if (!call || call.call_status !== "active") {
      await db.commit();
      return { active: false, reason: call?.call_status || "unavailable", ...messageUsage(scopedGuest || guest), remainingMessages: 0 };
    }
    const dbNow = guest?.db_now || new Date();
    const consumed = millisecondsBetween(call.last_accounted_at, dbNow);
    if (!guest || String(guest.active_call_id || "") !== normalizedCallId) {
      await closeCallRow(db, { call, dbNow, status: "interrupted", consumed, guardedInputMilliseconds: 0 });
      await db.commit();
      return { active: false, reason: "replaced", ...messageUsage(scopedGuest || guest), remainingMessages: 0 };
    }
    const unavailable = !isAvailableGuest(guest);
    const nextStatus = unavailable ? (guest.claimed_user_id ? "claimed" : "interrupted") : endStatus;
    if (nextStatus) {
      await closeCallRow(db, { call, dbNow, status: nextStatus, consumed, guardedInputMilliseconds });
      await db.execute("UPDATE guest_sessions SET active_call_id = NULL WHERE id = ? AND active_call_id = ?", [guest.id, normalizedCallId]);
      await db.commit();
      return {
        active: false,
        reason: nextStatus,
        ...messageUsage(scopedGuest || guest),
        durationMilliseconds: Number(call.duration_milliseconds || 0) + consumed,
      };
    }
    await db.execute(
      `UPDATE guest_call_sessions
       SET duration_milliseconds = duration_milliseconds + ?, pending_input_milliseconds = ?, last_accounted_at = ?, updated_at = NOW(3)
       WHERE id = ? AND call_status = 'active' AND lease_token = ? AND pending_input_epoch = ?`,
      [consumed, Math.max(0, Number(pendingInputMilliseconds || 0)), dbNow, call.id, normalizedLeaseToken, Math.max(0, Number(pendingInputEpoch || 0))]
    );
    await db.commit();
    return {
      active: true,
      reason: "active",
      ...messageUsage(scopedGuest || guest),
      durationMilliseconds: Number(call.duration_milliseconds || 0) + consumed,
    };
  } catch (error) {
    await db.rollback();
    throw error;
  } finally {
    db.release();
  }
}

async function loadGuestCharacterQuotaForDb(db, guest, characterId) {
  const normalizedCharacterId = String(characterId || "").trim();
  if (!normalizedCharacterId) return null;
  const [rows] = await db.execute(
    `SELECT gcs.message_window_started_at, gcs.message_window_count,
            character_record.id AS character_id
     FROM guest_character_sessions gcs
     JOIN ai_characters character_record ON character_record.id = gcs.character_id
     WHERE gcs.guest_session_id = ? AND gcs.character_id = ?
       AND character_record.visibility = 'public' AND character_record.character_status = 'published'
       AND (character_record.category_id <> 'mascot' OR character_record.id = ?)
       AND (character_record.category_id <> 'creator' OR character_record.site_id = ?)
     LIMIT 1 FOR UPDATE`,
    [guest.id, normalizedCharacterId, guest.mascot_character_id, guest.site_id]
  );
  const row = rows[0];
  if (!row) return null;
  return { ...guest, ...row };
}

async function closeCallRow(db, { call, dbNow, status, consumed, guardedInputMilliseconds = 0 }) {
  await db.execute(
    `UPDATE guest_call_sessions
     SET call_status = ?, duration_milliseconds = duration_milliseconds + ?,
         guarded_input_milliseconds = guarded_input_milliseconds + GREATEST(pending_input_milliseconds, ?),
         guarded_input_updated_at = CASE WHEN GREATEST(pending_input_milliseconds, ?) > 0 THEN ? ELSE guarded_input_updated_at END,
         pending_input_milliseconds = 0,
         last_accounted_at = ?, ended_at = ?, updated_at = NOW(3)
     WHERE id = ? AND call_status = 'active' AND lease_token = ?`,
    [status, consumed, Math.max(0, Number(guardedInputMilliseconds || 0)), Math.max(0, Number(guardedInputMilliseconds || 0)), dbNow, dbNow, dbNow, call.id, call.lease_token]
  );
}

function isAvailableGuest(guest) {
  return Boolean(guest
    && guest.session_status === "active"
    && !guest.claimed_user_id
    && !guest.claimed_at
    && new Date(guest.expires_at || 0).getTime() > new Date(guest.db_now || Date.now()).getTime()
    && guest.site_status === "active"
    && Number(guest.guest_chat_enabled || 0) === 1);
}

function currentGuestMessageCount(guest, nowValue = guest?.db_now || Date.now()) {
  const startedAt = new Date(guest?.message_window_started_at || 0).getTime();
  const now = new Date(nowValue).getTime();
  if (!startedAt || !now || now - startedAt >= MESSAGE_WINDOW_MILLISECONDS) return 0;
  return Math.max(0, Number(guest?.message_window_count || 0));
}

function messageUsage(guest) {
  const messageCount = currentGuestMessageCount(guest);
  return {
    messageCount,
    messageLimit: GUEST_CALL_MESSAGE_LIMIT,
    remainingMessages: Math.max(0, GUEST_CALL_MESSAGE_LIMIT - messageCount),
  };
}

function millisecondsBetween(start, end) {
  return Math.max(0, new Date(end || 0).getTime() - new Date(start || 0).getTime());
}

function normalizeCallId(value) {
  const normalized = String(value || "").trim();
  return /^call_[a-zA-Z0-9-]+$/.test(normalized) ? normalized.slice(0, 64) : "";
}

function callUsageResult({ guest, call }) {
  return {
    guestSessionId: guest.id,
    callSessionId: call.id,
    leaseToken: call.lease_token,
    ...messageUsage(guest),
  };
}
