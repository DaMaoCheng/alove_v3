import { prepareChatIntentTurn } from "./chat-intent-turn-service.js";
import { applySessionLanguagePreference } from "./chat-language-preference-service.js";
import { resolveReplyVoiceModel } from "./chat-reply-voice-service.js";
import { indexChatMessage } from "./chat-memory-service.js";
import { getDbPool } from "./db.js";
import { buildCharacterReplyGenerationForDb, persistCharacterReplyForDb } from "./chat-reply-orchestrator-service.js";
import { maybeCreateChatImagePlaceholder, resolveChatImageReplyDirective } from "./chat-image-generation-service.js";
import { resolveCurrentProductImageCardContext } from "./chat-product-recommendation-service.js";
import { isProductImageCardRequest } from "./product-intent-service.js";
import { completeStaleMascotReply, resolveStaleMascotGuard } from "./mascot-site-guard-service.js";
import {
  USER_SESSION_SOURCE_TYPE,
  enqueueSummaryRefreshJobs,
  enqueueUserMemoryExtractionJob,
  findCharacterById,
  findLatestUserSessionForDb,
  findOrCreateUserSession,
  findUserVoiceMessageForReply,
  getNextMessageOrder,
  insertMessage,
  listRecentMessagesBeforeOrder,
  mapSessionRow,
  normalizeVoiceTranscriptText,
  throwNotFound,
} from "./chat-service-shared.js";

export async function createUserVoiceMessage({ characterId, userId, transcriptText = "", asr = null }) {
  const normalizedCharacterId = String(characterId || "").trim();
  const normalizedUserId = String(userId || "").trim();
  const promptText = normalizeVoiceTranscriptText(transcriptText);
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
      const nextOrder = await getNextMessageOrder(db, session.id);
      const userMessage = await insertMessage(db, {
        sessionId: session.id,
        characterId: null,
        senderType: "user",
        senderLabel: "You",
        contentType: "text",
        text: promptText,
        displayOrder: nextOrder,
        sourceType: USER_SESSION_SOURCE_TYPE,
        sourceRef: "voice-asr",
      });
      userMessage.asr = asr;
      const currentProductImageContext = isProductImageCardRequest(promptText)
        ? await resolveCurrentProductImageCardContext(db, {
            character,
            userId: normalizedUserId,
            userText: promptText,
            recentMessages: await listRecentMessagesBeforeOrder(db, {
              sessionId: session.id,
              beforeDisplayOrder: nextOrder,
            }),
          })
        : null;
      const intentTurn = await prepareChatIntentTurn(db, { session, character, userId: normalizedUserId, userText: promptText, userDisplayOrder: nextOrder, logContext: { requestId: userMessage?.id }, commerceForImageOnly: true });
      const imageLanguage = await applySessionLanguagePreference(db, { character, session, userId: normalizedUserId, userText: promptText, jevDecision: intentTurn.decision });
      const imagePlaceholder = await maybeCreateChatImagePlaceholder(db, {
        session: { ...session, replyLanguageCode: imageLanguage.languageCode },
        character: imageLanguage.character,
        userId: normalizedUserId,
        userText: promptText,
        userMessage,
        skipImageGeneration: Boolean(currentProductImageContext),
        jevDecision: intentTurn.decision,
        conversationContext: intentTurn.conversationContext,
        commerceIntent: intentTurn.commerceSearchIntent,
        commerceSiteId: intentTurn.commerceSite?.id || "",
        imageDecision: intentTurn.imageDecision,
        recentMessages: intentTurn.recentMessages,
      });

      await indexChatMessage(db, {
        message: userMessage,
        session,
        userId: normalizedUserId,
        characterId: normalizedCharacterId,
      });
      await enqueueUserMemoryExtractionJob(db, {
        messageId: userMessage.id,
        userId: normalizedUserId,
        characterId: normalizedCharacterId,
        sessionId: session.id,
      });
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
        items: [userMessage, imagePlaceholder].filter(Boolean),
      };
    } catch (error) {
      await db.rollback();
      throw error;
    } finally {
      db.release();
    }
  });
}

export async function createUserVoiceReply({ characterId, userId, messageId }) {
  const normalizedCharacterId = String(characterId || "").trim();
  const normalizedUserId = String(userId || "").trim();
  const normalizedMessageId = String(messageId || "").trim();
  if (!normalizedCharacterId || !normalizedMessageId) throwNotFound();
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

      const userMessage = await findUserVoiceMessageForReply(db, {
        sessionId: session.id,
        messageId: normalizedMessageId,
      });
      const promptText = normalizeVoiceTranscriptText(userMessage?.text_content || "");
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
        userText: promptText, resolveOnly: true,
      });
      let promptCharacter = languagePreference.character;

      const recentMessages = await listRecentMessagesBeforeOrder(db, {
        sessionId: session.id,
        beforeDisplayOrder: Number(userMessage?.display_order || 0),
      });
      const currentProductImageContext = await resolveCurrentProductImageCardContext(db, {
        character: promptCharacter,
        userId: normalizedUserId,
        userText: promptText,
        recentMessages,
      });
      const intentTurn = await prepareChatIntentTurn(db, { session, character: promptCharacter, userId: normalizedUserId, userText: promptText, userDisplayOrder: Number(userMessage?.display_order || 0), recentMessages, logContext: { requestId: userMessage?.id } });
      languagePreference = await applySessionLanguagePreference(db, { character, session, userId: normalizedUserId, userText: promptText, jevDecision: intentTurn.decision });
      promptCharacter = languagePreference.character;
      const chatImageContext = currentProductImageContext ? null : await resolveChatImageReplyDirective(db, {
        session,
        character: promptCharacter,
        userId: normalizedUserId,
        userText: promptText,
        userDisplayOrder: Number(userMessage?.display_order || 0),
        jevDecision: intentTurn.decision,
        conversationContext: intentTurn.conversationContext,
        commerceIntent: intentTurn.commerceSearchIntent,
        commerceSiteId: intentTurn.commerceSite?.id || "",
        imageDecision: intentTurn.imageDecision,
        recentMessages: intentTurn.recentMessages,
      });
      const { productContext, replyResult, feedbackAction } = await buildCharacterReplyGenerationForDb(db, {
        promptCharacter,
        session,
        userId: normalizedUserId,
        characterId: normalizedCharacterId,
        userText: promptText,
        recentMessages,
        productContextOverride: currentProductImageContext,
        intentTurn,
        chatImageContext,
        userDisplayOrder: Number(userMessage?.display_order || 0),
        logContext: {
          requestId: userMessage.id,
          userId: normalizedUserId,
          sessionId: session.id,
          characterId: normalizedCharacterId,
          languagePreference: languagePreference.language,
          languageCode: languagePreference.languageCode,
          languageLabel: languagePreference.languageLabel,
          voiceProvider: character.voice_provider || character.voiceProvider || "",
          voiceModel: resolveReplyVoiceModel().model,
          voiceId: character.voice_id || character.voiceId || "",
        },
        voiceMetaFallback: {
          fallbackLanguageCode: languagePreference.languageCode,
          fallbackLanguageLabel: languagePreference.languageLabel || languagePreference.language,
        },
      });
      const response = await persistCharacterReplyForDb(db, {
        character,
        session,
        userId: normalizedUserId,
        characterId: normalizedCharacterId,
        userText: promptText,
        productContext,
        replyResult,
        feedbackAction,
        replyTriggerMessageId: userMessage.id,
        replyVoicePayloadBuilder(replyVoice) {
          return {
            id: replyVoice.id,
            durationSeconds: replyVoice.durationSeconds,
            audioUrl: replyVoice.audioUrl,
            assetStatus: replyVoice.assetStatus,
          };
        },
      });
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
