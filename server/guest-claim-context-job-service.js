import { backfillChatMessageIndexForSession } from "./chat-message-index-service.js";
import { enqueueSummaryRefreshJobs } from "./chat-context-jobs-service.js";
import { withTransaction } from "./db.js";

export async function backfillClaimedGuestContextFromJob(job) {
  const payload = job?.payload && typeof job.payload === "object" ? job.payload : {};
  const userId = String(payload.userId || job?.userId || "").trim();
  const characterId = String(payload.characterId || job?.characterId || "").trim();
  const sessionId = String(payload.sessionId || job?.sessionId || "").trim();
  if (!userId || !characterId || !sessionId) {
    throw new Error("claimed guest context job missing required userId, characterId, or sessionId");
  }

  return withTransaction(async (db) => {
    const [sessionRows] = await db.execute(
      `SELECT id
       FROM chat_sessions
       WHERE id = ?
         AND internal_uid = ?
         AND character_id = ?
         AND source_type = 'user'
         AND session_status = 'active'
       LIMIT 1
       FOR UPDATE`,
      [sessionId, userId, characterId]
    );
    if (!sessionRows[0]) {
      const error = new Error("claimed guest context session is no longer available");
      error.retryable = false;
      throw error;
    }

    const indexedMessageCount = await backfillChatMessageIndexForSession(db, {
      sessionId,
      userId,
      characterId,
      limit: 240,
      textOnly: true,
    });
    await enqueueSummaryRefreshJobs(db, {
      sessionId,
      userId,
      characterId,
      textOnly: true,
    });

    return {
      ok: true,
      indexedMessageCount,
      summaryJobCount: 3,
    };
  });
}
