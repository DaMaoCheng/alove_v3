import { assertMemoryJobLease } from "./memory-job-service.js";
import { completeProactiveMessageDelivery, lockProactiveMessageDeliveryForSend } from "./proactive-message-delivery-service.js";
import { completePromotionCampaignDelivery } from "./promotion-campaign-match-service.js";
import { inspectProactiveSendPolicy } from "./proactive-content-policy-service.js";
import { indexChatMessage } from "./chat-memory-service.js";
import { resolveReplyVoiceModel } from "./chat-reply-voice-service.js";
import { createAiReplyVoiceAssetForDb } from "./chat-voice-asset-service.js";
import { buildCampaignProductPayload } from "./promotion-campaign-product-payload-service.js";
import { recordProductBubbleTriggered } from "./product-analytics-service.js";
import { getDbPool } from "./db.js";
import {
  enqueueSummaryRefreshJobs,
  findCharacterById,
  findLatestUserSessionForDb,
  getNextMessageOrder,
  attachVoiceAssetToMessage,
  insertMessage,
  mapSessionRow,
  lockUserSessionOwnerForDb,
  normalizeMessageText,
  throwNotFound,
} from "./chat-service-shared.js";

export async function createProactiveCharacterMessage({
  characterId,
  userId,
  sessionId = "",
  text,
  speechText = "",
  sourceRef = "proactive-nudge",
  generateVoiceAudio = null,
  proactivePolicy = null,
  timeZone = "UTC",
  job = null,
  delivery = null,
}) {
  const normalizedCharacterId = String(characterId || "").trim();
  const normalizedUserId = String(userId || "").trim();
  const normalizedSessionId = String(sessionId || "").trim();
  const normalizedText = normalizeMessageText(text);
  const normalizedSpeechText = normalizedText;
  if (!normalizedCharacterId) throwNotFound();
  if (!normalizedUserId) {
    const error = new Error("请先登录");
    error.statusCode = 401;
    throw error;
  }
  if (!normalizedText) {
    const error = new Error("主动消息内容为空");
    error.statusCode = 400;
    throw error;
  }

  if (!proactivePolicy) return { ok: true, sent: false, reason: "proactive_policy_missing", items: [] };

  return getDbPool().getConnection().then(async (db) => {
    try {
      await db.beginTransaction();
      if (job?.id) await assertMemoryJobLease(db, job, { lock: true });
      await lockUserSessionOwnerForDb(db, normalizedUserId);
      const character = await findCharacterById(db, normalizedCharacterId, { userId: normalizedUserId });
      if (!character) throwNotFound();

      const session = normalizedSessionId
        ? await findScopedActiveSession(db, {
            sessionId: normalizedSessionId,
            characterId: normalizedCharacterId,
            userId: normalizedUserId,
          })
        : await findLatestUserSessionForDb(db, {
            characterId: normalizedCharacterId,
            userId: normalizedUserId,
          });
      if (!session) {
        const error = new Error("主动消息需要已有用户会话");
        error.statusCode = 409;
        throw error;
      }

      const reservedDelivery = await lockProactiveMessageDeliveryForSend(db, {
        delivery, userId: normalizedUserId, characterId: normalizedCharacterId, sessionId: session.id,
      });
      if (reservedDelivery?.delivery_status === "sent") {
        await db.rollback();
        return { ok: true, sent: true, replayed: true, messageId: reservedDelivery.message_id || "", items: [] };
      }

      const contentGate = await inspectProactiveSendPolicy(db, {
        userId: normalizedUserId, characterId: normalizedCharacterId, sessionId: session.id,
        text: normalizedText, policy: proactivePolicy, timeZone,
        isCampaign: false,
      });
      if (!contentGate.allowed) {
        await db.rollback();
        return { ok: true, sent: false, reason: contentGate.reason, items: [] };
      }

      const nextOrder = await getNextMessageOrder(db, session.id);
      const message = await insertMessage(db, {
        sessionId: session.id,
        characterId: normalizedCharacterId,
        senderType: "character",
        senderLabel: character.name,
        contentType: "text",
        text: normalizedText,
        displayOrder: nextOrder,
        sourceType: "ai",
        sourceRef,
      });
      await attachProactiveVoiceAsset(db, {
        message,
        character,
        characterId: normalizedCharacterId,
        userId: normalizedUserId,
        speechText: normalizedSpeechText,
        generateVoiceAudio,
      });

      await indexChatMessage(db, {
        message,
        session,
        userId: normalizedUserId,
        characterId: normalizedCharacterId,
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
      await completeProactiveSendDelivery(db, delivery, message.id);
      await db.commit();

      return {
        ok: true,
        session: mapSessionRow({
          ...session,
          last_message_at: new Date(),
        }),
        items: [message],
      };
    } catch (error) {
      await db.rollback();
      throw error;
    } finally {
      db.release();
    }
  });
}

export async function createProactivePromotionCampaignMessages({
  characterId,
  userId,
  sessionId = "",
  text,
  speechText = "",
  campaign,
  sourceRef = "promotion-campaign",
  generateVoiceAudio = null,
  proactivePolicy = null,
  timeZone = "UTC",
  job = null,
  delivery = null,
}) {
  const normalizedCharacterId = String(characterId || "").trim();
  const normalizedUserId = String(userId || "").trim();
  const normalizedSessionId = String(sessionId || "").trim();
  const normalizedText = normalizeMessageText(text);
  const normalizedSpeechText = normalizedText;
  const normalizedSourceRef = safeString(sourceRef).slice(0, 128) || "promotion-campaign";
  const product = buildCampaignProductPayload(campaign);
  if (!normalizedCharacterId) throwNotFound();
  if (!normalizedUserId) {
    const error = new Error("请先登录");
    error.statusCode = 401;
    throw error;
  }
  if (!product.name || !product.url) {
    const error = new Error("广告活动商品信息不完整");
    error.statusCode = 400;
    throw error;
  }

  if (!proactivePolicy) return { ok: true, sent: false, reason: "proactive_policy_missing", items: [] };

  return getDbPool().getConnection().then(async (db) => {
    try {
      await db.beginTransaction();
      if (job?.id) await assertMemoryJobLease(db, job, { lock: true });
      await lockUserSessionOwnerForDb(db, normalizedUserId);
      const character = await findCharacterById(db, normalizedCharacterId, { userId: normalizedUserId });
      if (!character) throwNotFound();

      const session = normalizedSessionId
        ? await findScopedActiveSession(db, {
            sessionId: normalizedSessionId,
            characterId: normalizedCharacterId,
            userId: normalizedUserId,
          })
        : await findLatestUserSessionForDb(db, {
            characterId: normalizedCharacterId,
            userId: normalizedUserId,
          });
      if (!session) {
        const error = new Error("主动消息需要已有用户会话");
        error.statusCode = 409;
        throw error;
      }

      const reservedDelivery = await lockProactiveMessageDeliveryForSend(db, {
        delivery, userId: normalizedUserId, characterId: normalizedCharacterId, sessionId: session.id,
      });
      if (reservedDelivery?.delivery_status === "sent") {
        await db.rollback();
        return { ok: true, sent: true, replayed: true, messageId: reservedDelivery.message_id || "", items: [] };
      }

      const contentGate = await inspectProactiveSendPolicy(db, {
        userId: normalizedUserId, characterId: normalizedCharacterId, sessionId: session.id,
        text: normalizedText, policy: proactivePolicy, timeZone,
        isCampaign: true,
      });
      if (!contentGate.allowed) {
        await db.rollback();
        return { ok: true, sent: false, reason: contentGate.reason, items: [] };
      }

      const nextOrder = await getNextMessageOrder(db, session.id);
      const textMessage = await insertMessage(db, {
        sessionId: session.id,
        characterId: normalizedCharacterId,
        senderType: "character",
        senderLabel: character.name,
        contentType: "text",
        text: normalizedText,
        displayOrder: nextOrder,
        sourceType: "promotion_campaign",
        sourceRef: normalizedSourceRef,
      });
      const productMessage = await insertMessage(db, {
        sessionId: session.id,
        characterId: normalizedCharacterId,
        senderType: "character",
        senderLabel: character.name,
        contentType: "product",
        text: product.name,
        product,
        displayOrder: nextOrder + 5,
        sourceType: "promotion_campaign",
        sourceRef: `${normalizedSourceRef}-product`.slice(0, 128),
      });
      await attachProactiveVoiceAsset(db, {
        message: textMessage,
        character,
        characterId: normalizedCharacterId,
        userId: normalizedUserId,
        speechText: normalizedSpeechText,
        generateVoiceAudio,
      });

      await indexChatMessage(db, {
        message: textMessage,
        session,
        userId: normalizedUserId,
        characterId: normalizedCharacterId,
      });
      await indexChatMessage(db, {
        message: productMessage,
        session,
        userId: normalizedUserId,
        characterId: normalizedCharacterId,
      });
      await recordProductBubbleTriggered(db, {
        userId: normalizedUserId,
        sessionId: session.id,
        messageId: productMessage.id,
        character,
        product,
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
      await completeProactiveSendDelivery(db, delivery, productMessage.id);
      await db.commit();

      return {
        ok: true,
        session: mapSessionRow({
          ...session,
          last_message_at: new Date(),
        }),
        items: [textMessage, productMessage],
        textMessage,
        productMessage,
      };
    } catch (error) {
      await db.rollback();
      throw error;
    } finally {
      db.release();
    }
  });
}

async function attachProactiveVoiceAsset(db, {
  message,
  character = {},
  characterId = "",
  userId = "",
  speechText = "",
  generateVoiceAudio = null,
} = {}) {
  const replyVoice = await createAiReplyVoiceAssetForDb(db, {
    messageId: message.id,
    characterId,
    userId,
    speechText,
    voiceMeta: buildProactiveVoiceMeta(character),
    generateAudio: generateVoiceAudio,
  });
  await attachVoiceAssetToMessage(db, {
    messageId: message.id,
    voiceAssetId: replyVoice.id,
  });
  message.voice = {
    id: replyVoice.id,
    durationSeconds: replyVoice.durationSeconds,
    audioUrl: replyVoice.audioUrl,
    assetStatus: replyVoice.assetStatus,
    model: replyVoice.model,
    languageCode: replyVoice.languageCode,
    languageLabel: replyVoice.languageLabel,
  };
}

function buildProactiveVoiceMeta(character = {}) {
  const profile = parseJsonObject(character.profile_json || character.profileJson);
  return {
    provider: safeString(character.voice_provider || character.voiceProvider || "elevenlabs") || "elevenlabs",
    model: safeString(character.voice_model || character.voiceModel) || resolveReplyVoiceModel().model,
    voiceId: safeString(character.voice_id || character.voiceId),
    languageCode: safeString(profile.defaultLanguageCode || profile.languageCode || "en") || "en",
    languageLabel: safeString(profile.defaultLanguageLabel || profile.language || "English") || "English",
  };
}

function parseJsonObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

async function findScopedActiveSession(db, { sessionId, characterId, userId } = {}) {
  const [rows] = await db.execute(
    `SELECT id, character_id, session_title, session_status, source_type, source_ref, preferred_language, last_message_at
     FROM chat_sessions
     WHERE id = ?
       AND character_id = ?
       AND internal_uid = ?
       AND session_status = 'active'
       AND source_type = 'user'
     LIMIT 1`,
    [sessionId, characterId, userId]
  );
  return rows[0] || null;
}

function safeString(value) {
  return String(value == null ? "" : value).trim();
}

// Both message rows and the slot fact commit together; a killed worker cannot leave an unrecorded send.
async function completeProactiveSendDelivery(db, delivery, messageId) {
  if (!delivery?.id) return;
  if (delivery.campaignDeliveryId) {
    const campaign = await completePromotionCampaignDelivery({ deliveryId: delivery.campaignDeliveryId, messageId }, db);
    if (!campaign.updated) throw new Error("Proactive campaign delivery changed before completion");
  }
  const completed = await completeProactiveMessageDelivery({
    deliveryId: delivery.id, messageId, sourceType: delivery.sourceType,
    sourceRef: delivery.sourceRef, campaignId: delivery.campaignId || null,
  }, db);
  if (!completed.updated) throw new Error("Proactive delivery changed before completion");
}
