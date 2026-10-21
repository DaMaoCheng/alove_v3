import { normalizeCharacterLanguage } from "../shared/language-library.js";
import { upsertPersonaLanguageSetting } from "./chat-language-preference-service.js";
import { createHash } from "node:crypto";
import { getDbPool, withTransaction } from "./db.js";
import { buildChatReplyPrompt } from "./chat-prompt-service.js";
import { generateChatReply } from "./ai-reply-service.js";
import { isAiTransportFallback } from "./ai-reply-fallback-service.js";
import { getChatImageStatusCopy } from "./chat-image-copy-service.js";
import { MEMORY_JOB_TYPES, enqueueMemoryJob } from "./memory-job-service.js";
import {
  attachVoiceAssetToMessage,
  getNextMessageOrder,
  insertMessage,
  listRecentMessagesBeforeOrder,
} from "./chat-message-store.js";
import { indexChatMessage } from "./chat-memory-service.js";
import { enqueueSummaryRefreshJobs } from "./chat-context-jobs-service.js";
import { generateReservedAiReplyVoiceAsset, reserveAiReplyVoiceAssetForDb } from "./chat-voice-asset-service.js";
import { applyGuestPromptPolicy, normalizeGuestReplyText } from "./guest-chat-output-policy.js";
import { guestVoiceMeta } from "./guest-session-service.js";
import { parseJsonValue } from "./chat-message-payload-utils.js";
import { acquireDedicatedDbAdvisoryLock } from "./db-advisory-lock-service.js";

const FAILURE_REPLY_SOURCE_PREFIX = "chat-image-failure:";

export async function enqueueChatImageFailureReplyIfNeeded(db, {
  assetId = "",
  messageId = "",
  sessionId = "",
  userId = "",
  guestSessionId = "",
  characterId = "",
} = {}) {
  const normalizedAssetId = String(assetId || "").trim();
  const normalizedMessageId = String(messageId || "").trim();
  if (!normalizedAssetId || !normalizedMessageId || !String(sessionId || "").trim() || !String(characterId || "").trim()) return "";
  const releaseLock = await acquireDedicatedDbAdvisoryLock(`chat-image-failure-enqueue:${normalizedAssetId}`, 5);
  try {
    const [existing] = await db.execute(
      `SELECT id FROM memory_jobs WHERE job_type = ?
         AND JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.assetId')) = ? LIMIT 1`,
      [MEMORY_JOB_TYPES.GENERATE_CHAT_IMAGE_FAILURE_REPLY, normalizedAssetId]
    );
    if (existing[0]?.id) return String(existing[0].id);
    // The advisory lock may be released before an outer transaction commits.
    // A stable primary key keeps concurrent enqueues idempotent across that window.
    const jobId = `mem_job_img_fail_${createHash("sha256").update(normalizedAssetId).digest("hex").slice(0, 32)}`;
    try {
      return await enqueueMemoryJob({
        id: jobId,
        userId, characterId, sessionId,
        jobType: MEMORY_JOB_TYPES.GENERATE_CHAT_IMAGE_FAILURE_REPLY,
        priority: 25,
        maxRetries: 2,
        payload: { assetId: normalizedAssetId, messageId: normalizedMessageId },
      }, db);
    } catch (error) {
      if (error?.code !== "ER_DUP_ENTRY") throw error;
      return jobId;
    }
  } finally {
    await releaseLock();
  }
}

export async function generateChatImageFailureReplyFromJob(job = {}) {
  const payload = job.payload || {};
  const assetId = String(payload.assetId || "").trim();
  const messageId = String(payload.messageId || "").trim();
  if (!assetId || !messageId) throw new Error("Chat image failure reply job payload is missing assetId or messageId");

  const releaseLock = await acquireDedicatedDbAdvisoryLock(`chat-image-failure:${assetId}`, 5);
  try {
    const context = await loadFailureReplyContext(assetId, messageId);
    if (!context || context.imageStatus !== "failed") return { ok: true, skipped: true, reason: "image_not_failed" };
    const sourceRef = `${FAILURE_REPLY_SOURCE_PREFIX}${assetId}`;
    if (context.existingReplyId) return { ok: true, skipped: true, reason: "reply_already_exists" };
    const recentMessages = await listRecentMessagesBeforeOrder(getDbPool(), {
      sessionId: context.sessionId,
      beforeDisplayOrder: context.imageDisplayOrder,
    });
    const userText = findLatestUserText(recentMessages) || "The user asked for a photo.";
    const reply = await generateFailureReply({
      character: context.character, recentMessages, userText,
      language: context.preferredLanguage,
      isGuest: Boolean(context.guestSessionId),
      logContext: {
        userId: context.internalUid, guestSessionId: context.guestSessionId,
        sessionId: context.sessionId, characterId: context.characterId, sourceRef,
        languagePreference: context.preferredLanguage, languageCode: context.languageCode,
      },
    });
    const voiceAssetId = await persistFailureReply({ context, reply, sourceRef });
    if (voiceAssetId) {
      await generateReservedAiReplyVoiceAsset({ assetId: voiceAssetId }).catch((error) => {
        console.warn("[aiove] image failure reply voice unavailable:", error.message);
      });
    }
    return { ok: true, sourceRef };
  } finally {
    await releaseLock();
  }
}

async function generateFailureReply({ character, recentMessages, userText, language, isGuest, logContext }) {
  const chatImageContext = {
    taskCreated: true,
    taskFailed: true,
    instruction: [
      "The previous chat photo task failed before producing an image.",
      "Reply now with a brief, natural apology in character and acknowledge that the photo did not come through.",
      "Do not claim that an image is ready, sent, attached, or available.",
      "Do not mention providers, error codes, backend jobs, quotas, or internal rules.",
      "If it fits the character voice, offer to try again or suggest a simple alternative.",
    ].join("\n"),
  };
  let promptContext = buildChatReplyPrompt({
    character,
    recentMessages,
    userText,
    chatImageContext,
  });
  if (isGuest) promptContext = applyGuestPromptPolicy(promptContext);

  try {
    const generated = await generateChatReply({ promptContext, userText, logContext });
    if (isAiTransportFallback(generated)) {
      throw new Error("AI failure reply provider fallback");
    }
    const fallback = getChatImageStatusCopy({ language, status: "failed" });
    const text = isGuest
      ? normalizeGuestReplyText({ text: generated.text, userText, languageCode: language })
      : String(generated.text || "").trim();
    return {
      ...generated,
      text: text || fallback,
      // Keep spoken and visible failure responses identical; never let a stale success claim survive in TTS.
      speechText: text || fallback,
    };
  } catch (error) {
    console.warn("[aiove] chat image failure reply generation failed; using localized fallback:", error.message);
    const fallback = getChatImageStatusCopy({ language, status: "failed" });
    return {
      text: fallback,
      speechText: fallback,
      sourceType: "system",
      sourceRef: "chat-image-failure-reply-fallback",
      voiceMeta: {},
    };
  }
}

async function persistFailureReply({ context, reply, sourceRef }) {
  return withTransaction(async (db) => {
    // Resolve ownership again: a guest may have registered while the provider was replying.
    const [[session]] = await db.execute("SELECT * FROM chat_sessions WHERE id = ? FOR UPDATE", [context.sessionId]);
    if (!session) return "";
    const [existing] = await db.execute("SELECT id FROM chat_messages WHERE session_id = ? AND source_ref = ? LIMIT 1", [context.sessionId, sourceRef]);
    if (existing[0]) return "";
    const message = await insertMessage(db, {
      sessionId: context.sessionId,
      guestSessionId: session.internal_uid ? "" : session.guest_session_id || "",
      characterId: context.characterId,
      senderType: "character", senderLabel: context.character.name,
      contentType: "text", text: reply.text,
      displayOrder: await getNextMessageOrder(db, context.sessionId),
      sourceType: reply.sourceType || "ai", sourceRef,
    });
    const voice = await reserveAiReplyVoiceAssetForDb(db, {
      messageId: message.id, characterId: context.characterId,
      userId: session.internal_uid || "", speechText: reply.text,
      voiceMeta: session.internal_uid
        ? { ...(reply.voiceMeta || {}), languageCode: context.languageCode, languageLabel: context.preferredLanguage }
        : guestVoiceMeta(context.character, "", {
            languageCode: context.languageCode,
            languageLabel: context.preferredLanguage,
          }),
    });
    await attachVoiceAssetToMessage(db, { messageId: message.id, voiceAssetId: voice.id });
    if (session.internal_uid) {
      await indexChatMessage(db, { message, session, userId: session.internal_uid, characterId: context.characterId });
      await enqueueSummaryRefreshJobs(db, { userId: session.internal_uid, characterId: context.characterId, sessionId: context.sessionId });
    }
    await db.execute("UPDATE chat_sessions SET last_message_at = NOW(3), updated_at = NOW(3) WHERE id = ?", [context.sessionId]);
    return voice.id;
  });
}

async function loadFailureReplyContext(assetId, messageId) {
  const [rows] = await getDbPool().execute(
    `SELECT a.id AS image_asset_id, a.status AS image_status, a.session_id, a.internal_uid, a.guest_session_id,
            m.display_order AS image_display_order,
            s.preferred_language,
            (SELECT JSON_UNQUOTE(JSON_EXTRACT(image_job.payload_json, '$.replyLanguageCode'))
             FROM memory_jobs image_job WHERE image_job.job_type = 'generate_chat_image'
               AND JSON_UNQUOTE(JSON_EXTRACT(image_job.payload_json, '$.assetId')) = a.id
             ORDER BY image_job.created_at DESC LIMIT 1) AS image_reply_language_code,
            c.id, c.id AS character_id, c.name, c.opening_line, c.persona_prompt, c.speaking_style,
            c.role_title, c.short_bio, c.category_id, c.voice_provider, c.voice_id,
            c.tags_json, c.profile_json,
            EXISTS(
              SELECT 1 FROM chat_messages prior_reply
              WHERE prior_reply.session_id = a.session_id
                AND prior_reply.source_ref = CONCAT(?, a.id)
            ) AS existing_reply
     FROM chat_image_assets a
     INNER JOIN chat_messages m ON m.id = a.message_id AND m.session_id = a.session_id
     INNER JOIN chat_sessions s ON s.id = a.session_id
     INNER JOIN ai_characters c ON c.id = a.character_id
     WHERE a.id = ? AND a.message_id = ?
     LIMIT 1`,
    [FAILURE_REPLY_SOURCE_PREFIX, assetId, messageId]
  );
  const row = rows[0];
  if (!row) return null;
  const profile = parseJsonValue(row.profile_json, {});
  const requested = normalizeCharacterLanguage(row.image_reply_language_code);
  const resolvedLanguage = requested || normalizeCharacterLanguage(row.preferred_language || profile.defaultLanguageLabel || "English");
  const language = resolvedLanguage?.label || "English";
  // Metadata belongs to this image request, never a persisted conversation preference.
  const character = { ...row, profile_json: JSON.stringify({ ...profile, language, languageCode: resolvedLanguage?.code || "en" }),
    persona_prompt: upsertPersonaLanguageSetting(row.persona_prompt, language) };
  return {
    imageStatus: String(row.image_status || "").trim().toLowerCase(),
    sessionId: String(row.session_id || "").trim(),
    imageAssetId: String(row.image_asset_id || "").trim(),
    session: { id: row.session_id, character_id: row.character_id, internal_uid: row.internal_uid || "", preferred_language: language },
    internalUid: String(row.internal_uid || "").trim(),
    guestSessionId: String(row.guest_session_id || "").trim(),
    characterId: String(row.character_id || "").trim(),
    imageDisplayOrder: Number(row.image_display_order || 0),
    preferredLanguage: language,
    languageCode: resolvedLanguage?.code || "en",
    existingReplyId: Number(row.existing_reply || 0) === 1 ? `${FAILURE_REPLY_SOURCE_PREFIX}${assetId}` : "",
    character,
  };
}

function findLatestUserText(messages = []) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const row = messages[index];
    const senderType = row?.senderType || row?.sender_type;
    const text = String(row?.text || row?.text_content || "").trim();
    if (senderType === "user" && text) return text;
  }
  return "";
}
