import { extractAndStoreUserMemories } from "./chat-memory-extraction-service.js";
import { withTransaction } from "./db.js";

export async function extractUserMemoryFromJob(job) {
  const payload = job?.payload && typeof job.payload === "object" ? job.payload : {};
  const messageId = String(payload.messageId || "").trim();
  const userId = String(payload.userId || job?.userId || "").trim();
  const characterId = String(payload.characterId || job?.characterId || "").trim();
  const sessionId = String(payload.sessionId || job?.sessionId || "").trim();
  if (!messageId || !userId || !characterId || !sessionId) {
    throw new Error("memory extraction job missing required messageId, userId, characterId, or sessionId");
  }

  return withTransaction(async (db) => {
    const [rows] = await db.execute(
      `SELECT
         m.id,
         m.session_id,
         m.character_id,
         m.sender_type,
         m.content_type,
         m.text_content,
         s.internal_uid,
         s.character_id AS session_character_id
       FROM chat_messages m
       INNER JOIN chat_sessions s ON s.id = m.session_id
       WHERE m.id = ?
         AND m.session_id = ?
         AND s.internal_uid = ?
       LIMIT 1`,
      [messageId, sessionId, userId]
    );
    const row = rows[0] || null;
    if (!row) {
      throw new Error("memory extraction source message not found");
    }

    const stored = await extractAndStoreUserMemories(db, {
      message: {
        id: row.id,
        sessionId: row.session_id,
        characterId: row.character_id || "",
        senderType: row.sender_type,
        contentType: row.content_type,
        text: row.text_content || "",
      },
      session: {
        id: row.session_id,
        internal_uid: row.internal_uid,
        character_id: row.session_character_id,
      },
      userId,
      characterId,
    });

    return {
      ok: true,
      extractedCount: stored.length,
      memoryIds: stored.map((item) => item.memoryId).filter(Boolean),
    };
  });
}
