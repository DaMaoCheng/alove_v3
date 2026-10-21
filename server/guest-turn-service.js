import { applySessionLanguagePreference } from "./chat-language-preference-service.js";
import { prepareChatIntentTurn } from "./chat-intent-turn-service.js";
import { createHash } from "node:crypto";
import { createId } from "./security.js";
import { withTransaction } from "./db.js";
import { getNextMessageOrder, insertMessage, listRecentMessagesBeforeOrder } from "./chat-message-store.js";
import { buildAttachmentSummary } from "./chat-message-payload-utils.js";
import { createPublicError } from "./public-error-utils.js";
import { consumeGuestNetworkQuota } from "./guest-network-rate-limit-service.js";
import {
  listGuestAttachmentsForRequest,
  markGuestAttachmentAttached,
  resolveGuestAttachmentsForTurn,
} from "./guest-chat-attachment-service.js";
import { maybeCreateGuestChatImagePlaceholder } from "./chat-image-generation-service.js";
import { resolveGuestCurrentProductImageCardContext } from "./guest-chat-product-service.js";
import {
  guestSessionForImage,
  loadGuestCharacterForDb,
  requireGuestCharacterForDb,
} from "./guest-session-service.js";
import { resolveGuestMessageQuotaState } from "./guest-message-quota-policy.js";

// Internal command: callers must enter through sendGuestMessage so validation and the guest reply lock are held.
export async function persistGuestTurn({
  token,
  normalizedText,
  attachmentIds = [],
  requestKey,
  networkHash = "",
  sourceRef = "guest-input",
  networkQuotaReserved = false,
  reservedVoiceRequestKey = "",
  skipMessageQuota = false,
  skipRateQuota = false,
  callContext = null,
  characterId = "",
}) {
  return withTransaction(async (db) => {
    const guest = await requireGuestCharacterForDb(db, token, { characterId, lock: true });
    const [existing] = await db.execute(
      "SELECT id, text_content, display_order, content_type FROM chat_messages WHERE session_id = ? AND sender_type = 'user' AND client_message_id = ? LIMIT 1",
      [guest.chat_session_id, requestKey]
    );
    if (existing[0]) {
      const character = await loadGuestCharacterForDb(db, guest);
      const turnAttachments = await listGuestAttachmentsForRequest(db, { guestSessionId: guest.id, characterId: guest.mascot_character_id, requestKey });
      const turnText = await resolveStoredGuestTurnText(db, {
        guest,
        requestKey,
        primaryMessage: existing[0],
        attachments: turnAttachments,
      });
      const promptBeforeDisplayOrder = await resolveGuestTurnStartDisplayOrder(db, {
        guest,
        requestKey,
        primaryMessage: existing[0],
      });
      const currentProductImageContext = await resolveGuestCurrentProductImageCardContext(db, {
        guest,
        userText: turnText,
        recentMessages: await listRecentMessagesBeforeOrder(db, {
          sessionId: guest.chat_session_id,
          beforeDisplayOrder: promptBeforeDisplayOrder,
        }),
      });
      const intentTurn = await prepareChatIntentTurn(db, { session: guestSessionForImage(guest), character, siteId: guest.site_id, siteSlug: guest.site_slug, userText: turnText, userDisplayOrder: Number(existing[0].display_order || 0), commerceBeforeDisplayOrder: promptBeforeDisplayOrder, commerceForImageOnly: true });
      const languagePreference = await applySessionLanguagePreference(db, { character, session: guestSessionForImage(guest), userText: turnText, jevDecision: intentTurn.decision });
      const imageResult = await maybeCreateGuestChatImagePlaceholder(db, {
        guest,
        session: { ...guestSessionForImage(guest), replyLanguageCode: languagePreference.languageCode },
        character: languagePreference.character,
        userText: turnText,
        userMessage: { id: existing[0].id, displayOrder: Number(existing[0].display_order || 0) },
        requestKey,
        networkHash,
        skipImageGeneration: Boolean(currentProductImageContext),
        jevDecision: intentTurn.decision,
        conversationContext: intentTurn.conversationContext,
        commerceIntent: intentTurn.commerceSearchIntent,
        commerceSiteId: intentTurn.commerceSite?.id || "",
        imageDecision: intentTurn.imageDecision,
        recentMessages: intentTurn.recentMessages,
      });
      return {
        guest,
        message: existing[0],
        text: turnText,
        attachments: turnAttachments,
        duplicate: true,
        imageResult,
        intentTurn,
        languagePreference,
        promptBeforeDisplayOrder,
      };
    }

    const lockedCall = callContext ? await requireActiveGuestCallForDb(db, guest, callContext) : null;
    const resolvedAttachments = await resolveGuestAttachmentsForTurn(db, { guest, attachmentIds, lock: true });
    if (!networkQuotaReserved) {
      await consumeGuestNetworkQuota(db, { networkHash, siteId: guest.site_id, action: "message" });
    }
    if (!skipMessageQuota) {
      await consumeGuestMessageQuota(db, guest, {
        excludeVoiceRequestKey: reservedVoiceRequestKey,
        skipRateQuota,
      });
    }

    const order = await getNextMessageOrder(db, guest.chat_session_id);
    const turnSourceRef = resolvedAttachments.length ? buildGuestTurnSourceRef(requestKey) : sourceRef;
    const userMessages = [];
    let nextOrder = order;
    if (normalizedText) {
      userMessages.push(await insertGuestMessage(db, {
        guest,
        text: normalizedText,
        requestKey: "",
        displayOrder: nextOrder,
        sourceRef: turnSourceRef,
      }));
      nextOrder += 10;
    }
    for (const item of resolvedAttachments) {
      const message = await insertMessage(db, {
        sessionId: guest.chat_session_id,
        guestSessionId: guest.id,
        characterId: guest.mascot_character_id,
        senderType: "user",
        senderLabel: "You",
        contentType: "attachment",
        text: buildAttachmentSummary(item.attachment),
        product: item.attachment,
        displayOrder: nextOrder,
        sourceType: "guest",
        sourceRef: "guest-attachment",
      });
      userMessages.push(message);
      await markGuestAttachmentAttached(db, {
        id: item.id,
        guestSessionId: guest.id,
        characterId: guest.mascot_character_id,
        requestKey,
        messageId: message.id,
      });
      nextOrder += 10;
    }
    const message = userMessages[userMessages.length - 1];
    await db.execute("UPDATE chat_messages SET client_message_id = ? WHERE id = ?", [requestKey, message.id]);
    const turnAttachments = resolvedAttachments.map((item) => item.attachment);
    const turnText = buildGuestTurnText(normalizedText, turnAttachments);
    const character = await loadGuestCharacterForDb(db, guest);
    const currentProductImageContext = await resolveGuestCurrentProductImageCardContext(db, {
      guest,
      userText: turnText,
      recentMessages: await listRecentMessagesBeforeOrder(db, {
        sessionId: guest.chat_session_id,
        beforeDisplayOrder: order,
      }),
    });
    const intentTurn = await prepareChatIntentTurn(db, { session: guestSessionForImage(guest), character, siteId: guest.site_id, siteSlug: guest.site_slug, userText: turnText, userDisplayOrder: Number(message.displayOrder || order), commerceBeforeDisplayOrder: order, commerceForImageOnly: true });
    const languagePreference = await applySessionLanguagePreference(db, { character, session: guestSessionForImage(guest), userText: turnText, jevDecision: intentTurn.decision });
    const imageResult = await maybeCreateGuestChatImagePlaceholder(db, {
      guest,
      session: { ...guestSessionForImage(guest), replyLanguageCode: languagePreference.languageCode },
      character: languagePreference.character,
      userText: turnText,
      userMessage: message,
      requestKey,
      networkHash,
      skipImageGeneration: Boolean(currentProductImageContext),
      jevDecision: intentTurn.decision,
      conversationContext: intentTurn.conversationContext,
        commerceIntent: intentTurn.commerceSearchIntent,
        commerceSiteId: intentTurn.commerceSite?.id || "",
        imageDecision: intentTurn.imageDecision,
        recentMessages: intentTurn.recentMessages,
    });
    if (reservedVoiceRequestKey) {
      await db.execute(
        `UPDATE guest_voice_requests SET request_status = 'consumed', updated_at = NOW(3)
         WHERE guest_session_id = ? AND request_key = ? AND request_status IN ('transcribed', 'consumed')`,
        [guest.id, String(reservedVoiceRequestKey).trim().slice(0, 128)]
      );
    }
    await db.execute(
      "UPDATE chat_sessions SET last_message_at = NOW(3), updated_at = NOW(3) WHERE id = ?",
      [guest.chat_session_id]
    );
    if (lockedCall) {
      await db.execute(
        "UPDATE guest_call_sessions SET turn_count = turn_count + 1, pending_input_milliseconds = 0, pending_input_epoch = pending_input_epoch + 1, updated_at = NOW(3) WHERE id = ?",
        [lockedCall.id]
      );
    }
    return {
      guest,
      message,
      text: turnText,
      attachments: turnAttachments,
      duplicate: false,
      imageResult,
      intentTurn,
      languagePreference,
      promptBeforeDisplayOrder: order,
    };
  });
}

export async function resolveGuestTurnStartDisplayOrder(db, {
  guest,
  requestKey,
  primaryMessage,
}) {
  const fallbackOrder = Number(primaryMessage?.display_order || primaryMessage?.displayOrder || 0);
  const normalizedRequestKey = String(requestKey || "").trim();
  if (!normalizedRequestKey) return fallbackOrder;
  const [[attachmentState]] = await db.execute(
    `SELECT EXISTS(
       SELECT 1 FROM guest_chat_attachments
       WHERE guest_session_id = ? AND request_key = ?
     ) AS has_attachments`,
    [guest.id, normalizedRequestKey]
  );
  if (!Number(attachmentState?.has_attachments || 0)) {
    const [messageRows] = await db.execute(
      `SELECT MIN(display_order) AS first_display_order
       FROM chat_messages
       WHERE session_id = ? AND guest_session_id = ? AND sender_type = 'user' AND client_message_id = ?`,
      [guest.chat_session_id, guest.id, normalizedRequestKey]
    );
    return Number(messageRows[0]?.first_display_order || fallbackOrder);
  }
  const turnSourceRef = buildGuestTurnSourceRef(normalizedRequestKey);
  const legacyTurnSourceRef = buildLegacyGuestTurnSourceRef(normalizedRequestKey);
  const [hashedRows] = await db.execute(
    `SELECT MIN(display_order) AS first_display_order
     FROM chat_messages
     WHERE session_id = ? AND guest_session_id = ? AND sender_type = 'user' AND source_ref = ?`,
    [guest.chat_session_id, guest.id, turnSourceRef]
  );
  const selectedTurnSourceRef = Number(hashedRows[0]?.first_display_order || 0)
    ? turnSourceRef
    : legacyTurnSourceRef;
  const [rows] = await db.execute(
    `SELECT MIN(m.display_order) AS first_display_order
     FROM chat_messages m
     LEFT JOIN guest_chat_attachments a
       ON a.message_id = m.id AND a.guest_session_id = ? AND a.request_key = ?
     WHERE m.session_id = ? AND m.guest_session_id = ? AND m.sender_type = 'user'
       AND (m.client_message_id = ? OR m.source_ref = ? OR a.id IS NOT NULL)`,
    [guest.id, normalizedRequestKey, guest.chat_session_id, guest.id, normalizedRequestKey, selectedTurnSourceRef]
  );
  return Number(rows[0]?.first_display_order || fallbackOrder);
}

async function consumeGuestMessageQuota(db, guest, {
  excludeVoiceRequestKey = "",
  skipRateQuota = false,
} = {}) {
  const normalizedVoiceRequestKey = String(excludeVoiceRequestKey || "").trim();
  const [[reserved]] = await db.execute(
    `SELECT COUNT(*) AS count FROM guest_voice_requests
     WHERE guest_session_id = ? AND request_status IN ('processing', 'transcribed')
       AND (? = '' OR request_key <> ?)`,
    [guest.id, normalizedVoiceRequestKey, normalizedVoiceRequestKey]
  );
  const reservedCount = Number(reserved?.count || 0);
  const quota = resolveGuestMessageQuotaState(guest, { reservedCount, skipRateQuota });
  if (quota.messageLimitReached) {
    const error = createPublicError("Please sign in to continue chatting.", 429);
    error.code = "GUEST_MESSAGE_LIMIT_REACHED";
    throw error;
  }
  if (quota.rateLimitReached) {
    throw createPublicError("Please wait a moment before sending more messages.", 429);
  }
  await db.execute(
    `UPDATE guest_character_sessions
     SET message_window_started_at = ?, message_window_count = ?, rate_window_started_at = ?, rate_window_count = ?
     WHERE guest_session_id = ? AND character_id = ?`,
    [...quota.updateValues.slice(0, 4), guest.id, guest.mascot_character_id]
  );
}

async function requireActiveGuestCallForDb(db, guest, callContext = {}) {
  const callSessionId = String(callContext.callSessionId || "").trim();
  const leaseToken = String(callContext.leaseToken || "").trim();
  if (!callSessionId || !leaseToken || String(guest.active_call_id || "") !== callSessionId) {
    throw createPublicError("Guest call is unavailable.", 409);
  }
  const [rows] = await db.execute(
    `SELECT id FROM guest_call_sessions
     WHERE id = ? AND guest_session_id = ? AND lease_token = ? AND call_status = 'active'
     LIMIT 1 FOR UPDATE`,
    [callSessionId, guest.id, leaseToken]
  );
  if (!rows[0]) throw createPublicError("Guest call is unavailable.", 409);
  return rows[0];
}

async function insertGuestMessage(db, {
  guest,
  text,
  requestKey,
  displayOrder,
  sourceRef = "guest-input",
}) {
  const id = createId("msg");
  await db.execute(
    `INSERT INTO chat_messages (id, client_message_id, session_id, guest_session_id, character_id, sender_type, sender_label, content_type, text_content, display_order, delivery_status, source_type, source_ref, sent_at)
     VALUES (?, ?, ?, ?, ?, 'user', 'You', 'text', ?, ?, 'sent', 'guest', ?, NOW(3))`,
    [
      id,
      String(requestKey || "").trim() || null,
      guest.chat_session_id,
      guest.id,
      guest.mascot_character_id,
      text,
      displayOrder,
      String(sourceRef || "guest-input").trim().slice(0, 128),
    ]
  );
  return { id, displayOrder };
}

export async function resolveStoredGuestTurnText(db, {
  guest,
  requestKey,
  primaryMessage,
  attachments = [],
}) {
  let text = primaryMessage?.content_type === "text" ? String(primaryMessage.text_content || "").trim() : "";
  const normalizedRequestKey = String(requestKey || "").trim();
  if (!text && normalizedRequestKey) {
    const turnSourceRef = buildGuestTurnSourceRef(normalizedRequestKey);
    const legacyTurnSourceRef = buildLegacyGuestTurnSourceRef(normalizedRequestKey);
    const [rows] = await db.execute(
      `SELECT text_content FROM chat_messages
       WHERE session_id = ? AND guest_session_id = ? AND sender_type = 'user'
         AND content_type = 'text' AND source_ref = ?
       ORDER BY display_order ASC LIMIT 1`,
      [guest.chat_session_id, guest.id, turnSourceRef]
    );
    text = String(rows[0]?.text_content || "").trim();
    if (!text) {
      const [legacyRows] = await db.execute(
        `SELECT text_content FROM chat_messages
         WHERE session_id = ? AND guest_session_id = ? AND sender_type = 'user'
           AND content_type = 'text' AND source_ref = ?
         ORDER BY display_order ASC LIMIT 1`,
        [guest.chat_session_id, guest.id, legacyTurnSourceRef]
      );
      text = String(legacyRows[0]?.text_content || "").trim();
    }
  }
  return buildGuestTurnText(text, attachments);
}

export function buildGuestTurnSourceRef(requestKey) {
  const normalizedRequestKey = String(requestKey || "").trim();
  if (!normalizedRequestKey) return "guest-input";
  const requestHash = createHash("sha256").update(normalizedRequestKey).digest("hex");
  return `guest-input:${requestHash}`;
}

function buildLegacyGuestTurnSourceRef(requestKey) {
  return `guest-input:${String(requestKey || "").trim()}`.slice(0, 128);
}

function buildGuestTurnText(text = "", attachments = []) {
  const lines = [
    String(text || "").trim(),
    ...(Array.isArray(attachments) ? attachments.map((attachment) => buildAttachmentSummary(attachment)) : []),
  ].filter(Boolean);
  if (!lines.length) throw createPublicError("Guest message is empty.", 400);
  return lines.join("\n");
}
