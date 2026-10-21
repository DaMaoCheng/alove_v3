import {
  buildPromptMemoryBlock,
  getLatestConversationSummary,
  listPromptMemoryRecords,
} from "./chat-memory-service.js";
import { findRelevantHistoryMessages } from "./chat-history-retrieval-service.js";

export async function buildChatWakeUpContext(db, {
  userId,
  characterId,
  sessionId = "",
  queryText = "",
  excludeMessageIds = [],
} = {}) {
  const memoryRows = await listPromptMemoryRecords(db, {
    userId,
    characterId,
    limit: 12,
  });
  const dailySummary = await getLatestConversationSummary(db, { userId, characterId, periodType: "day" });
  const weeklySummary = await getLatestConversationSummary(db, { userId, characterId, periodType: "week" });
  const monthlySummary = await getLatestConversationSummary(db, { userId, characterId, periodType: "month" });
  const relevantHistory = await findRelevantHistoryMessages(db, {
    userId,
    characterId,
    sessionId,
    queryText,
    excludeMessageIds,
    limit: 4,
  });

  const rawEpisodeRows = memoryRows.filter((row) => String(row.memory_type || "").trim() === "raw_episode");
  const nonRawMemoryRows = memoryRows.filter((row) => String(row.memory_type || "").trim() !== "raw_episode");
  const stableMemoryRows = nonRawMemoryRows.filter((row) => !row.expires_at);
  const temporalMemoryRows = nonRawMemoryRows.filter((row) => row.expires_at);
  const wakeUpContext = buildWakeUpText({
    stableMemoryBlock: buildPromptMemoryBlock(stableMemoryRows),
    temporalMemoryBlock: buildPromptMemoryBlock(temporalMemoryRows),
    rawEpisodeBlock: buildPromptMemoryBlock(rawEpisodeRows),
    dailySummary,
    weeklySummary,
    monthlySummary,
    relevantHistory,
  });

  return {
    memoryRows,
    memoryBlock: buildPromptMemoryBlock(memoryRows),
    stableMemoryBlock: buildPromptMemoryBlock(stableMemoryRows),
    temporalMemoryBlock: buildPromptMemoryBlock(temporalMemoryRows),
    rawEpisodeBlock: buildPromptMemoryBlock(rawEpisodeRows),
    dailySummary,
    weeklySummary,
    monthlySummary,
    relevantHistory,
    wakeUpContext,
  };
}

function buildWakeUpText({
  stableMemoryBlock = "",
  temporalMemoryBlock = "",
  rawEpisodeBlock = "",
  dailySummary = null,
  weeklySummary = null,
  monthlySummary = null,
  relevantHistory = [],
} = {}) {
  const lines = [];
  if (stableMemoryBlock) {
    lines.push("Stable user profile:");
    lines.push(stableMemoryBlock);
  }
  if (temporalMemoryBlock) {
    lines.push("Recent temporary context:");
    lines.push(temporalMemoryBlock);
  }
  if (rawEpisodeBlock) {
    lines.push("Key raw episodes:");
    lines.push(rawEpisodeBlock);
  }
  appendSummary(lines, "Latest daily summary", dailySummary);
  appendSummary(lines, "Latest weekly summary", weeklySummary);
  appendSummary(lines, "Latest monthly summary", monthlySummary);
  const historyLines = (Array.isArray(relevantHistory) ? relevantHistory : [])
    .slice(0, 4)
    .map((message) => {
      const role = message.senderType === "user" ? "User" : "Character";
      const text = safeString(message.text);
      return text ? `${role}: ${text}` : "";
    })
    .filter(Boolean);
  if (historyLines.length) {
    lines.push("Relevant older messages:");
    lines.push(...historyLines);
  }
  return lines.join("\n");
}

function appendSummary(lines, label, row) {
  const text = safeString(row?.summary_text || row?.summaryText);
  if (!text) return;
  lines.push(`${label}:`);
  lines.push(text);
}

function safeString(value) {
  return String(value || "").trim();
}
