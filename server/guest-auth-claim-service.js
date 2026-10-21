import { MEMORY_JOB_TYPES, enqueueMemoryJob } from "./memory-job-service.js";
import { createPublicError } from "./public-error-utils.js";
import { hashSessionToken } from "./security.js";
import { claimGuestCallForDb } from "./guest-call-usage-service.js";

export const GUEST_CLAIM_STATUSES = Object.freeze({
  NONE: "none",
  INVALID: "invalid",
  CLAIMED: "claimed",
  SITE_MISMATCH: "site_mismatch",
  ALREADY_CLAIMED: "already_claimed",
});

const SITE_MISMATCH_MESSAGE = "This guest conversation belongs to another site and was not added to this account.";

export async function claimGuestSessionForUser(db, {
  guestToken = "",
  userId = "",
  strictSiteMatch = false,
} = {}) {
  const tokenHash = hashSessionToken(guestToken);
  const normalizedUserId = String(userId || "").trim();
  if (!tokenHash) return claimResult(GUEST_CLAIM_STATUSES.NONE);
  if (!normalizedUserId) throw createPublicError("Guest claim user is missing.", 400);

  const [userRows] = await db.execute(
    "SELECT id, site_id FROM users WHERE id = ? AND account_status = 'active' LIMIT 1 FOR UPDATE",
    [normalizedUserId]
  );
  const user = userRows[0] || null;
  if (!user) throw createPublicError("Account is unavailable.", 401);

  const [guestRows] = await db.execute(
    `SELECT g.*, s.site_status
     FROM guest_sessions g
     JOIN sites s ON s.id = g.site_id
     WHERE g.token_hash = ?
     LIMIT 1
     FOR UPDATE`,
    [tokenHash]
  );
  const guest = guestRows[0] || null;
  if (!guest) return claimResult(GUEST_CLAIM_STATUSES.INVALID);
  if (guest.session_status === "claimed") {
    if (String(guest.claimed_user_id || "") !== normalizedUserId) {
      return claimResult(GUEST_CLAIM_STATUSES.ALREADY_CLAIMED, {
        message: "This guest conversation has already been added to another account.",
      });
    }
    await db.execute(
      `UPDATE guest_call_sessions
       SET claimed_user_id = ?, target_chat_session_id = ?, updated_at = NOW(3)
       WHERE guest_session_id = ?`,
      [normalizedUserId, guest.target_chat_session_id || guest.chat_session_id, guest.id]
    );
    return claimResult(GUEST_CLAIM_STATUSES.CLAIMED, {
      guestSessionId: guest.id,
      targetSessionId: guest.target_chat_session_id || guest.chat_session_id,
      characterId: guest.mascot_character_id,
      idempotent: true,
    });
  }
  const expired = !guest.expires_at || new Date(guest.expires_at).getTime() <= Date.now();
  if (guest.session_status !== "active" || expired || guest.site_status !== "active") {
    return claimResult(GUEST_CLAIM_STATUSES.INVALID);
  }
  if (!user.site_id || String(user.site_id) !== String(guest.site_id)) {
    if (strictSiteMatch) throw createPublicError(SITE_MISMATCH_MESSAGE, 409);
    return claimResult(GUEST_CLAIM_STATUSES.SITE_MISMATCH, {
      guestSessionId: guest.id,
      characterId: guest.mascot_character_id,
      message: SITE_MISMATCH_MESSAGE,
    });
  }

  const guestSessions = await listGuestCharacterSessionsForClaim(db, guest);
  if (!guestSessions.length) throw createPublicError("Guest conversation is unavailable.", 409);

  if (guest.active_call_id) {
    await claimGuestCallForDb(db, { guestSessionId: guest.id, callSessionId: guest.active_call_id });
  }

  await db.execute(
    "UPDATE guest_sessions SET session_status = 'claiming', active_call_id = NULL, updated_at = NOW(3) WHERE id = ?",
    [guest.id]
  );
  const claimedSessions = [];
  for (const guestSession of guestSessions) {
    await db.execute(
      `UPDATE chat_messages
       SET guest_session_id = ?
       WHERE session_id = ? AND guest_session_id IS NULL`,
      [guest.id, guestSession.id]
    );
    const targetSession = await findExistingUserSession(db, {
      userId: normalizedUserId,
      characterId: guestSession.character_id,
    });
    const targetSessionId = targetSession?.id || guestSession.id;
    if (targetSession && targetSession.id !== guestSession.id) {
      await mergeGuestSessionIntoTarget(db, { guestSessionId: guestSession.id, targetSessionId });
    } else {
      await db.execute(
        `UPDATE chat_sessions
         SET internal_uid = ?, source_type = 'user', source_ref = 'guest-claim', updated_at = NOW(3)
         WHERE id = ? AND guest_session_id = ?`,
        [normalizedUserId, guestSession.id, guest.id]
      );
    }
    await db.execute(
      `UPDATE guest_character_sessions
       SET target_chat_session_id = ?, updated_at = NOW(3)
       WHERE guest_session_id = ? AND character_id = ?`,
      [targetSessionId, guest.id, guestSession.character_id]
    );
    await enqueueMemoryJob({
      sessionId: targetSessionId,
      userId: normalizedUserId,
      characterId: guestSession.character_id,
      jobType: MEMORY_JOB_TYPES.BACKFILL_CLAIMED_GUEST_CONTEXT,
      priority: 64,
      payload: { sessionId: targetSessionId, userId: normalizedUserId, characterId: guestSession.character_id },
    }, db);
    claimedSessions.push({ characterId: guestSession.character_id, targetSessionId });
  }
  const primaryTargetSessionId = claimedSessions.find((item) => item.characterId === guest.mascot_character_id)?.targetSessionId
    || claimedSessions[0]?.targetSessionId || "";

  await db.execute(
    `UPDATE guest_sessions
     SET session_status = 'claimed',
         claimed_user_id = ?,
         claimed_at = NOW(3),
         target_chat_session_id = ?,
         updated_at = NOW(3)
     WHERE id = ?
       AND session_status = 'claiming'`,
    [normalizedUserId, primaryTargetSessionId, guest.id]
  );
  await db.execute(
    `UPDATE guest_call_sessions call_session
     LEFT JOIN guest_character_sessions character_session
       ON character_session.guest_session_id = call_session.guest_session_id
      AND character_session.character_id = call_session.character_id
     SET call_session.claimed_user_id = ?,
         call_session.target_chat_session_id = COALESCE(NULLIF(character_session.target_chat_session_id, ''), ?),
         call_session.updated_at = NOW(3)
     WHERE call_session.guest_session_id = ?`,
    [normalizedUserId, primaryTargetSessionId, guest.id]
  );
  await db.execute("DELETE FROM guest_voice_requests WHERE guest_session_id = ?", [guest.id]);

  return claimResult(GUEST_CLAIM_STATUSES.CLAIMED, {
    guestSessionId: guest.id,
    targetSessionId: primaryTargetSessionId,
    characterId: guest.mascot_character_id,
    idempotent: false,
  });
}

async function listGuestCharacterSessionsForClaim(db, guest) {
  const [rows] = await db.execute(
    `SELECT session.id, session.character_id
     FROM chat_sessions session
     WHERE session.guest_session_id = ?
       AND session.internal_uid IS NULL
       AND session.session_status = 'active'
     ORDER BY (session.id = ?) DESC, session.created_at ASC
     FOR UPDATE`,
    [guest.id, guest.chat_session_id]
  );
  return rows;
}

async function findExistingUserSession(db, { userId, characterId }) {
  const [rows] = await db.execute(
    `SELECT id
     FROM chat_sessions
     WHERE internal_uid = ?
       AND character_id = ?
       AND session_status = 'active'
       AND source_type = 'user'
     ORDER BY last_message_at DESC, updated_at DESC, id DESC
     LIMIT 1
     FOR UPDATE`,
    [userId, characterId]
  );
  return rows[0] || null;
}

async function mergeGuestSessionIntoTarget(db, { guestSessionId, targetSessionId }) {
  await db.execute(
    `UPDATE chat_messages
     SET client_message_id = CONCAT('claimed:', id),
         updated_at = NOW(3)
     WHERE session_id = ?
       AND client_message_id IS NOT NULL`,
    [guestSessionId]
  );
  await db.execute(
    "UPDATE chat_image_assets SET session_id = ?, updated_at = NOW(3) WHERE session_id = ?",
    [targetSessionId, guestSessionId]
  );
  await db.execute(
    "UPDATE memory_jobs SET session_id = ?, updated_at = NOW(3) WHERE session_id = ?",
    [targetSessionId, guestSessionId]
  );
  await db.execute(
    "UPDATE chat_messages SET session_id = ?, updated_at = NOW(3) WHERE session_id = ?",
    [targetSessionId, guestSessionId]
  );
  await db.execute(
    `UPDATE chat_messages m
     JOIN (
       SELECT id, ROW_NUMBER() OVER (ORDER BY sent_at ASC, display_order ASC, id ASC) * 10 AS next_order
       FROM chat_messages
       WHERE session_id = ?
     ) ordered ON ordered.id = m.id
     SET m.display_order = ordered.next_order,
         m.updated_at = NOW(3)`,
    [targetSessionId]
  );
  await db.execute(
    `UPDATE chat_sessions
     SET last_message_at = COALESCE((SELECT MAX(sent_at) FROM chat_messages WHERE session_id = ?), last_message_at),
         updated_at = NOW(3)
     WHERE id = ?`,
    [targetSessionId, targetSessionId]
  );
  await db.execute(
    "DELETE FROM chat_sessions WHERE id = ? AND internal_uid IS NULL",
    [guestSessionId]
  );
}

function claimResult(status, extra = {}) {
  return {
    status,
    claimed: status === GUEST_CLAIM_STATUSES.CLAIMED,
    clearGuestCookie: [
      GUEST_CLAIM_STATUSES.CLAIMED,
      GUEST_CLAIM_STATUSES.INVALID,
      GUEST_CLAIM_STATUSES.ALREADY_CLAIMED,
    ].includes(status),
    guestSessionId: "",
    targetSessionId: "",
    characterId: "",
    message: "",
    idempotent: false,
    ...extra,
  };
}

export function toPublicGuestClaim(guestClaim = null) {
  if (!guestClaim) return null;
  return {
    status: String(guestClaim.status || GUEST_CLAIM_STATUSES.NONE),
    claimed: guestClaim.claimed === true,
    characterId: String(guestClaim.characterId || ""),
    message: String(guestClaim.message || ""),
    idempotent: guestClaim.idempotent === true,
  };
}
