import { getDbPool } from "./db.js";
import { createId } from "./security.js";
import { throwNotFound } from "./chat-message-payload-utils.js";
import { resolveInitialSessionLanguagePreference } from "./chat-language-preference-service.js";

export const USER_SESSION_SOURCE_TYPE = "user";

export async function findLatestUserSession({ characterId, userId }) {
  return findLatestUserSessionForDb(getDbPool(), { characterId, userId });
}

export async function findLatestUserSessionForDb(db, { characterId, userId }) {
  await lockUserSessionOwnerForDb(db, userId);
  const [sessions] = await db.execute(
    `SELECT id, internal_uid, guest_session_id, character_id, session_title, session_status, source_type, source_ref, preferred_language, last_message_at
     FROM chat_sessions
     WHERE character_id = ?
       AND internal_uid = ?
       AND session_status = 'active'
       AND source_type = ?
     ORDER BY last_message_at DESC, updated_at DESC
     LIMIT 1`,
    [characterId, userId, USER_SESSION_SOURCE_TYPE]
  );
  return sessions[0] || null;
}

export async function findCharacterById(db, characterId, { userId = "" } = {}) {
  const normalizedUserId = String(userId || "").trim();
  const accessClause = normalizedUserId
    ? "AND (visibility = 'public' OR owner_uid = ?)"
    : "AND visibility = 'public'";
  const values = normalizedUserId ? [characterId, normalizedUserId] : [characterId];
  const [rows] = await db.execute(
    `SELECT
       id,
       owner_uid,
       site_id,
       category_id,
       name,
       role_title,
       short_bio,
       opening_line,
       localized_content,
       persona_prompt,
       speaking_style,
       voice_provider,
       voice_id,
       voice_style,
       voice_sample_url,
       source_type,
       source_ref,
       tags_json,
       profile_json
     FROM ai_characters
     WHERE id = ?
       ${accessClause}
       AND character_status = 'published'
     LIMIT 1`,
    values
  );
  return rows[0] || null;
}

export async function findOrCreateUserSession(db, { character, userId }) {
  const existing = await findLatestUserSessionForDb(db, { characterId: character.id, userId });
  if (existing) return existing;

  const sessionId = createId("chat");
  const title = `${character.name} conversation`;
  const [[site]] = await db.execute(
    `SELECT s.default_language
     FROM users u
     LEFT JOIN sites s ON s.id = u.site_id AND s.site_status = 'active'
     WHERE u.id = ?
     LIMIT 1`,
    [userId]
  );
  const initialLanguage = await resolveInitialSessionLanguagePreference(db, {
    character,
    userId,
    siteLanguage: site?.default_language,
  });
  await db.execute(
    `INSERT INTO chat_sessions (
       id, internal_uid, character_id, session_title, session_status, source_type, source_ref, preferred_language, last_message_at
     ) VALUES (?, ?, ?, ?, 'active', ?, 'user-chat', ?, NOW(3))`,
    [sessionId, userId, character.id, title, USER_SESSION_SOURCE_TYPE, initialLanguage?.label || "English"]
  );
  return {
    id: sessionId,
    internal_uid: userId,
    guest_session_id: null,
    character_id: character.id,
    session_title: title,
    session_status: "active",
    source_type: USER_SESSION_SOURCE_TYPE,
    source_ref: "user-chat",
    preferred_language: initialLanguage?.label || "English",
    last_message_at: new Date(),
  };
}

export async function lockUserSessionOwnerForDb(db, userId) {
  const normalizedUserId = String(userId || "").trim();
  if (!normalizedUserId) return;
  await db.execute(
    "SELECT id FROM users WHERE id = ? LIMIT 1 FOR UPDATE",
    [normalizedUserId]
  );
}

export function mapSessionRow(session) {
  return {
    id: session.id,
    characterId: session.character_id,
    title: session.session_title || "",
    status: session.session_status,
    sourceType: session.source_type || "",
    sourceRef: session.source_ref || "",
    preferredLanguage: session.preferred_language || "",
    lastMessageAt: session.last_message_at,
  };
}

export { throwNotFound };
