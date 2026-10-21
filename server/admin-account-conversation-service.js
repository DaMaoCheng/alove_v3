import { getDbPool } from "./db.js";
import { mapConversationMessageRow, mapConversationRow } from "./admin-account-mapper.js";
import { assertAccountExists, normalizeAccountId, throwNotFound } from "./admin-account-shared.js";
import { CHAT_RETENTION_DAYS } from "./chat-retention-policy.js";

const CONVERSATION_SEGMENT_SEPARATOR = "::";
const SEGMENT_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export async function listAdminAccountConversations(accountId, { query = "" } = {}) {
  const userId = normalizeAccountId(accountId);
  const normalizedQuery = String(query || "").trim();
  await assertAccountExists(userId);

  const params = [CHAT_RETENTION_DAYS.ADMIN_CONVERSATION_DEFAULT, CHAT_RETENTION_DAYS.ADMIN_CONVERSATION_DEFAULT, userId];
  let queryWhere = "";
  if (normalizedQuery) {
    queryWhere = `AND (
      c.name LIKE ?
      OR c.role_title LIKE ?
      OR EXISTS (
        SELECT 1
        FROM chat_messages qm
        WHERE qm.session_id = s.id
          AND DATE_FORMAT(qm.sent_at, '%Y-%m-%d') = DATE_FORMAT(m.sent_at, '%Y-%m-%d')
          AND qm.sent_at >= DATE_SUB(NOW(3), INTERVAL ? DAY)
          AND qm.text_content LIKE ?
      )
    )`;
    const like = `%${normalizedQuery}%`;
    params.push(like, like, CHAT_RETENTION_DAYS.ADMIN_CONVERSATION_DEFAULT, like);
  }

  const [rows] = await getDbPool().execute(
     `SELECT
       CONCAT(s.id, ?, latest.segment_date) AS id,
       s.character_id,
       s.session_title,
       MAX(m.sent_at) AS last_message_at,
       c.name AS character_name,
       c.role_title,
       c.avatar_url,
       latest.text_content AS latest_text,
       latest.sender_type AS latest_sender_type,
       COUNT(DISTINCT m.id) AS message_count,
       COUNT(DISTINCT CASE WHEN m.sender_type = 'user' THEN m.id END) AS user_message_count
     FROM chat_sessions s
     INNER JOIN ai_characters c ON c.id = s.character_id
     INNER JOIN chat_messages m
       ON m.session_id = s.id
      AND m.sent_at >= DATE_SUB(NOW(3), INTERVAL ? DAY)
     LEFT JOIN (
       SELECT ranked.session_id, ranked.segment_date, ranked.text_content, ranked.sender_type
       FROM (
         SELECT
           cm.session_id,
           DATE_FORMAT(cm.sent_at, '%Y-%m-%d') AS segment_date,
           cm.text_content,
           cm.sender_type,
           ROW_NUMBER() OVER (
             PARTITION BY cm.session_id, DATE_FORMAT(cm.sent_at, '%Y-%m-%d')
             ORDER BY cm.display_order DESC, cm.sent_at DESC
           ) AS row_num
         FROM chat_messages cm
         WHERE cm.sent_at >= DATE_SUB(NOW(3), INTERVAL ? DAY)
       ) ranked
       WHERE ranked.row_num = 1
     ) latest
       ON latest.session_id = s.id
      AND latest.segment_date = DATE_FORMAT(m.sent_at, '%Y-%m-%d')
     WHERE s.internal_uid = ?
       AND s.session_status = 'active'
       AND s.source_type = 'user'
       ${queryWhere}
     GROUP BY s.id, latest.segment_date, s.character_id, s.session_title,
       c.name, c.role_title, c.avatar_url, latest.text_content, latest.sender_type
     HAVING COUNT(DISTINCT m.id) > 0
     ORDER BY MAX(m.sent_at) DESC
     LIMIT 100`,
    [CONVERSATION_SEGMENT_SEPARATOR, ...params]
  );

  return {
    ok: true,
    items: rows.map(mapConversationRow),
  };
}

export async function getAdminAccountConversation(accountId, sessionId) {
  const userId = normalizeAccountId(accountId);
  const { sessionId: normalizedSessionId, segmentDate } = parseConversationSegmentId(sessionId);
  if (!normalizedSessionId) throwNotFound("对话不存在");

  const [[session]] = await getDbPool().execute(
    `SELECT
       s.id,
       s.character_id,
       s.session_title,
       COALESCE(s.last_message_at, s.updated_at, s.created_at) AS last_message_at,
       c.name AS character_name,
       c.role_title,
       c.avatar_url
     FROM chat_sessions s
     INNER JOIN ai_characters c ON c.id = s.character_id
     WHERE s.id = ? AND s.internal_uid = ? AND s.session_status = 'active'
     LIMIT 1`,
    [normalizedSessionId, userId]
  );
  if (!session) throwNotFound("对话不存在");

  const messageParams = [normalizedSessionId];
  let messageDateWhere = "";
  if (segmentDate) {
    messageDateWhere = "AND m.sent_at >= ? AND m.sent_at < DATE_ADD(?, INTERVAL 1 DAY)";
    messageParams.push(segmentDate, segmentDate);
  }

  const [messages] = await getDbPool().execute(
    `SELECT
       m.id,
       m.sender_type,
       m.sender_label,
       m.content_type,
       m.text_content,
       m.product_payload_json,
       m.delivery_status,
       m.sent_at,
       m.display_order,
       img.id AS image_asset_id,
       img.status AS image_status,
       img.storage_path AS image_storage_path,
       img.protected_path AS image_protected_path,
       img.width AS image_width,
       img.height AS image_height,
       img.bytes AS image_bytes,
       img.mime_type AS image_mime_type,
       img.error_message AS image_error_message
     FROM chat_messages m
     LEFT JOIN chat_image_assets img ON img.message_id = m.id
     WHERE m.session_id = ?
       ${messageDateWhere}
     ORDER BY m.display_order ASC, m.sent_at ASC`,
    messageParams
  );

  return {
    ok: true,
    item: {
      ...mapConversationRow({
        ...session,
        id: segmentDate ? buildConversationSegmentId(normalizedSessionId, segmentDate) : normalizedSessionId,
        last_message_at: messages[messages.length - 1]?.sent_at || session.last_message_at,
        latest_text: "",
        latest_sender_type: "",
        message_count: messages.length,
        user_message_count: messages.filter((message) => message.sender_type === "user").length,
      }),
      messages: messages.map(mapConversationMessageRow),
    },
  };
}

function buildConversationSegmentId(sessionId, segmentDate) {
  return `${sessionId}${CONVERSATION_SEGMENT_SEPARATOR}${segmentDate}`;
}

function parseConversationSegmentId(value) {
  const normalized = String(value || "").trim();
  const separatorIndex = normalized.lastIndexOf(CONVERSATION_SEGMENT_SEPARATOR);
  if (separatorIndex < 0) return { sessionId: normalized, segmentDate: "" };
  const sessionId = normalized.slice(0, separatorIndex).trim();
  const segmentDate = normalized.slice(separatorIndex + CONVERSATION_SEGMENT_SEPARATOR.length).trim();
  if (!SEGMENT_DATE_PATTERN.test(segmentDate)) return { sessionId: normalized, segmentDate: "" };
  return { sessionId, segmentDate };
}
