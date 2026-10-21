import { normalizeSummaryPeriodType } from "./chat-memory-taxonomy.js";
import { normalizeCharacterId } from "./chat-memory-utils.js";

export async function upsertConversationSummary(db, input = {}) {
  const normalizedUserId = String(input.userId || input.internalUid || "").trim();
  if (!normalizedUserId) {
    const error = new Error("用户不存在");
    error.statusCode = 400;
    throw error;
  }

  const [result] = await db.execute(
    `INSERT INTO conversation_summaries (
       internal_uid, character_id, character_scope_id, period_type, period_start, period_end,
       summary_text, summary_json, source_message_count, summary_status, generated_by
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       period_end = VALUES(period_end),
       summary_text = VALUES(summary_text),
       summary_json = VALUES(summary_json),
       source_message_count = VALUES(source_message_count),
       summary_status = VALUES(summary_status),
       generated_by = VALUES(generated_by),
       updated_at = NOW(3)`,
    [
      normalizedUserId,
      normalizeCharacterId(input.characterId) || null,
      normalizeCharacterId(input.characterId),
      normalizeSummaryPeriodType(input.periodType),
      input.periodStart,
      input.periodEnd,
      String(input.summaryText || "").trim() || null,
      input.summaryJson ? JSON.stringify(input.summaryJson) : null,
      Math.max(0, Number(input.sourceMessageCount || 0)),
      String(input.status || "active").trim() || "active",
      String(input.generatedBy || "rule").trim() || "rule",
    ]
  );
  const insertedId = Number(result.insertId || 0);
  if (insertedId) return insertedId;

  const [rows] = await db.execute(
    `SELECT id
     FROM conversation_summaries
     WHERE internal_uid = ?
       AND character_scope_id = ?
       AND period_type = ?
       AND period_start = ?
     LIMIT 1`,
    [
      normalizedUserId,
      normalizeCharacterId(input.characterId),
      normalizeSummaryPeriodType(input.periodType),
      input.periodStart,
    ]
  );
  return Number(rows[0]?.id || 0);
}

export async function replaceConversationSummaryLinks(db, {
  summaryId,
  sourceMessageIds = [],
  sourceSessionId = "",
} = {}) {
  const normalizedSummaryId = Number(summaryId || 0);
  if (!normalizedSummaryId) return 0;
  await db.execute("DELETE FROM conversation_summary_links WHERE summary_id = ?", [normalizedSummaryId]);
  const uniqueMessageIds = [...new Set(sourceMessageIds.map((id) => String(id || "").trim()).filter(Boolean))].slice(0, 200);
  for (const messageId of uniqueMessageIds) {
    await db.execute(
      `INSERT INTO conversation_summary_links (
         summary_id, source_message_id, source_session_id
       ) VALUES (?, ?, ?)`,
      [
        normalizedSummaryId,
        messageId,
        String(sourceSessionId || "").trim() || null,
      ]
    );
  }
  return uniqueMessageIds.length;
}

export async function getLatestConversationSummary(db, {
  userId,
  characterId,
  periodType = "day",
} = {}) {
  const normalizedUserId = String(userId || "").trim();
  if (!normalizedUserId) return null;
  const [rows] = await db.execute(
    `SELECT *
     FROM conversation_summaries
     WHERE internal_uid = ?
       AND character_scope_id = ?
       AND period_type = ?
       AND summary_status = 'active'
     ORDER BY period_start DESC, updated_at DESC
     LIMIT 1`,
    [
      normalizedUserId,
      normalizeCharacterId(characterId),
      normalizeSummaryPeriodType(periodType),
    ]
  );
  return rows[0] || null;
}

export function buildEmptyDailySummaryJson() {
  return {
    mainTopics: [],
    keyEvents: [],
    footballPreferences: [],
    emotionSignals: [],
    interactionNotes: [],
    followUpTopics: [],
  };
}
