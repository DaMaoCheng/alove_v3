import { indexChatMessage } from "./chat-memory-service.js";
import { getDbPool } from "./db.js";
import {
  USER_SESSION_SOURCE_TYPE,
  buildAttachmentSummary,
  findCharacterById,
  findOrCreateUserSession,
  getNextMessageOrder,
  insertMessage,
  mapSessionRow,
  normalizeAttachmentPayload,
  throwNotFound,
} from "./chat-service-shared.js";

export async function createUserAttachmentMessage({ characterId, userId, attachment }) {
  const normalizedCharacterId = String(characterId || "").trim();
  const normalizedUserId = String(userId || "").trim();
  const normalizedAttachment = normalizeAttachmentPayload(attachment);
  if (!normalizedCharacterId) throwNotFound();
  if (!normalizedUserId) {
    const error = new Error("请先登录");
    error.statusCode = 401;
    throw error;
  }

  return getDbPool().getConnection().then(async (db) => {
    try {
      await db.beginTransaction();
      const character = await findCharacterById(db, normalizedCharacterId, { userId: normalizedUserId });
      if (!character) throwNotFound();

      const session = await findOrCreateUserSession(db, {
        character,
        userId: normalizedUserId,
      });
      const nextOrder = await getNextMessageOrder(db, session.id);
      const message = await insertMessage(db, {
        sessionId: session.id,
        characterId: null,
        senderType: "user",
        senderLabel: "You",
        contentType: "attachment",
        text: buildAttachmentSummary(normalizedAttachment),
        product: normalizedAttachment,
        displayOrder: nextOrder,
        sourceType: USER_SESSION_SOURCE_TYPE,
        sourceRef: "user-attachment",
      });

      await indexChatMessage(db, {
        message,
        session,
        userId: normalizedUserId,
        characterId: normalizedCharacterId,
      });

      await db.execute(
        "UPDATE chat_sessions SET last_message_at = NOW(3), updated_at = NOW(3) WHERE id = ?",
        [session.id]
      );
      await db.commit();

      return {
        ok: true,
        session: mapSessionRow({
          ...session,
          last_message_at: new Date(),
        }),
        items: [message],
      };
    } catch (error) {
      await db.rollback();
      throw error;
    } finally {
      db.release();
    }
  });
}
