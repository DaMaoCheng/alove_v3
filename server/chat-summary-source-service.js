import { shouldSkipSummarySource } from "./chat-memory-noise-service.js";
import { SUMMARY_PERIOD_TYPES } from "./chat-memory-taxonomy.js";
import { parseJsonValue } from "./chat-memory-utils.js";

const MAX_DAILY_SOURCE_MESSAGES = 80;
const MAX_PERIOD_SOURCE_MESSAGES = 240;

export async function listDailySummarySourceMessages(db, { sessionId, startAt, endAt, textOnly = false }) {
  return listSummarySourceMessages(db, {
    sessionId,
    startAt,
    endAt,
    limit: MAX_DAILY_SOURCE_MESSAGES,
    textOnly,
  });
}

export async function listPeriodSummarySourceMessages(db, { sessionId, startAt, endAt, textOnly = false }) {
  return listSummarySourceMessages(db, {
    sessionId,
    startAt,
    endAt,
    limit: MAX_PERIOD_SOURCE_MESSAGES,
    textOnly,
  });
}

export async function listPeriodDailySummaries(db, {
  userId,
  characterId,
  startAt,
  endAt,
} = {}) {
  const [rows] = await db.execute(
    `SELECT summary_json
     FROM conversation_summaries
     WHERE internal_uid = ?
       AND character_scope_id = ?
       AND period_type = ?
       AND period_start >= ?
       AND period_start < ?
       AND summary_status = 'active'
     ORDER BY period_start ASC`,
    [userId, String(characterId || "").trim(), SUMMARY_PERIOD_TYPES.DAY, startAt, endAt]
  );

  return rows.map((row) => normalizeDailySummaryJson(row.summary_json)).filter(Boolean);
}

async function listSummarySourceMessages(db, { sessionId, startAt, endAt, limit, textOnly = false }) {
  const [rows] = await db.execute(
    `SELECT
       id,
       sender_type,
       content_type,
       text_content,
       product_payload_json,
       sent_at
     FROM chat_messages
     WHERE session_id = ?
       AND sent_at >= ?
       AND sent_at < ?
       AND delivery_status = 'sent'
       ${textOnly ? "AND content_type = 'text'" : ""}
       AND NOT (
         content_type <> 'text'
         AND (
           COALESCE(source_type, '') = 'guest'
           OR COALESCE(source_ref, '') LIKE 'guest-product:%'
           OR COALESCE(source_ref, '') = 'guest-chat-image-generation'
         )
       )
       AND COALESCE(source_ref, '') <> 'placeholder-reply'
     ORDER BY sent_at ASC, display_order ASC
     LIMIT ${limit}`,
    [sessionId, startAt, endAt]
  );
  return rows.map((row) => ({
    id: row.id,
    senderType: row.sender_type,
    contentType: row.content_type,
    text: normalizeMessageText(row),
    sentAt: row.sent_at,
  })).filter((row) => row.text && !shouldSkipSummarySource(row.text));
}

function normalizeMessageText(row) {
  if (row.content_type === "attachment") {
    const attachment = parseJsonValue(row.product_payload_json, {});
    return [row.text_content, attachment.kind, attachment.name].filter(Boolean).join(" ");
  }
  return String(row.text_content || "").trim();
}

function normalizeDailySummaryJson(value) {
  const parsed = parseJsonValue(value, {});
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  return {
    mainTopics: normalizeStringArray(parsed.mainTopics),
    keyEvents: normalizeStringArray(parsed.keyEvents),
    footballPreferences: normalizeStringArray(parsed.footballPreferences),
    emotionSignals: normalizeStringArray(parsed.emotionSignals),
    interactionNotes: normalizeStringArray(parsed.interactionNotes),
    followUpTopics: normalizeStringArray(parsed.followUpTopics),
  };
}

function normalizeStringArray(value) {
  return Array.isArray(value)
    ? value.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
}
