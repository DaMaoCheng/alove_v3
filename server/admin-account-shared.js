import { getDbPool } from "./db.js";
import { mapAccountRow } from "./admin-account-mapper.js";

export function normalizeAccountId(accountId) {
  const value = String(accountId || "").trim();
  if (!value) throwNotFound("账号不存在");
  return value;
}

export async function assertAccountExists(userId) {
  const [[row]] = await getDbPool().execute("SELECT id FROM users WHERE id = ? LIMIT 1", [userId]);
  if (!row) throwNotFound("账号不存在");
}

export async function getAdminAccountById(userId) {
  const [rows] = await getDbPool().execute(
    `${accountSelectSql()}
     WHERE u.id = ?
     LIMIT 1`,
    [userId]
  );
  const row = rows[0] || null;
  if (!row) throwNotFound("账号不存在");
  return mapAccountRow(row);
}

export function accountSelectSql() {
  return `SELECT
       u.id,
       u.username,
       u.nickname,
       u.email,
       u.account_status,
       u.account_status_note,
       u.account_type,
       u.site_id,
       s.name AS site_name,
       s.slug AS site_slug,
       u.created_at,
       u.last_seen_at,
       u.last_ip,
       u.last_ip_region,
       u.last_ip_at,
       u.last_login_user_agent,
       latest_oauth.avatar_url,
       COALESCE(b.balance, 0) AS balance,
       COALESCE(b.recharge_balance, 0) AS recharge_balance,
       COALESCE(b.bonus_balance, 0) AS bonus_balance,
       COALESCE(recharge.total_recharge, 0) AS total_recharge,
       COALESCE(spend.total_spent_credits, 0) AS total_spent_credits,
       COALESCE(chat.total_conversations, 0) AS total_conversations,
       COALESCE(chat.recent_conversations, 0) AS recent_conversations,
       COALESCE(active_chars.active_character_count, 0) AS active_character_count,
       COALESCE(created_chars.created_character_count, 0) AS created_character_count,
       source_guest.external_source_context_json AS external_source_context_json
     FROM users u
     LEFT JOIN sites s ON s.id = u.site_id
     LEFT JOIN billing_accounts b ON b.internal_uid = u.id
     LEFT JOIN (
       SELECT ranked.internal_uid, ranked.avatar_url
       FROM (
         SELECT internal_uid, avatar_url,
                ROW_NUMBER() OVER (PARTITION BY internal_uid ORDER BY updated_at DESC, id DESC) AS row_num
         FROM oauth_accounts
         WHERE avatar_url IS NOT NULL AND avatar_url <> ''
       ) ranked
       WHERE ranked.row_num = 1
     ) latest_oauth ON latest_oauth.internal_uid = u.id
     LEFT JOIN (
       SELECT internal_uid, SUM(rmb_amount) AS total_recharge
       FROM recharge_orders
       WHERE status IN ('paid', 'settled')
       GROUP BY internal_uid
     ) recharge ON recharge.internal_uid = u.id
     LEFT JOIN (
       SELECT internal_uid, SUM(charged) AS total_spent_credits
       FROM billing_logs
       WHERE charged > 0
       GROUP BY internal_uid
     ) spend ON spend.internal_uid = u.id
     LEFT JOIN (
       SELECT
         s.internal_uid,
         COUNT(DISTINCT m.id) AS total_conversations,
         COUNT(DISTINCT CASE WHEN m.sent_at >= DATE_SUB(NOW(3), INTERVAL 7 DAY) THEN m.id END) AS recent_conversations
       FROM chat_sessions s
       LEFT JOIN chat_messages m ON m.session_id = s.id
       WHERE s.internal_uid IS NOT NULL
         AND s.session_status = 'active'
         AND s.source_type = 'user'
       GROUP BY s.internal_uid
     ) chat ON chat.internal_uid = u.id
     LEFT JOIN (
       SELECT internal_uid, COUNT(*) AS active_character_count
       FROM user_character_activations
       WHERE activation_status = 'active'
       GROUP BY internal_uid
     ) active_chars ON active_chars.internal_uid = u.id
     LEFT JOIN (
       SELECT owner_uid, COUNT(*) AS created_character_count
       FROM ai_characters
       WHERE owner_uid IS NOT NULL
       GROUP BY owner_uid
     ) created_chars ON created_chars.owner_uid = u.id
     LEFT JOIN (
       SELECT ranked.claimed_user_id, ranked.external_source_context_json
       FROM (
         SELECT
           guest.claimed_user_id,
           guest.external_source_context_json,
           ROW_NUMBER() OVER (
             PARTITION BY guest.claimed_user_id
             ORDER BY guest.updated_at DESC, guest.claimed_at DESC, guest.id DESC
           ) AS row_num
         FROM guest_sessions guest
         WHERE guest.claimed_user_id IS NOT NULL
           AND guest.claimed_user_id <> ''
           AND guest.session_status = 'claimed'
           AND guest.external_source_context_json IS NOT NULL
       ) ranked
       WHERE ranked.row_num = 1
     ) source_guest ON source_guest.claimed_user_id = u.id`;
}

export function throwUserError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  throw error;
}

export function throwNotFound(message) {
  const error = new Error(message);
  error.statusCode = 404;
  throw error;
}
