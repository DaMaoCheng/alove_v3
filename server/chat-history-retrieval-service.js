import { inspectMemoryNoise } from "./chat-memory-noise-service.js";

const MAX_QUERY_TERMS = 10;
const DEFAULT_HISTORY_LIMIT = 4;

const TOPIC_RULES = Object.freeze([
  { topic: "match_result", patterns: [/赢了|输了|绝平|绝杀|进球|丢球|比分|win|lost|goal|score/i] },
  { topic: "referee", patterns: [/裁判|点球|var|越位|红牌|黄牌|referee|penalty|offside/i] },
  { topic: "transfer", patterns: [/转会|签约|买人|卖人|租借|transfer|signing|loan/i] },
  { topic: "tactics", patterns: [/阵型|战术|压迫|防守|进攻|控球|formation|tactic|press/i] },
  { topic: "kit_merch", patterns: [/球衣|队服|围巾|周边|kit|jersey|scarf|merch/i] },
]);

const EMOTION_RULES = Object.freeze([
  { tag: "excited", patterns: [/爽|燃|牛|太强|绝了|激动|excited|hyped|amazing/i] },
  { tag: "frustrated", patterns: [/烦|服了|离谱|崩|气死|难受|frustrated|annoyed|mad/i] },
  { tag: "disappointed", patterns: [/失望|可惜|心碎|拉胯|disappointed|sad|heartbroken/i] },
]);

const STOP_WORDS = new Set([
  "the", "and", "you", "are", "for", "with", "that", "this", "what", "why",
  "怎么", "什么", "这个", "那个", "就是", "真的", "现在", "今天", "之前", "记得",
]);

export async function findRelevantHistoryMessages(db, {
  userId,
  characterId,
  sessionId = "",
  queryText = "",
  excludeMessageIds = [],
  limit = DEFAULT_HISTORY_LIMIT,
} = {}) {
  const normalizedUserId = String(userId || "").trim();
  const normalizedCharacterId = String(characterId || "").trim();
  const normalizedQuery = String(queryText || "").trim();
  if (!normalizedUserId || !normalizedCharacterId || !normalizedQuery) return [];

  const query = analyzeQuery(normalizedQuery);
  if (!query.keywords.length && !query.topics.length && !query.emotionTags.length) return [];

  const candidateRows = await loadCandidateIndexRows(db, {
    userId: normalizedUserId,
    characterId: normalizedCharacterId,
    excludeMessageIds,
  });
  const scored = candidateRows
    .map((row) => ({
      row,
      score: scoreHistoryRow(row, query, sessionId),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, Math.min(8, Number(limit || DEFAULT_HISTORY_LIMIT))));

  if (!scored.length) return [];

  const messageIds = scored.map((item) => item.row.message_id);
  const messages = await loadMessagesByIds(db, messageIds);
  const messageMap = new Map(messages.map((message) => [message.id, message]));

  return scored
    .map((item) => {
      const message = messageMap.get(item.row.message_id);
      if (!message) return null;
      return {
        ...message,
        retrievalScore: item.score,
        matchedTopics: intersectArrays(parseJsonArray(item.row.topics_json), query.topics),
        matchedKeywords: intersectArrays(parseJsonArray(item.row.keywords_json).map((value) => value.toLowerCase()), query.keywords.map((value) => value.toLowerCase())),
      };
    })
    .filter(Boolean)
    .sort((a, b) => new Date(a.sentAt || 0).getTime() - new Date(b.sentAt || 0).getTime());
}

function analyzeQuery(text) {
  return {
    keywords: extractKeywords(text),
    topics: matchRuleTags(text, TOPIC_RULES, "topic"),
    emotionTags: matchRuleTags(text, EMOTION_RULES, "tag"),
  };
}

async function loadCandidateIndexRows(db, { userId, characterId, excludeMessageIds }) {
  const excluded = new Set((excludeMessageIds || []).map((id) => String(id || "").trim()).filter(Boolean));
  const [rows] = await db.execute(
    `SELECT
       message_id,
       session_id,
       sender_type,
       content_type,
       text_preview,
       keywords_json,
       topics_json,
       emotion_tags_json,
       intent_tags_json,
       importance_score,
       retrieval_weight,
       created_at
     FROM chat_message_index
     WHERE internal_uid = ?
       AND character_id = ?
     ORDER BY indexed_at DESC
     LIMIT 240`,
    [userId, characterId]
  );
  return rows.filter((row) => {
    if (excluded.has(String(row.message_id || "").trim())) return false;
    return !inspectMemoryNoise(row.text_preview || "").reject;
  });
}

async function loadMessagesByIds(db, messageIds) {
  const ids = [...new Set(messageIds.map((id) => String(id || "").trim()).filter(Boolean))];
  if (!ids.length) return [];
  const placeholders = ids.map(() => "?").join(", ");
  const [rows] = await db.execute(
    `SELECT
       id,
       session_id,
       character_id,
       sender_type,
       content_type,
       text_content,
       product_payload_json,
       sent_at
     FROM chat_messages
     WHERE id IN (${placeholders})
     ORDER BY sent_at ASC`,
    ids
  );
  return rows
    .map((row) => ({
      id: row.id,
      sessionId: row.session_id,
      characterId: row.character_id || "",
      senderType: row.sender_type,
      contentType: row.content_type,
      text: normalizeMessageText(row),
      sentAt: row.sent_at,
    }))
    .filter((row) => row.text);
}

function scoreHistoryRow(row, query, currentSessionId) {
  const rowKeywords = parseJsonArray(row.keywords_json).map((value) => String(value || "").toLowerCase());
  const rowTopics = parseJsonArray(row.topics_json);
  const rowEmotions = parseJsonArray(row.emotion_tags_json);
  const queryKeywords = query.keywords.map((value) => value.toLowerCase());

  const keywordMatches = intersectArrays(rowKeywords, queryKeywords).length;
  const topicMatches = intersectArrays(rowTopics, query.topics).length;
  const emotionMatches = intersectArrays(rowEmotions, query.emotionTags).length;
  if (!keywordMatches && !topicMatches && !emotionMatches) return 0;

  let score = 0;
  score += keywordMatches * 8;
  score += topicMatches * 24;
  score += emotionMatches * 10;
  score += Math.min(20, Number(row.importance_score || 0) / 5);
  if (String(row.session_id || "") === String(currentSessionId || "")) score += 6;
  if (String(row.sender_type || "") === "user") score += 4;
  return score;
}

function extractKeywords(text = "") {
  const words = String(text || "")
    .match(/[\u4e00-\u9fa5]{2,}|[A-Za-z][A-Za-z0-9'-]{2,}/g) || [];
  const seen = new Set();
  return words
    .map((word) => word.trim())
    .filter((word) => word && !STOP_WORDS.has(word.toLowerCase()))
    .filter((word) => {
      const key = word.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_QUERY_TERMS);
}

function matchRuleTags(text, rules, key) {
  return rules
    .filter((rule) => rule.patterns.some((pattern) => pattern.test(text)))
    .map((rule) => rule[key])
    .filter(Boolean);
}

function normalizeMessageText(row) {
  if (row.content_type === "attachment") {
    const attachment = parseJsonValue(row.product_payload_json, {});
    return [row.text_content, attachment.kind, attachment.name].filter(Boolean).join(" ");
  }
  return String(row.text_content || "").trim();
}

function parseJsonArray(value) {
  const parsed = parseJsonValue(value, []);
  return Array.isArray(parsed) ? parsed.map((item) => String(item || "").trim()).filter(Boolean) : [];
}

function parseJsonValue(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function intersectArrays(left, right) {
  const rightSet = new Set((right || []).map((item) => String(item || "").toLowerCase()));
  return (left || []).filter((item) => rightSet.has(String(item || "").toLowerCase()));
}
