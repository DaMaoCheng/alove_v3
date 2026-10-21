import { CHAT_RETENTION_DAYS } from "./chat-retention-policy.js";
import { getDbPool, withTransaction } from "./db.js";
import { ensureOpeningMessageWithVoiceForSession } from "./chat-opening-message-service.js";
import {
  USER_SESSION_SOURCE_TYPE,
  getMessagesForSession,
  findLatestUserSession,
  findCharacterById,
  mapContactRow,
  mapMessageRow,
  throwNotFound,
} from "./chat-service-shared.js";
import { getChatImageQuota, CHAT_IMAGE_WINDOW_LIMIT } from "./chat-image-quota-service.js";

export async function getMessagesForCharacter({ characterId, userId }) {
  const normalizedId = String(characterId || "").trim();
  if (!normalizedId) throwNotFound();

  const userSession = userId ? await findLatestUserSession({ characterId: normalizedId, userId }) : null;
  if (userSession) {
    const character = await findCharacterById(getDbPool(), normalizedId, { userId });
    await withTransaction((db) => ensureOpeningMessageWithVoiceForSession(db, {
      sessionId: userSession.id,
      character,
      characterId: userSession.character_id || normalizedId,
      senderLabel: character?.name || userSession.session_title || "AIOVE Character",
      openingLine: character?.opening_line || character?.openingLine || "",
      userId,
      preferredLanguage: userSession.preferred_language,
    }));
    return {
      ...(await getMessagesForSession(userSession)),
      imageQuota: mapFormalImageQuota(await getChatImageQuota(getDbPool(), { userId })),
    };
  }
  if (userId) {
    return {
      ok: true,
      session: null,
      items: [],
      imageQuota: mapFormalImageQuota(await getChatImageQuota(getDbPool(), { userId })),
    };
  }

  return getDemoMessagesForCharacter(normalizedId);
}

function mapFormalImageQuota(quota = {}) {
  const used = Math.max(0, Number(quota.count || 0));
  const limit = CHAT_IMAGE_WINDOW_LIMIT;
  return {
    mode: "account",
    limit,
    used,
    remaining: Math.max(0, limit - used),
    pending: Math.max(0, Number(quota.pending || 0)),
    windowExpiresAt: quota.windowExpiresAt ? new Date(quota.windowExpiresAt).toISOString() : null,
  };
}

export async function listUserChatContacts(userId, { siteSlug = "", accountType = "" } = {}) {
  const normalizedUserId = String(userId || "").trim();
  if (!normalizedUserId) {
    const error = new Error("请先登录");
    error.statusCode = 401;
    throw error;
  }
  const site = await resolveActiveSite(siteSlug);
  const isAdmin = String(accountType || "").trim().toLowerCase() === "admin";
  const creatorSiteClause = isAdmin ? "" : "AND (c.category_id <> 'creator' OR c.site_id = ?)";
  const queryParams = [normalizedUserId, USER_SESSION_SOURCE_TYPE, normalizedUserId, normalizedUserId];
  if (!isAdmin) queryParams.push(site.id);

  const [rows] = await getDbPool().execute(
    `SELECT
       s.id AS session_id,
       a.character_id,
       COALESCE(s.session_title, CONCAT(c.name, ' conversation')) AS session_title,
       COALESCE(s.last_message_at, a.activated_at) AS last_message_at,
       c.name,
       c.role_title,
       c.avatar_url,
       c.visibility,
       c.character_status,
       c.owner_uid,
       c.owner_uid = ? AS is_own_character,
       latest.sender_type AS last_sender_type,
       latest.text_content AS last_text,
       latest.content_type AS last_content_type,
       latest.product_payload_json AS last_payload_json,
       latest.source_ref AS last_source_ref
     FROM user_character_activations a
     INNER JOIN ai_characters c ON c.id = a.character_id
     LEFT JOIN (
       SELECT ranked.*
       FROM (
         SELECT
           s.id,
           s.internal_uid,
           s.character_id,
           s.session_title,
           s.last_message_at,
           s.updated_at,
           ROW_NUMBER() OVER (
             PARTITION BY s.internal_uid, s.character_id
             ORDER BY s.last_message_at DESC, s.updated_at DESC
           ) AS row_num
         FROM chat_sessions s
         WHERE s.session_status = 'active'
           AND s.source_type = ?
       ) ranked
       WHERE ranked.row_num = 1
     ) s ON s.internal_uid = a.internal_uid AND s.character_id = a.character_id
     LEFT JOIN (
       SELECT ranked.session_id, ranked.sender_type, ranked.content_type, ranked.text_content, ranked.product_payload_json, ranked.source_ref
       FROM (
         SELECT
           m.session_id,
           m.sender_type,
           m.content_type,
           m.text_content,
           m.product_payload_json,
           m.source_ref,
           ROW_NUMBER() OVER (
             PARTITION BY m.session_id
             ORDER BY m.display_order DESC, m.sent_at DESC
           ) AS row_num
         FROM chat_messages m
         WHERE m.sent_at >= DATE_SUB(NOW(3), INTERVAL ${CHAT_RETENTION_DAYS.USER_VISIBLE_MESSAGES} DAY)
       ) ranked
       WHERE ranked.row_num = 1
     ) latest ON latest.session_id = s.id
     WHERE a.internal_uid = ?
       AND a.activation_status = 'active'
       AND (c.visibility = 'public' OR c.owner_uid = ?)
       ${creatorSiteClause}
       AND COALESCE(latest.source_ref, '') <> 'placeholder-reply'
     ORDER BY COALESCE(s.last_message_at, a.activated_at) DESC, a.updated_at DESC`,
    queryParams
  );

  return {
    ok: true,
    items: rows.map(mapContactRow),
  };
}

async function resolveActiveSite(siteSlug = "") {
  const normalizedSlug = normalizeSiteSlug(siteSlug) || "gogoalshop";
  const [rows] = await getDbPool().execute(
    `SELECT id, slug
     FROM sites
     WHERE slug = ? AND site_status = 'active'
     LIMIT 1`,
    [normalizedSlug]
  );
  if (rows[0]) return rows[0];
  const [defaultRows] = await getDbPool().execute(
    `SELECT id, slug
     FROM sites
     WHERE is_default = 1 AND site_status = 'active'
     ORDER BY updated_at DESC
     LIMIT 1`
  );
  return defaultRows[0] || { id: "site_gg", slug: "gogoalshop" };
}

function normalizeSiteSlug(value = "") {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 96);
}

export async function getDemoMessagesForCharacter(characterId) {
  const normalizedId = String(characterId || "").trim();
  if (!normalizedId) throwNotFound();

  const [sessions] = await getDbPool().execute(
    `SELECT id, character_id, session_title, session_status, source_type, source_ref, preferred_language, last_message_at
     FROM chat_sessions
     WHERE character_id = ?
       AND session_status = 'active'
       AND source_type = 'system'
       AND source_ref = 'demo-chat-seed'
     ORDER BY last_message_at DESC, updated_at DESC
     LIMIT 1`,
    [normalizedId]
  );

  const session = sessions[0] || null;
  if (!session) {
    return {
      ok: true,
      session: null,
      items: [],
    };
  }

  const [messages] = await getDbPool().execute(
    `SELECT
       m.id,
       m.session_id,
       m.character_id,
       m.sender_type,
       m.sender_label,
       m.content_type,
       m.text_content,
       m.voice_asset_id,
       m.product_payload_json,
       m.display_order,
       m.delivery_status,
       m.sent_at,
       v.duration_seconds AS voice_duration_seconds,
       v.audio_bytes AS voice_audio_bytes,
       v.output_format AS voice_output_format,
       v.audio_url AS voice_audio_url,
       v.waveform_json AS voice_waveform_json
     FROM chat_messages m
     LEFT JOIN character_voice_assets v ON v.id = m.voice_asset_id
     WHERE m.session_id = ?
     ORDER BY m.display_order ASC, m.sent_at ASC`,
    [session.id]
  );

  return {
    ok: true,
    session: {
      id: session.id,
      characterId: session.character_id,
      title: session.session_title || "",
      status: session.session_status,
      sourceType: session.source_type || "",
      sourceRef: session.source_ref || "",
      lastMessageAt: session.last_message_at,
    },
    items: messages.map(mapMessageRow),
  };
}
