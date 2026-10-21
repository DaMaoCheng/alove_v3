import { SUMMARY_PERIOD_TYPES } from "./chat-memory-taxonomy.js";
import { getDbPool } from "./db.js";
import { CHAT_RETENTION_DAYS } from "./chat-retention-policy.js";
import { cleanupExpiredChatMessages } from "./chat-retention-cleanup-service.js";

const RAW_MESSAGE_CLEANUP_BATCH_LIMIT = 100;
const RAW_MESSAGE_CLEANUP_MAX_BATCHES = 10;

export const MEMORY_RETENTION_DAYS = Object.freeze({
  ...CHAT_RETENTION_DAYS,
  DAY_SUMMARIES: 45,
  WEEK_SUMMARIES: 120,
  MONTH_SUMMARIES: 365,
});

export async function cleanupRawChatMessages({ retentionDays = MEMORY_RETENTION_DAYS.RAW_MESSAGES, now = new Date(), sessionId = "" } = {}) {
  const cutoff = resolveCutoffDate({ retentionDays, now });
  let deletedMessages = 0;
  let skippedMessages = 0;
  let scannedMessages = 0;
  let after = null;
  let batches = 0;
  let hasMore = false;
  while (batches < RAW_MESSAGE_CLEANUP_MAX_BATCHES) {
    const result = await cleanupExpiredChatMessages({
      cutoff,
      limit: RAW_MESSAGE_CLEANUP_BATCH_LIMIT,
      after,
      sessionId,
    });
    deletedMessages += result.deletedMessages;
    skippedMessages += result.skippedMessages;
    scannedMessages += result.scannedMessages;
    batches += 1;
    hasMore = result.hasMore;
    if (!result.hasMore || !result.nextCursor) break;
    after = result.nextCursor;
  }
  const orphanIndexes = await cleanupOrphanChatMessageIndexes();
  return {
    cutoff,
    deletedMessages,
    skippedMessages,
    scannedMessages,
    batches,
    hasMore,
    deletedOrphanIndexes: orphanIndexes,
  };
}

export async function cleanupOrphanChatMessageIndexes() {
  const [result] = await getDbPool().execute(
    `DELETE i
     FROM chat_message_index i
     LEFT JOIN chat_messages m ON m.id = i.message_id
     WHERE m.id IS NULL`
  );
  return Number(result.affectedRows || 0);
}

export async function cleanupExpiredMemoryRecords({ now = new Date() } = {}) {
  const [result] = await getDbPool().execute(
    `UPDATE user_memory_records
     SET memory_status = 'expired',
         updated_at = NOW(3)
     WHERE memory_status = 'active'
       AND expires_at IS NOT NULL
       AND expires_at <= ?`,
    [now]
  );
  return {
    expiredMemories: Number(result.affectedRows || 0),
  };
}

export async function cleanupConversationSummaries({ now = new Date() } = {}) {
  const results = [];
  results.push(await cleanupSummariesByPeriod({
    periodType: SUMMARY_PERIOD_TYPES.DAY,
    retentionDays: MEMORY_RETENTION_DAYS.DAY_SUMMARIES,
    now,
  }));
  results.push(await cleanupSummariesByPeriod({
    periodType: SUMMARY_PERIOD_TYPES.WEEK,
    retentionDays: MEMORY_RETENTION_DAYS.WEEK_SUMMARIES,
    now,
  }));
  results.push(await cleanupSummariesByPeriod({
    periodType: SUMMARY_PERIOD_TYPES.MONTH,
    retentionDays: MEMORY_RETENTION_DAYS.MONTH_SUMMARIES,
    now,
  }));
  return {
    deletedSummaries: results.reduce((total, item) => total + item.deletedSummaries, 0),
    periods: results,
  };
}

async function cleanupSummariesByPeriod({ periodType, retentionDays, now }) {
  const cutoff = resolveCutoffDate({ retentionDays, now });
  const [result] = await getDbPool().execute(
    `DELETE FROM conversation_summaries
     WHERE period_type = ?
       AND period_start < ?`,
    [periodType, cutoff]
  );
  return {
    periodType,
    retentionDays,
    cutoff,
    deletedSummaries: Number(result.affectedRows || 0),
  };
}

function resolveCutoffDate({ retentionDays, now }) {
  const baseTime = now instanceof Date ? now.getTime() : new Date(now || Date.now()).getTime();
  const safeBaseTime = Number.isFinite(baseTime) ? baseTime : Date.now();
  return new Date(safeBaseTime - Math.max(1, Number(retentionDays || 1)) * 24 * 60 * 60 * 1000);
}
