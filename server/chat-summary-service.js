import {
  replaceConversationSummaryLinks,
  upsertConversationSummary,
} from "./chat-memory-service.js";
import { SUMMARY_PERIOD_TYPES } from "./chat-memory-taxonomy.js";
import { buildDailySummary, buildRollingSummary } from "./chat-summary-builder.js";
import { getShanghaiDayRange, getSummaryPeriodRange } from "./chat-summary-ranges.js";
import {
  listDailySummarySourceMessages,
  listPeriodDailySummaries,
  listPeriodSummarySourceMessages,
} from "./chat-summary-source-service.js";

export async function refreshDailyConversationSummary(db, {
  userId,
  characterId,
  sessionId,
  now = new Date(),
  textOnly = false,
} = {}) {
  const normalizedUserId = String(userId || "").trim();
  const normalizedCharacterId = String(characterId || "").trim();
  const normalizedSessionId = String(sessionId || "").trim();
  if (!normalizedUserId || !normalizedCharacterId || !normalizedSessionId) return null;

  const range = getShanghaiDayRange(now);
  const messages = await listDailySummarySourceMessages(db, {
    sessionId: normalizedSessionId,
    startAt: range.start,
    endAt: range.end,
    textOnly,
  });
  if (!messages.length) return null;

  const summary = buildDailySummary(messages);
  const summaryId = await upsertConversationSummary(db, {
    userId: normalizedUserId,
    characterId: normalizedCharacterId,
    periodType: SUMMARY_PERIOD_TYPES.DAY,
    periodStart: range.start,
    periodEnd: range.end,
    summaryText: summary.text,
    summaryJson: summary.json,
    sourceMessageCount: messages.length,
    status: "active",
    generatedBy: "rule",
  });

  await replaceConversationSummaryLinks(db, {
    summaryId,
    sourceMessageIds: messages.map((message) => message.id),
    sourceSessionId: normalizedSessionId,
  });

  return {
    id: summaryId,
    periodStart: range.start,
    periodEnd: range.end,
    sourceMessageCount: messages.length,
    summaryText: summary.text,
    summaryJson: summary.json,
  };
}

export async function refreshRollingConversationSummaries(db, {
  userId,
  characterId,
  sessionId,
  now = new Date(),
  textOnly = false,
} = {}) {
  const normalizedUserId = String(userId || "").trim();
  const normalizedCharacterId = String(characterId || "").trim();
  const normalizedSessionId = String(sessionId || "").trim();
  if (!normalizedUserId || !normalizedCharacterId || !normalizedSessionId) return [];

  const results = [];
  const weekly = await refreshPeriodConversationSummary(db, {
    userId: normalizedUserId,
    characterId: normalizedCharacterId,
    sessionId: normalizedSessionId,
    periodType: SUMMARY_PERIOD_TYPES.WEEK,
    now,
    textOnly,
  });
  if (weekly) results.push(weekly);

  const monthly = await refreshPeriodConversationSummary(db, {
    userId: normalizedUserId,
    characterId: normalizedCharacterId,
    sessionId: normalizedSessionId,
    periodType: SUMMARY_PERIOD_TYPES.MONTH,
    now,
    textOnly,
  });
  if (monthly) results.push(monthly);

  return results;
}

export async function refreshConversationSummaryForPeriod(db, {
  userId,
  characterId,
  sessionId,
  periodType,
  now = new Date(),
  textOnly = false,
} = {}) {
  const normalizedPeriodType = String(periodType || "").trim();
  if (normalizedPeriodType === SUMMARY_PERIOD_TYPES.DAY) {
    return refreshDailyConversationSummary(db, {
      userId,
      characterId,
      sessionId,
      now,
      textOnly,
    });
  }
  if (normalizedPeriodType === SUMMARY_PERIOD_TYPES.WEEK || normalizedPeriodType === SUMMARY_PERIOD_TYPES.MONTH) {
    return refreshPeriodConversationSummary(db, {
      userId,
      characterId,
      sessionId,
      periodType: normalizedPeriodType,
      now,
      textOnly,
    });
  }
  return null;
}

async function refreshPeriodConversationSummary(db, {
  userId,
  characterId,
  sessionId,
  periodType,
  now,
  textOnly = false,
} = {}) {
  const range = getSummaryPeriodRange(periodType, now);
  if (!range) return null;

  const messages = await listPeriodSummarySourceMessages(db, {
    sessionId,
    startAt: range.start,
    endAt: range.end,
    textOnly,
  });
  if (!messages.length) return null;

  const dailySummaries = await listPeriodDailySummaries(db, {
    userId,
    characterId,
    startAt: range.start,
    endAt: range.end,
  });
  const summary = buildRollingSummary({
    periodType,
    messages,
    dailySummaries,
  });

  const summaryId = await upsertConversationSummary(db, {
    userId,
    characterId,
    periodType,
    periodStart: range.start,
    periodEnd: range.end,
    summaryText: summary.text,
    summaryJson: summary.json,
    sourceMessageCount: messages.length,
    status: "active",
    generatedBy: "rule",
  });

  await replaceConversationSummaryLinks(db, {
    summaryId,
    sourceMessageIds: messages.map((message) => message.id),
    sourceSessionId: sessionId,
  });

  return {
    id: summaryId,
    periodType,
    periodStart: range.start,
    periodEnd: range.end,
    sourceMessageCount: messages.length,
    summaryText: summary.text,
    summaryJson: summary.json,
  };
}
