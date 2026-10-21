import { parseJsonValue } from "./chat-message-payload-utils.js";

const DEFAULT_HISTORY_IMAGE_LIMIT = 2;
const MAX_HISTORY_IMAGE_CANDIDATES = 80;
const MAX_CONTEXT_ROWS = 6;

const IMAGE_REFERENCE_PATTERNS = Object.freeze([
  /图片|照片|图|附件|photo|picture|pic|image|attachment/i,
  /还记得|之前|上次|刚才|前面|remember|previous|earlier|last time|before/i,
]);

const IMAGE_STOP_WORDS = new Set([
  "the", "and", "you", "are", "for", "with", "that", "this", "what", "why",
  "photo", "picture", "image", "attachment", "pic", "remember", "previous", "earlier",
  "before", "last", "time", "look", "see", "can", "could", "please",
  "图片", "照片", "附件", "这个", "那个", "之前", "上次", "刚才", "前面", "记得",
]);

export async function findRelevantHistoryImageAttachments(db, {
  userId,
  characterId,
  sessionId = "",
  queryText = "",
  excludeMessageIds = [],
  limit = DEFAULT_HISTORY_IMAGE_LIMIT,
} = {}) {
  const normalizedUserId = String(userId || "").trim();
  const normalizedCharacterId = String(characterId || "").trim();
  const normalizedQuery = String(queryText || "").trim();
  if (!normalizedUserId || !normalizedCharacterId || !normalizedQuery) return [];

  const imageReference = isImageReferenceQuery(normalizedQuery);
  const keywords = extractImageQueryKeywords(normalizedQuery);
  if (!imageReference && !keywords.length) return [];

  const rows = await loadHistoryImageAttachmentRows(db, {
    userId: normalizedUserId,
    characterId: normalizedCharacterId,
  });
  if (!rows.length) return [];

  const excluded = new Set((excludeMessageIds || []).map((id) => String(id || "").trim()).filter(Boolean));
  const scored = [];
  for (const row of rows) {
    if (excluded.has(String(row.id || "").trim())) continue;
    const attachment = parseJsonValue(row.product_payload_json, null);
    if (attachment?.kind !== "image" || !attachment?.url) continue;
    const contextText = await loadNearbyHistoryText(db, row);
    const score = scoreHistoryImageRow({
      row,
      attachment,
      contextText,
      keywords,
      imageReference,
      currentSessionId: sessionId,
    });
    if (score <= 0) continue;
    scored.push({ row, attachment, contextText, score });
  }

  return scored
    .sort((a, b) => b.score - a.score || new Date(b.row.sent_at || 0).getTime() - new Date(a.row.sent_at || 0).getTime())
    .slice(0, Math.max(1, Math.min(3, Number(limit || DEFAULT_HISTORY_IMAGE_LIMIT))))
    .map((item) => ({
      messageId: item.row.id,
      sessionId: item.row.session_id,
      sentAt: item.row.sent_at,
      score: item.score,
      attachment: item.attachment,
      contextText: item.contextText,
    }));
}

function isImageReferenceQuery(text = "") {
  return IMAGE_REFERENCE_PATTERNS.some((pattern) => pattern.test(text));
}

function extractImageQueryKeywords(text = "") {
  const words = String(text || "")
    .match(/[\u4e00-\u9fa5]{2,}|[A-Za-z][A-Za-z0-9'-]{2,}/g) || [];
  const seen = new Set();
  return words
    .map((word) => word.trim())
    .filter((word) => word && !IMAGE_STOP_WORDS.has(word.toLowerCase()))
    .filter((word) => {
      const key = word.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 8);
}

async function loadHistoryImageAttachmentRows(db, { userId, characterId }) {
  const [rows] = await db.execute(
    `SELECT
       m.id,
       m.session_id,
       m.product_payload_json,
       m.text_content,
       m.display_order,
       m.sent_at,
       i.text_preview,
       i.keywords_json,
       i.topics_json
     FROM chat_messages m
     INNER JOIN chat_sessions s ON s.id = m.session_id
     LEFT JOIN chat_message_index i ON i.message_id = m.id
     WHERE s.internal_uid = ?
       AND s.character_id = ?
       AND m.sender_type = 'user'
       AND m.content_type = 'attachment'
       AND m.delivery_status = 'sent'
     ORDER BY m.sent_at DESC, m.display_order DESC
     LIMIT ${MAX_HISTORY_IMAGE_CANDIDATES}`,
    [userId, characterId]
  );
  return rows;
}

async function loadNearbyHistoryText(db, row) {
  const displayOrder = Number(row.display_order || 0);
  const [rows] = await db.execute(
    `SELECT sender_type, content_type, text_content, product_payload_json
     FROM chat_messages
     WHERE session_id = ?
       AND delivery_status = 'sent'
       AND display_order >= ?
       AND display_order <= ?
       AND id <> ?
     ORDER BY display_order ASC, sent_at ASC
     LIMIT ${MAX_CONTEXT_ROWS}`,
    [
      row.session_id,
      Math.max(0, displayOrder - 20),
      displayOrder + 40,
      row.id,
    ]
  );
  return rows.map(normalizeContextMessageText).filter(Boolean).join(" ");
}

function normalizeContextMessageText(row = {}) {
  if (row.content_type === "attachment") {
    const attachment = parseJsonValue(row.product_payload_json, null);
    return [row.text_content, attachment?.kind, attachment?.name].filter(Boolean).join(" ");
  }
  return String(row.text_content || "").trim();
}

function scoreHistoryImageRow({ row, attachment, contextText, keywords, imageReference, currentSessionId }) {
  const haystack = [
    row.text_content,
    row.text_preview,
    attachment.name,
    attachment.mimeType,
    contextText,
  ].filter(Boolean).join(" ").toLowerCase();
  const keywordMatches = keywords.filter((keyword) => haystack.includes(keyword.toLowerCase())).length;
  if (!keywordMatches && !imageReference) return 0;

  let score = 0;
  score += keywordMatches * 20;
  if (imageReference) score += 8;
  if (String(row.session_id || "") === String(currentSessionId || "")) score += 6;
  const ageHours = Math.max(0, (Date.now() - new Date(row.sent_at || Date.now()).getTime()) / 36e5);
  score += Math.max(0, 12 - Math.min(12, ageHours / 24));
  if (!keywordMatches && imageReference) score = Math.min(score, 16);
  return score;
}
