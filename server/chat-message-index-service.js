import { inspectMemoryNoise } from "./chat-memory-noise-service.js";
import { analyzeMessageText, scoreMessageImportance } from "./chat-memory-analysis.js";
import { parseJsonValue } from "./chat-memory-utils.js";

export async function indexChatMessage(db, {
  message,
  session,
  userId,
  characterId,
} = {}) {
  const messageId = String(message?.id || "").trim();
  const sessionId = String(message?.sessionId || session?.id || "").trim();
  const normalizedUserId = String(userId || session?.internal_uid || "").trim();
  if (!messageId || !sessionId || !normalizedUserId) return null;

  const text = normalizeMessageIndexText(message);
  if (inspectMemoryNoise(text).reject) return null;

  const analysis = analyzeMessageText(text);
  const contentType = String(message?.contentType || "text").trim() || "text";
  const senderType = String(message?.senderType || "").trim() || "user";
  const importanceScore = scoreMessageImportance({
    text,
    senderType,
    contentType,
    analysis,
  });

  await db.execute(
    `INSERT INTO chat_message_index (
       message_id, session_id, internal_uid, character_id, sender_type, content_type,
       text_preview, keywords_json, topics_json, entities_json, emotion_tags_json, intent_tags_json,
       importance_score, retrieval_weight, indexed_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(3))
     ON DUPLICATE KEY UPDATE
       session_id = VALUES(session_id),
       internal_uid = VALUES(internal_uid),
       character_id = VALUES(character_id),
       sender_type = VALUES(sender_type),
       content_type = VALUES(content_type),
       text_preview = VALUES(text_preview),
       keywords_json = VALUES(keywords_json),
       topics_json = VALUES(topics_json),
       entities_json = VALUES(entities_json),
       emotion_tags_json = VALUES(emotion_tags_json),
       intent_tags_json = VALUES(intent_tags_json),
       importance_score = VALUES(importance_score),
       retrieval_weight = VALUES(retrieval_weight),
       indexed_at = NOW(3)`,
    [
      messageId,
      sessionId,
      normalizedUserId,
      String(characterId || message?.characterId || session?.character_id || "").trim() || null,
      senderType,
      contentType,
      text.slice(0, 500),
      JSON.stringify(analysis.keywords),
      JSON.stringify(analysis.topics),
      JSON.stringify(analysis.entities),
      JSON.stringify(analysis.emotionTags),
      JSON.stringify(analysis.intentTags),
      importanceScore,
      importanceScore,
    ]
  );

  return {
    messageId,
    keywords: analysis.keywords,
    topics: analysis.topics,
    importanceScore,
  };
}

export async function backfillChatMessageIndexForSession(db, {
  sessionId,
  userId,
  characterId,
  limit = 240,
  textOnly = false,
} = {}) {
  const normalizedSessionId = String(sessionId || "").trim();
  const normalizedUserId = String(userId || "").trim();
  const normalizedCharacterId = String(characterId || "").trim();
  if (!normalizedSessionId || !normalizedUserId || !normalizedCharacterId) return 0;

  const [rows] = await db.execute(
    `SELECT
       m.id,
       m.session_id,
       m.character_id,
       m.sender_type,
       m.content_type,
       m.text_content,
       m.product_payload_json,
       m.display_order,
       m.sent_at
     FROM chat_messages m
     LEFT JOIN chat_message_index i ON i.message_id = m.id
     WHERE m.session_id = ?
       AND i.message_id IS NULL
       AND m.delivery_status = 'sent'
       ${textOnly ? "AND m.content_type = 'text'" : ""}
       AND NOT (
         m.content_type <> 'text'
         AND (
           COALESCE(m.source_type, '') = 'guest'
           OR COALESCE(m.source_ref, '') LIKE 'guest-product:%'
           OR COALESCE(m.source_ref, '') = 'guest-chat-image-generation'
         )
       )
       AND COALESCE(m.source_ref, '') <> 'placeholder-reply'
     ORDER BY m.sent_at DESC, m.display_order DESC
     LIMIT ${Math.max(1, Math.min(500, Number(limit || 240)))}`,
    [normalizedSessionId]
  );

  const session = {
    id: normalizedSessionId,
    internal_uid: normalizedUserId,
    character_id: normalizedCharacterId,
  };
  for (const row of rows) {
    await indexChatMessage(db, {
      message: mapStoredMessageForIndex(row),
      session,
      userId: normalizedUserId,
      characterId: normalizedCharacterId,
    });
  }
  return rows.length;
}

function normalizeMessageIndexText(message = {}) {
  const contentType = String(message.contentType || "").trim();
  if (contentType === "attachment") {
    const attachment = message.attachment || message.product || {};
    return [
      message.text,
      attachment.kind,
      attachment.name,
      attachment.mimeType,
    ].filter(Boolean).join(" ");
  }
  return String(message.text || "").trim();
}

function mapStoredMessageForIndex(row = {}) {
  const product = parseJsonValue(row.product_payload_json, null);
  return {
    id: row.id,
    sessionId: row.session_id,
    characterId: row.character_id || "",
    senderType: row.sender_type,
    contentType: row.content_type,
    text: String(row.text_content || "").trim(),
    product,
    attachment: product,
    displayOrder: row.display_order,
    sentAt: row.sent_at,
  };
}
