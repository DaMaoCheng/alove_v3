import { prepareChatIntentTurn } from "./chat-intent-turn-service.js";
import { applySessionLanguagePreference } from "./chat-language-preference-service.js";
import { indexChatMessage } from "./chat-memory-service.js";
import { getDbPool } from "./db.js";
import { buildCharacterReplyGenerationForDb, persistCharacterReplyForDb } from "./chat-reply-orchestrator-service.js";
import { findRelevantHistoryImageAttachments } from "./chat-history-image-retrieval-service.js";
import { collectVisionInputsForAttachments, collectVisionInputsForMessages } from "./chat-vision-input-service.js";
import { maybeCreateChatImagePlaceholder, resolveChatImageReplyDirective } from "./chat-image-generation-service.js";
import { resolveCurrentProductImageCardContext } from "./chat-product-recommendation-service.js";
import { isProductImageCardRequest } from "./product-intent-service.js";
import { ensureOpeningMessageWithVoiceForSession } from "./chat-opening-message-service.js";
import { completeStaleMascotReply, resolveStaleMascotGuard } from "./mascot-site-guard-service.js";
import { resolveReplyVoiceModel } from "./chat-reply-voice-service.js";
import { createPublicError } from "./public-error-utils.js";
import {
  USER_SESSION_SOURCE_TYPE,
  buildAttachmentSummary,
  buildPendingUserText,
  enqueueSummaryRefreshJobs,
  enqueueUserMemoryExtractionJob,
  findCharacterById,
  findLatestUserSessionForDb,
  findOrCreateUserSession,
  getNextMessageOrder,
  insertMessage,
  listRecentMessagesBeforeOrder,
  listUserTextMessagesSince,
  mapSessionRow,
  normalizeAttachmentPayload,
  normalizeMessageText,
  throwNotFound,
} from "./chat-service-shared.js";

export { resolveReplyVoiceModel, VOICE_MODEL_MODE_REALTIME_CALL_FAST } from "./chat-reply-voice-service.js";

export async function createUserMessage({ characterId, userId, text, attachments = [] }) {
  const normalizedCharacterId = String(characterId || "").trim();
  const normalizedUserId = String(userId || "").trim();
  const hasText = String(text || "").trim().length > 0;
  const normalizedText = hasText ? normalizeMessageText(text) : "";
  const normalizedAttachments = normalizeUserAttachments(attachments);
  if (!normalizedText && !normalizedAttachments.length) {
    throw createPublicError("请输入消息内容", 400);
  }
  if (!normalizedCharacterId) throwNotFound();
  if (!normalizedUserId) {
    const error = new Error("请先登录");
    error.statusCode = 401;
    throw error;
  }

  return getDbPool().getConnection().then(async (db) => {
    try {
      await db.beginTransaction();
      const character = await findCharacterById(db, normalizedCharacterId, { userId: normalizedUserId });

      if (!character) throwNotFound();

      const session = await findOrCreateUserSession(db, {
        character,
        userId: normalizedUserId,
      });
      await ensureOpeningMessageWithVoiceForSession(db, {
        sessionId: session.id,
        character,
        characterId: normalizedCharacterId,
        senderLabel: character.name,
        openingLine: character.opening_line || character.openingLine || "",
        userId: normalizedUserId,
        preferredLanguage: session.preferred_language,
      });
      const nextOrder = await getNextMessageOrder(db, session.id);
      const userMessages = [];
      let displayOrder = nextOrder;
      if (normalizedText) {
        userMessages.push(await insertMessage(db, {
          sessionId: session.id,
          characterId: null,
          senderType: "user",
          senderLabel: "You",
          contentType: "text",
          text: normalizedText,
          displayOrder,
          sourceType: USER_SESSION_SOURCE_TYPE,
          sourceRef: "user-input",
        }));
        displayOrder += 10;
      }
      for (const attachment of normalizedAttachments) {
        userMessages.push(await insertMessage(db, {
          sessionId: session.id,
          characterId: null,
          senderType: "user",
          senderLabel: "You",
          contentType: "attachment",
          text: buildAttachmentSummary(attachment),
          product: attachment,
          displayOrder,
          sourceType: USER_SESSION_SOURCE_TYPE,
          sourceRef: "user-attachment",
        }));
        displayOrder += 10;
      }
      const triggerText = buildUserTextWithAttachments(normalizedText, normalizedAttachments);
      const lastUserMessage = userMessages[userMessages.length - 1];
      const currentProductImageContext = isProductImageCardRequest(triggerText)
        ? await resolveCurrentProductImageCardContext(db, {
            character,
            userId: normalizedUserId,
            userText: triggerText,
            recentMessages: await listRecentMessagesBeforeOrder(db, {
              sessionId: session.id,
              beforeDisplayOrder: nextOrder,
            }),
          })
        : null;
      const intentTurn = await prepareChatIntentTurn(db, { session, character, userId: normalizedUserId, userText: triggerText, userDisplayOrder: Number(lastUserMessage?.displayOrder || nextOrder), commerceBeforeDisplayOrder: nextOrder, commerceForImageOnly: true });
      const imageLanguage = await applySessionLanguagePreference(db, { character, session, userId: normalizedUserId, userText: triggerText, jevDecision: intentTurn.decision });
      const imagePlaceholder = await maybeCreateChatImagePlaceholder(db, {
        session: { ...session, replyLanguageCode: imageLanguage.languageCode },
        character: imageLanguage.character,
        userId: normalizedUserId,
        userText: triggerText,
        userMessage: lastUserMessage,
        skipImageGeneration: Boolean(currentProductImageContext),
        jevDecision: intentTurn.decision,
        conversationContext: intentTurn.conversationContext,
        commerceIntent: intentTurn.commerceSearchIntent,
        commerceSiteId: intentTurn.commerceSite?.id || "",
        imageDecision: intentTurn.imageDecision,
        recentMessages: intentTurn.recentMessages,
      });

      for (const message of userMessages) {
        await indexChatMessage(db, {
          message,
          session,
          userId: normalizedUserId,
          characterId: normalizedCharacterId,
        });
        await enqueueUserMemoryExtractionJob(db, {
          messageId: message.id,
          userId: normalizedUserId,
          characterId: normalizedCharacterId,
          sessionId: session.id,
        });
      }
      await enqueueSummaryRefreshJobs(db, {
        userId: normalizedUserId,
        characterId: normalizedCharacterId,
        sessionId: session.id,
      });

      await db.execute(
        "UPDATE chat_sessions SET last_message_at = NOW(3), updated_at = NOW(3) WHERE id = ?",
        [session.id]
      );
      await db.commit();

      return {
        ok: true,
        session: mapSessionRow({
          ...session,
          last_message_at: new Date(),
        }),
        items: [...userMessages, imagePlaceholder].filter(Boolean),
      };
    } catch (error) {
      await db.rollback();
      throw error;
    } finally {
      db.release();
    }
  });
}

export async function createUserReply({ characterId, userId, sinceMessageId, voiceModelMode = "", productTrigger = "", siteSlug = "" }) {
  const normalizedCharacterId = String(characterId || "").trim();
  const normalizedUserId = String(userId || "").trim();
  const normalizedSinceMessageId = String(sinceMessageId || "").trim();
  if (!normalizedCharacterId || !normalizedSinceMessageId) throwNotFound();
  if (!normalizedUserId) {
    const error = new Error("请先登录");
    error.statusCode = 401;
    throw error;
  }

  return getDbPool().getConnection().then(async (db) => {
    try {
      await db.beginTransaction();
      const character = await findCharacterById(db, normalizedCharacterId, { userId: normalizedUserId });
      if (!character) throwNotFound();

      const session = await findLatestUserSessionForDb(db, {
        characterId: normalizedCharacterId,
        userId: normalizedUserId,
      });
      if (!session) throwNotFound();

      const pendingUserMessages = await listUserTextMessagesSince(db, {
        sessionId: session.id,
        sinceMessageId: normalizedSinceMessageId,
      });
      const currentUserText = buildPendingUserText(pendingUserMessages);
      const staleMascotGuard = await resolveStaleMascotGuard(db, {
        userId: normalizedUserId,
        characterId: normalizedCharacterId,
      });
      if (staleMascotGuard.stale) {
        return await completeStaleMascotReply(db, {
          session,
          character,
          userId: normalizedUserId,
          characterId: normalizedCharacterId,
        });
      }
      let languagePreference = await applySessionLanguagePreference(db, {
        character,
        session,
        userId: normalizedUserId,
        userText: currentUserText, resolveOnly: true,
      });
      let promptCharacter = languagePreference.character;


      const firstUserDisplayOrder = Number(pendingUserMessages[0]?.display_order || 0);
      const lastUserDisplayOrder = Number(pendingUserMessages[pendingUserMessages.length - 1]?.display_order || firstUserDisplayOrder);
      const recentMessages = await listRecentMessagesBeforeOrder(db, {
        sessionId: session.id,
        beforeDisplayOrder: firstUserDisplayOrder,
      });
      const currentProductImageContext = await resolveCurrentProductImageCardContext(db, {
        character: promptCharacter,
        userId: normalizedUserId,
        userText: currentUserText,
        recentMessages,
      });
      const intentTurn = await prepareChatIntentTurn(db, { session, character: promptCharacter, userId: normalizedUserId, userText: currentUserText, userDisplayOrder: lastUserDisplayOrder, recentMessages, productTrigger });
      languagePreference = await applySessionLanguagePreference(db, { character, session, userId: normalizedUserId, userText: currentUserText, jevDecision: intentTurn.decision });
      promptCharacter = languagePreference.character;
      const voiceModelDecision = resolveReplyVoiceModel({
        mode: voiceModelMode,
        languageCode: languagePreference.languageCode,
        languageLabel: languagePreference.languageLabel || languagePreference.language,
      });
      const chatImageContext = currentProductImageContext ? null : await resolveChatImageReplyDirective(db, {
        session,
        character: promptCharacter,
        userId: normalizedUserId,
        userText: currentUserText,
        userDisplayOrder: lastUserDisplayOrder,
        jevDecision: intentTurn.decision,
        conversationContext: intentTurn.conversationContext,
        commerceIntent: intentTurn.commerceSearchIntent,
        commerceSiteId: intentTurn.commerceSite?.id || "",
        imageDecision: intentTurn.imageDecision,
        recentMessages: intentTurn.recentMessages,
        cacheKey: pendingUserMessages[pendingUserMessages.length - 1]?.id || normalizedSinceMessageId,
      });
      const currentVisionInputs = await collectVisionInputsForMessages(pendingUserMessages);
      const historyImageMatches = currentVisionInputs.length >= 3 ? [] : await findRelevantHistoryImageAttachments(db, {
        userId: normalizedUserId,
        characterId: normalizedCharacterId,
        sessionId: session.id,
        queryText: currentUserText,
        excludeMessageIds: pendingUserMessages.map((message) => message.id),
        limit: 3 - currentVisionInputs.length,
      });
      const historyVisionInputs = historyImageMatches.length
        ? await collectVisionInputsForAttachments(historyImageMatches.map((item) => item.attachment))
        : [];
      const visionInputs = mergeVisionInputs(currentVisionInputs, historyVisionInputs);
      const [[siteRow]] = character.site_id ? await db.execute("SELECT slug FROM sites WHERE id = ? LIMIT 1", [character.site_id]) : [[]];
      const { productContext, replyResult, feedbackAction, orderAction } = await buildCharacterReplyGenerationForDb(db, {
        promptCharacter,
        session,
        userId: normalizedUserId,
        characterId: normalizedCharacterId,
        userText: currentUserText,
        recentMessages,
        productTrigger,
        productContextOverride: currentProductImageContext,
        intentTurn,
        orderLookupSiteSlug: siteSlug || siteRow?.slug || "",
        chatImageContext,
        userDisplayOrder: lastUserDisplayOrder,
        visionInputs,
        logContext: {
          requestId: pendingUserMessages.at(-1)?.id,
          userId: normalizedUserId,
          sessionId: session.id,
          characterId: normalizedCharacterId,
          languagePreference: languagePreference.language,
          languageCode: languagePreference.languageCode,
          languageLabel: languagePreference.languageLabel,
          voiceProvider: character.voice_provider || character.voiceProvider || "",
          voiceModel: voiceModelDecision.model,
          voiceId: character.voice_id || character.voiceId || "",
        },
        voiceMetaFallback: {
          mode: voiceModelMode,
          fallbackLanguageCode: languagePreference.languageCode,
          fallbackLanguageLabel: languagePreference.languageLabel || languagePreference.language,
        },
      });
      const response = await persistCharacterReplyForDb(db, {
        character,
        session,
        userId: normalizedUserId,
        characterId: normalizedCharacterId,
        userText: currentUserText,
        productContext,
        replyResult,
        feedbackAction,
        replyTriggerMessageId: pendingUserMessages[pendingUserMessages.length - 1]?.id || normalizedSinceMessageId,
        replyVoicePayloadBuilder(replyVoice) {
          return {
            id: replyVoice.id,
            durationSeconds: replyVoice.durationSeconds,
            audioUrl: replyVoice.audioUrl,
            assetStatus: replyVoice.assetStatus,
            model: replyVoice.model,
            languageCode: replyVoice.languageCode,
            languageLabel: replyVoice.languageLabel,
            modelReason: resolveReplyVoiceModel({
              mode: voiceModelMode,
              languageCode: replyVoice.languageCode,
              languageLabel: replyVoice.languageLabel,
            }).reason,
          };
        },
      });
      if (orderAction) {
        const sourceRef = `user-order-action:${pendingUserMessages[pendingUserMessages.length - 1]?.id || normalizedSinceMessageId}`;
        const [existingAction] = await db.execute("SELECT id FROM chat_messages WHERE session_id = ? AND source_ref = ? LIMIT 1", [session.id, sourceRef]);
        if (!existingAction[0]) {
          const actionMessage = await insertMessage(db, {
            sessionId: session.id,
            characterId: character.id,
            senderType: "character",
            senderLabel: character.name,
            contentType: "order_action",
            text: "Please bind your TTMall account to check an order.",
            product: orderAction,
            displayOrder: Number(response?.items?.at(-1)?.displayOrder || lastUserDisplayOrder) + 10,
            sourceType: "system",
            sourceRef,
          });
          response.items.push(actionMessage);
        }
      }
      await db.commit();
      return response;
    } catch (error) {
      await db.rollback();
      throw error;
    } finally {
      db.release();
    }
  });
}

function normalizeUserAttachments(attachments = []) {
  if (!Array.isArray(attachments)) return [];
  return attachments
    .slice(0, 5)
    .map((attachment) => normalizeAttachmentPayload(attachment));
}

function mergeVisionInputs(...groups) {
  const seen = new Set();
  const merged = [];
  for (const input of groups.flat()) {
    const key = input?.dataUrl || "";
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(input);
    if (merged.length >= 3) break;
  }
  return merged;
}

function buildUserTextWithAttachments(text = "", attachments = []) {
  const lines = [
    String(text || "").trim(),
    ...attachments.map((attachment) => buildAttachmentSummary(attachment)),
  ].filter(Boolean);
  return lines.join("\n");
}
