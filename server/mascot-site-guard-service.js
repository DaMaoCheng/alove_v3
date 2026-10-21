import { activateRegistrationMascotForDb } from "./mascot-activation-service.js";
import { enqueueSummaryRefreshJobs } from "./chat-context-jobs-service.js";
import { indexChatMessage } from "./chat-message-index-service.js";
import { getNextMessageOrder } from "./chat-message-store.js";
import { mapSessionRow } from "./chat-session-service.js";
import { createId } from "./security.js";

export const STALE_MASCOT_NOTICE_TEXT = "Your account site assignment has changed. This character is no longer available. Please refresh the page to reconnect.";

export async function syncMascotActivationForSiteChange(db, { userId, nextSiteId } = {}) {
  const normalizedUserId = String(userId || "").trim();
  if (!normalizedUserId) {
    return { ok: false, deactivatedCount: 0, activated: false, characterId: "" };
  }

  const [currentMascotRows] = await db.execute(
    `SELECT a.id, a.character_id
     FROM user_character_activations a
     INNER JOIN ai_characters c ON c.id = a.character_id
     WHERE a.internal_uid = ?
       AND a.activation_status = 'active'
       AND c.category_id = 'mascot'
     FOR UPDATE`,
    [normalizedUserId]
  );

  let deactivatedCount = 0;
  if (currentMascotRows.length) {
    const activationIds = currentMascotRows.map((row) => String(row.id || "").trim()).filter(Boolean);
    if (activationIds.length) {
      const placeholders = activationIds.map(() => "?").join(", ");
      const [result] = await db.execute(
        `UPDATE user_character_activations
         SET activation_status = 'inactive', updated_at = NOW(3)
         WHERE id IN (${placeholders})`,
        activationIds
      );
      deactivatedCount = Number(result.affectedRows || 0);
    }
  }

  const activation = await activateRegistrationMascotForDb(db, {
    userId: normalizedUserId,
    siteId: String(nextSiteId || "").trim(),
  });

  return {
    ok: true,
    deactivatedCount,
    activated: Boolean(activation.activated),
    alreadyActivated: Boolean(activation.alreadyActivated),
    characterId: activation.characterId || "",
  };
}

export async function resolveStaleMascotGuard(db, { userId, characterId } = {}) {
  const normalizedUserId = String(userId || "").trim();
  const normalizedCharacterId = String(characterId || "").trim();
  if (!normalizedUserId || !normalizedCharacterId) {
    return { stale: false, reason: "invalid_input" };
  }

  const [rows] = await db.execute(
    `SELECT
       c.id,
       c.category_id,
       c.site_id AS character_site_id,
       u.site_id AS user_site_id,
       a.activation_status,
       COALESCE(ms.character_id, s.mascot_character_id) AS expected_mascot_character_id
     FROM ai_characters c
     INNER JOIN users u ON u.id = ?
     LEFT JOIN user_character_activations a ON a.internal_uid = u.id AND a.character_id = c.id
     LEFT JOIN sites s ON s.id = u.site_id AND s.site_status = 'active'
     LEFT JOIN mascot_settings ms ON ms.site_id = s.id AND ms.setting_status = 'active'
     WHERE c.id = ?
     LIMIT 1`,
    [normalizedUserId, normalizedCharacterId]
  );

  const row = rows[0] || null;
  if (!row) return { stale: false, reason: "character_not_found" };
  if (String(row.category_id || "") !== "mascot") return { stale: false, reason: "not_mascot" };

  const activationStatus = String(row.activation_status || "").trim().toLowerCase();
  const userSiteId = String(row.user_site_id || "").trim();
  const characterSiteId = String(row.character_site_id || "").trim();
  const expectedMascotCharacterId = String(row.expected_mascot_character_id || "").trim();
  const fallbackExpectedCharacterId = expectedMascotCharacterId || "mascot_template";

  if (activationStatus !== "active") {
    return {
      stale: true,
      reason: "inactive_activation",
      expectedCharacterId: fallbackExpectedCharacterId,
      userSiteId,
      characterSiteId,
    };
  }

  if (expectedMascotCharacterId && expectedMascotCharacterId !== normalizedCharacterId) {
    return {
      stale: true,
      reason: "site_mascot_mismatch",
      expectedCharacterId: expectedMascotCharacterId,
      userSiteId,
      characterSiteId,
    };
  }

  if (characterSiteId && userSiteId && characterSiteId !== userSiteId) {
    return {
      stale: true,
      reason: "character_site_mismatch",
      expectedCharacterId: fallbackExpectedCharacterId,
      userSiteId,
      characterSiteId,
    };
  }

  return {
    stale: false,
    reason: "ok",
    expectedCharacterId: fallbackExpectedCharacterId,
    userSiteId,
    characterSiteId,
  };
}

export async function insertStaleMascotSystemReply(db, {
  sessionId,
  characterId,
  characterName,
  displayOrder,
  sourceRef = "site-assignment-changed",
} = {}) {
  const messageId = createId("msg");
  await db.execute(
    `INSERT INTO chat_messages (
       id, session_id, character_id, sender_type, sender_label, content_type, text_content,
       product_payload_json, display_order, delivery_status, source_type, source_ref, sent_at
     ) VALUES (?, ?, ?, 'character', ?, 'text', ?, NULL, ?, 'sent', 'system', ?, NOW(3))`,
    [
      messageId,
      sessionId,
      characterId,
      String(characterName || "AIOVE").trim() || "AIOVE",
      STALE_MASCOT_NOTICE_TEXT,
      displayOrder,
      sourceRef,
    ]
  );

  return {
    id: messageId,
    sessionId,
    characterId,
    senderType: "character",
    senderLabel: String(characterName || "AIOVE").trim() || "AIOVE",
    contentType: "text",
    text: STALE_MASCOT_NOTICE_TEXT,
    displayOrder,
    deliveryStatus: "sent",
    sentAt: new Date(),
    voice: null,
  };
}

export async function completeStaleMascotReply(db, {
  session,
  character,
  userId,
  characterId,
} = {}) {
  const nextOrder = await getNextMessageOrder(db, session.id);
  const staleReply = await insertStaleMascotSystemReply(db, {
    sessionId: session.id,
    characterId,
    characterName: character.name,
    displayOrder: nextOrder,
  });
  await indexChatMessage(db, { message: staleReply, session, userId, characterId });
  await enqueueSummaryRefreshJobs(db, { userId, characterId, sessionId: session.id });
  await db.execute("UPDATE chat_sessions SET last_message_at = NOW(3), updated_at = NOW(3) WHERE id = ?", [session.id]);
  await db.commit();
  return {
    ok: true,
    session: mapSessionRow({ ...session, last_message_at: new Date() }),
    items: [staleReply],
  };
}
