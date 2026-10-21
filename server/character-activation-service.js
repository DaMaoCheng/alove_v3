import { getDbPool, withTransaction } from "./db.js";
import { createId } from "./security.js";
import { findCharacterById, findOrCreateUserSession } from "./chat-service-shared.js";

export async function activateUserCharacter(userId, characterId, { db = getDbPool(), sourceType = "user", sourceRef = "manual" } = {}) {
  const normalizedUserId = String(userId || "").trim();
  const normalizedCharacterId = String(characterId || "").trim();
  if (!normalizedUserId || !normalizedCharacterId) throwNotFound();

  const runActivation = async (connection) => activateUserCharacterForDb(connection, {
    userId: normalizedUserId,
    characterId: normalizedCharacterId,
    sourceType,
    sourceRef,
  });

  return isTransactionalConnection(db) ? runActivation(db) : withTransaction(runActivation);
}

export async function activateUserCharacterForDb(db, { userId, characterId, sourceType = "user", sourceRef = "manual" }) {
  const character = await findCharacterById(db, characterId, { userId });
  if (!character) throwNotFound();

  const [existingActivations] = await db.execute(
    `SELECT id, activation_status
     FROM user_character_activations
     WHERE internal_uid = ?
       AND character_id = ?
     LIMIT 1
     FOR UPDATE`,
    [userId, characterId]
  );
  const existingActivation = existingActivations[0] || null;
  const alreadyActivated = String(existingActivation?.activation_status || "").trim().toLowerCase() === "active";

  if (existingActivation && !alreadyActivated) {
    await db.execute(
      `UPDATE user_character_activations
       SET activation_status = 'active',
           source_type = ?,
           source_ref = ?,
           activated_at = NOW(3),
           updated_at = NOW(3)
       WHERE id = ?
       LIMIT 1`,
      [sourceType, sourceRef, existingActivation.id]
    );
  } else if (!existingActivation) {
    const activationId = createId("act");
    await db.execute(
      `INSERT INTO user_character_activations (
         id, internal_uid, character_id, activation_status, source_type, source_ref, activated_at
       ) VALUES (?, ?, ?, 'active', ?, ?, NOW(3))`,
      [activationId, userId, characterId, sourceType, sourceRef]
    );
  }

  const session = await findOrCreateUserSession(db, {
    character,
    userId,
  });

  return {
    ok: true,
    activated: !alreadyActivated,
    alreadyActivated,
    session: mapActivationSession(session),
  };
}

function mapActivationSession(session) {
  return {
    id: session.id,
    characterId: session.character_id,
    title: session.session_title || "",
    lastMessageAt: session.last_message_at,
  };
}

function isTransactionalConnection(db) {
  return typeof db?.beginTransaction === "function" && typeof db?.release === "function";
}

function throwNotFound() {
  const error = new Error("角色不存在或不可访问");
  error.statusCode = 404;
  throw error;
}
