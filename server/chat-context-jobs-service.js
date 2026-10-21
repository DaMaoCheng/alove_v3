import { backfillChatMessageIndexForSession, markExpiredPromptMemories } from "./chat-memory-service.js";
import { buildChatWakeUpContext } from "./chat-wakeup-context-service.js";
import { MEMORY_JOB_TYPES, enqueueMemoryJob } from "./memory-job-service.js";

export async function buildUserPromptContext(db, { userId, characterId, sessionId = "", queryText = "", recentMessages = [] }) {
  await markExpiredPromptMemories(db, {
    userId,
    characterId,
  });
  await backfillChatMessageIndexForSession(db, {
    userId,
    characterId,
    sessionId,
    limit: 240,
  });
  return buildChatWakeUpContext(db, {
    userId,
    characterId,
    sessionId,
    queryText,
    excludeMessageIds: recentMessages.map((message) => message.id),
  });
}

export async function enqueueSummaryRefreshJobs(db, { userId, characterId, sessionId, textOnly = false }) {
  const basePayload = {
    userId,
    characterId,
    sessionId,
    textOnly: Boolean(textOnly),
  };
  await enqueueMemoryJob({
    userId,
    characterId,
    sessionId,
    jobType: MEMORY_JOB_TYPES.REBUILD_DAILY_SUMMARY,
    priority: 70,
    payload: basePayload,
  }, db);
  await enqueueMemoryJob({
    userId,
    characterId,
    sessionId,
    jobType: MEMORY_JOB_TYPES.REBUILD_WEEKLY_SUMMARY,
    priority: 80,
    payload: basePayload,
  }, db);
  await enqueueMemoryJob({
    userId,
    characterId,
    sessionId,
    jobType: MEMORY_JOB_TYPES.REBUILD_MONTHLY_SUMMARY,
    priority: 90,
    payload: basePayload,
  }, db);
}

export async function enqueueUserMemoryExtractionJob(db, { messageId, userId, characterId, sessionId }) {
  await enqueueMemoryJob({
    userId,
    characterId,
    sessionId,
    jobType: MEMORY_JOB_TYPES.EXTRACT_USER_MEMORY,
    priority: 65,
    payload: {
      messageId,
      userId,
      characterId,
      sessionId,
    },
  }, db);
}
