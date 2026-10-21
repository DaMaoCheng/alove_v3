import { getDbPool } from "./db.js";
import { getGuestVisitorContinuity } from "./guest-visitor-service.js";
import { getGuestContinuityCandidates } from "./guest-continuity-candidates-service.js";
import { mapAdminSourcePage, mapConversationMessageRow, mapConversationRow } from "./admin-account-mapper.js";
import { CHAT_RETENTION_DAYS } from "./chat-retention-policy.js";
import { createPublicError } from "./public-error-utils.js";
import { GUEST_MESSAGE_LIMIT } from "./guest-message-quota-policy.js";
import { appendAdminDateFilter } from "./admin-date-filter.js";
import { describeUserAgent } from "./device-info-service.js";

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
const MAX_QUERY_LENGTH = 160;
const MAX_CONVERSATION_MESSAGES = 200;
const MESSAGE_WINDOW_MS = 24 * 60 * 60 * 1000;
const CONVERSATION_SEGMENT_SEPARATOR = "::";
const SEGMENT_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export async function listAdminGuestSessions({ page = 1, limit = DEFAULT_LIMIT, query = "", status = "all", site = "all", dateRange = "all", startDate = "", endDate = "" } = {}) {
  const requestedPage = normalizePositiveInteger(page, 1);
  const safeLimit = Math.min(MAX_LIMIT, normalizePositiveInteger(limit, DEFAULT_LIMIT));
  const normalizedQuery = String(query || "").trim().slice(0, MAX_QUERY_LENGTH);
  const normalizedStatus = normalizeGuestStatusFilter(status);
  const normalizedSite = normalizeSiteFilter(site);
  const joinsSql = `
    LEFT JOIN sites site ON site.id = g.site_id
    LEFT JOIN ai_characters mascot ON mascot.id = g.mascot_character_id
    LEFT JOIN users claimed ON claimed.id = g.claimed_user_id`;
  const activityJoinsSql = guestActivityJoinsSql();
  const { where, params } = buildGuestFilters({ normalizedQuery, normalizedStatus, normalizedSite, dateRange, startDate, endDate });
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const [[countRow]] = await getDbPool().execute(
    `SELECT COUNT(*) AS total
     FROM guest_sessions g
     ${joinsSql}
     ${activityJoinsSql}
     ${whereSql}`,
    params
  );
  const total = Number(countRow?.total || 0);
  const pages = Math.max(1, Math.ceil(total / safeLimit));
  const safePage = Math.min(requestedPage, pages);
  const offset = (safePage - 1) * safeLimit;

  const [rows] = await getDbPool().execute(
    `SELECT
       g.id,
       g.site_id,
       site.name AS site_name,
       site.slug AS site_slug,
       g.mascot_character_id,
       mascot.name AS character_name,
       mascot.role_title,
       mascot.avatar_url,
       g.chat_session_id,
       g.target_chat_session_id,
       g.last_ip,
       g.last_ip_region,
       g.last_ip_at,
       g.last_user_agent,
       g.session_status,
       g.message_window_started_at,
       g.message_window_count,
       COALESCE(guest_quota.current_quota_message_count, 0) AS current_quota_message_count,
       g.claimed_user_id,
       g.external_source_context_json,
       g.claimed_at,
       claimed.email AS claimed_email,
       claimed.username AS claimed_username,
       claimed.nickname AS claimed_nickname,
       g.expires_at,
       g.created_at,
       g.updated_at,
       entitlement.entitlement_status,
       entitlement.asset_id AS entitlement_asset_id,
       guest_activity.last_message_at,
       COALESCE(guest_activity.user_message_count, 0) AS user_message_count,
       COALESCE(guest_activity.character_conversation_count, 0) AS character_conversation_count,
       COALESCE(guest_activity.product_message_count, 0) AS product_message_count,
       COALESCE(guest_activity.voice_input_count, 0) AS voice_input_count,
       COALESCE(guest_activity.attachment_message_count, 0) AS attachment_message_count,
       COALESCE(call_activity.call_count, 0) AS call_count,
       COALESCE(call_activity.call_duration_milliseconds, 0) AS call_duration_milliseconds,
       COALESCE(call_activity.call_turn_count, 0) AS call_turn_count,
       call_activity.last_call_at
     FROM guest_sessions g
     ${joinsSql}
     LEFT JOIN guest_image_entitlements entitlement ON entitlement.guest_session_id = g.id
     LEFT JOIN (
       SELECT guest_session_id,
              MAX(CASE
                WHEN message_window_started_at > DATE_SUB(NOW(3), INTERVAL 24 HOUR)
                  THEN message_window_count
                ELSE 0
              END) AS current_quota_message_count
       FROM guest_character_sessions
       GROUP BY guest_session_id
     ) guest_quota ON guest_quota.guest_session_id = g.id
     ${activityJoinsSql}
     ${whereSql}
     ORDER BY COALESCE(GREATEST(guest_activity.last_message_at, call_activity.last_call_at), guest_activity.last_message_at, call_activity.last_call_at, g.claimed_at, g.updated_at, g.created_at) DESC, g.id DESC
     LIMIT ${safeLimit} OFFSET ${offset}`,
    params
  );

  const [visitorContinuity, continuityCandidates] = await Promise.all([
    getGuestVisitorContinuity(getDbPool(), rows.map((row) => row.id)),
    getGuestContinuityCandidates(getDbPool(), rows).catch(() => new Map()),
  ]);

  return {
    ok: true,
    items: rows.map((row) => ({
      ...mapAdminGuestSession(row),
      visitorContinuity: visitorContinuity.get(row.id) || null,
      continuityCandidates: continuityCandidates.get(row.id)?.candidates || [],
    })),
    page: safePage,
    limit: safeLimit,
    total,
    pages,
    summary: await getAdminGuestSummary({ dateRange, startDate, endDate }),
    siteCounts: await getAdminGuestSiteCounts({ normalizedQuery, normalizedStatus, dateRange, startDate, endDate }),
  };
}

function buildGuestFilters({ normalizedQuery = "", normalizedStatus = "all", normalizedSite = "all", dateRange = "all", startDate = "", endDate = "" } = {}) {
  const where = [];
  const params = [];
  if (normalizedQuery) {
    where.push(`(
      INSTR(LOWER(g.id), LOWER(?)) > 0
      OR INSTR(LOWER(COALESCE(site.name, '')), LOWER(?)) > 0
      OR INSTR(LOWER(COALESCE(site.slug, '')), LOWER(?)) > 0
      OR INSTR(LOWER(COALESCE(mascot.name, '')), LOWER(?)) > 0
      OR INSTR(LOWER(COALESCE(claimed.email, '')), LOWER(?)) > 0
      OR INSTR(LOWER(COALESCE(claimed.username, '')), LOWER(?)) > 0
      OR INSTR(LOWER(COALESCE(claimed.nickname, '')), LOWER(?)) > 0
    )`);
    params.push(...Array(7).fill(normalizedQuery));
  }
  if (normalizedSite !== "all") {
    where.push("g.site_id = ?");
    params.push(normalizedSite);
  }
  appendStatusFilter(where, normalizedStatus);
  appendAdminDateFilter(where, params, {
    dateRange,
    startDate,
    endDate,
    expression: "COALESCE(guest_activity.last_message_at, call_activity.last_call_at, g.claimed_at, g.updated_at, g.created_at)",
  });
  return { where, params };
}

async function getAdminGuestSiteCounts({ normalizedQuery = "", normalizedStatus = "all", dateRange = "all", startDate = "", endDate = "" } = {}) {
  const { where, params } = buildGuestFilters({ normalizedQuery, normalizedStatus, dateRange, startDate, endDate });
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const [rows] = await getDbPool().execute(
    `SELECT COALESCE(g.site_id, 'unassigned') AS site_id,
            COUNT(*) AS total_sessions,
            SUM(COALESCE(guest_activity.user_message_count, 0) > 0) AS active_sessions
       FROM guest_sessions g
       LEFT JOIN sites site ON site.id = g.site_id
       LEFT JOIN ai_characters mascot ON mascot.id = g.mascot_character_id
       LEFT JOIN users claimed ON claimed.id = g.claimed_user_id
       ${guestActivityJoinsSql()}
       ${whereSql}
       GROUP BY COALESCE(g.site_id, 'unassigned')`,
    params
  );
  const total = rows.reduce((sum, row) => sum + Number(row.total_sessions || 0), 0);
  const active = rows.reduce((sum, row) => sum + Number(row.active_sessions || 0), 0);
  return [
    { siteId: "all", active, total },
    ...rows.map((row) => ({ siteId: row.site_id, active: Number(row.active_sessions || 0), total: Number(row.total_sessions || 0) })),
  ];
}

function guestActivityJoinsSql() {
  return `
     LEFT JOIN (
       SELECT
         message.guest_session_id,
         MAX(message.sent_at) AS last_message_at,
         SUM(message.sender_type = 'user') AS user_message_count,
         COUNT(DISTINCT CASE WHEN message.sender_type = 'user' THEN session.character_id END) AS character_conversation_count,
         SUM(message.content_type = 'product') AS product_message_count,
         SUM(message.sender_type = 'user' AND message.source_ref = 'voice-asr') AS voice_input_count,
         SUM(message.sender_type = 'user' AND message.content_type = 'attachment') AS attachment_message_count
       FROM chat_messages message
       INNER JOIN chat_sessions session ON session.id = message.session_id
       WHERE message.guest_session_id IS NOT NULL
       GROUP BY message.guest_session_id
     ) guest_activity ON guest_activity.guest_session_id = g.id
     LEFT JOIN (
       SELECT guest_session_id,
              COUNT(*) AS call_count,
              SUM(duration_milliseconds) AS call_duration_milliseconds,
              SUM(turn_count) AS call_turn_count,
              MAX(COALESCE(ended_at, last_accounted_at, started_at)) AS last_call_at
       FROM guest_call_sessions
       GROUP BY guest_session_id
     ) call_activity ON call_activity.guest_session_id = g.id`;
}

export async function getAdminGuestConversation(guestSessionId) {
  const normalizedGuestId = normalizeGuestId(guestSessionId);
  const [[session]] = await getDbPool().execute(
    `SELECT
       effective_session.id,
       COALESCE(mascot.id, g.mascot_character_id) AS character_id,
       COALESCE(mascot.name, '已删除角色') AS character_name,
       mascot.role_title,
       mascot.avatar_url,
       effective_session.session_title,
       effective_session.last_message_at
     FROM guest_sessions g
     LEFT JOIN ai_characters mascot ON mascot.id = g.mascot_character_id
     INNER JOIN chat_sessions effective_session ON (
       (
         g.session_status = 'claimed'
         AND g.target_chat_session_id IS NOT NULL
         AND g.target_chat_session_id <> ''
         AND effective_session.id = g.target_chat_session_id
         AND effective_session.internal_uid = g.claimed_user_id
         AND effective_session.character_id = g.mascot_character_id
       )
       OR
       (
         g.session_status <> 'claimed'
         AND effective_session.id = g.chat_session_id
         AND effective_session.guest_session_id = g.id
         AND effective_session.internal_uid IS NULL
         AND effective_session.character_id = g.mascot_character_id
       )
     )
     WHERE g.id = ?
     LIMIT 1`,
    [normalizedGuestId]
  );
  if (!session?.id) throw createPublicError("游客对话不存在", 404);

  // Keep the legacy guest conversation endpoint aligned with the detail view.
  const [messageRows] = await getDbPool().execute(
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
     WHERE m.guest_session_id = ?
       AND m.session_id = ?
       AND m.sent_at >= DATE_SUB(NOW(3), INTERVAL ? DAY)
     ORDER BY m.display_order DESC, m.sent_at DESC, m.id DESC
     LIMIT ${MAX_CONVERSATION_MESSAGES + 1}`,
    [normalizedGuestId, session.id, CHAT_RETENTION_DAYS.ADMIN_CONVERSATION_DEFAULT]
  );
  const hasMore = messageRows.length > MAX_CONVERSATION_MESSAGES;
  const messages = messageRows.slice(0, MAX_CONVERSATION_MESSAGES).reverse();

  return {
    ok: true,
    item: {
      ...mapConversationRow({
        ...session,
        last_message_at: messages[messages.length - 1]?.sent_at || session.last_message_at,
        latest_text: "",
        latest_sender_type: "",
        message_count: messages.length,
        user_message_count: messages.filter((message) => message.sender_type === "user").length,
      }),
      hasMore,
      messages: messages.map(mapConversationMessageRow),
    },
  };
}

export async function listAdminGuestConversations(guestSessionId, { query = "" } = {}) {
  const guestId = normalizeGuestId(guestSessionId);
  const normalizedQuery = String(query || "").trim().slice(0, MAX_QUERY_LENGTH);
  const params = [guestId];
  const queryFilter = normalizedQuery ? `AND (
    INSTR(LOWER(COALESCE(character_record.name, '')), LOWER(?)) > 0
    OR INSTR(LOWER(COALESCE(session.session_title, '')), LOWER(?)) > 0
  )` : "";
  if (normalizedQuery) params.push(normalizedQuery, normalizedQuery);
  const [rows] = await getDbPool().execute(
    `SELECT
       CONCAT(session.id, ?, DATE_FORMAT(MAX(message.sent_at), '%Y-%m-%d')) AS id,
       session.character_id,
       COALESCE(character_record.name, '已删除角色') AS character_name,
       character_record.role_title,
       character_record.avatar_url,
       session.session_title,
       session.last_message_at,
       MAX(message.sent_at) AS latest_message_at,
       SUBSTRING_INDEX(GROUP_CONCAT(message.text_content ORDER BY message.display_order DESC, message.sent_at DESC, message.id DESC SEPARATOR '\u0001'), '\u0001', 1) AS latest_text,
       SUBSTRING_INDEX(GROUP_CONCAT(message.sender_type ORDER BY message.display_order DESC, message.sent_at DESC, message.id DESC SEPARATOR '\u0001'), '\u0001', 1) AS latest_sender_type,
       COUNT(message.id) AS message_count,
       SUM(message.sender_type = 'user') AS user_message_count
     FROM chat_sessions session
     LEFT JOIN ai_characters character_record ON character_record.id = session.character_id
     LEFT JOIN chat_messages message
       ON message.session_id = session.id AND message.guest_session_id = ?
       AND message.sent_at >= DATE_SUB(NOW(3), INTERVAL ${CHAT_RETENTION_DAYS.ADMIN_CONVERSATION_DEFAULT} DAY)
     WHERE session.guest_session_id = ?
       AND EXISTS (
         SELECT 1 FROM chat_messages participant
         WHERE participant.session_id = session.id
           AND participant.guest_session_id = session.guest_session_id
           AND participant.sender_type = 'user'
           AND participant.sent_at >= DATE_SUB(NOW(3), INTERVAL ${CHAT_RETENTION_DAYS.ADMIN_CONVERSATION_DEFAULT} DAY)
       )
       ${queryFilter}
     GROUP BY session.id, DATE_FORMAT(message.sent_at, '%Y-%m-%d'), session.character_id, character_record.name, character_record.role_title, character_record.avatar_url, session.session_title, session.last_message_at
     HAVING COUNT(message.id) > 0
     ORDER BY COALESCE(MAX(message.sent_at), session.last_message_at) DESC, session.id DESC`,
    [CONVERSATION_SEGMENT_SEPARATOR, guestId, ...params]
  );
  return { ok: true, items: rows.map((row) => mapConversationRow({
    ...row,
    last_message_at: row.latest_message_at || row.last_message_at,
  })) };
}

export async function getAdminGuestConversationDetail(guestSessionId, conversationId) {
  const guestId = normalizeGuestId(guestSessionId);
  const { sessionId, segmentDate } = parseGuestConversationSegmentId(conversationId);
  if (!sessionId) throw createPublicError("游客对话不存在", 404);
  const [[session]] = await getDbPool().execute(
    `SELECT session.id, session.character_id, COALESCE(character_record.name, '已删除角色') AS character_name,
            character_record.role_title, character_record.avatar_url, session.session_title, session.last_message_at
     FROM chat_sessions session
     LEFT JOIN ai_characters character_record ON character_record.id = session.character_id
     WHERE session.id = ? AND session.guest_session_id = ?
     LIMIT 1`,
    [sessionId, guestId]
  );
  if (!session) throw createPublicError("游客对话不存在", 404);
  return getAdminGuestConversationMessages(guestId, session, { segmentDate });
}

async function getAdminGuestConversationMessages(guestId, session, { segmentDate = "" } = {}) {
  // display_order is the chat renderer's canonical sequence. Greeting media can
  // be persisted after the opening text while intentionally receiving an
  // earlier display order, so sent_at cannot be the primary sort key here.
  const messageParams = [guestId, session.id, CHAT_RETENTION_DAYS.ADMIN_CONVERSATION_DEFAULT];
  let messageDateWhere = "";
  if (segmentDate) {
    messageDateWhere = "AND m.sent_at >= ? AND m.sent_at < DATE_ADD(?, INTERVAL 1 DAY)";
    messageParams.push(segmentDate, segmentDate);
  }
  const [messageRows] = await getDbPool().execute(
    `SELECT
       m.id, m.sender_type, m.sender_label, m.content_type, m.text_content, m.product_payload_json,
       m.delivery_status, m.sent_at, m.display_order,
       img.id AS image_asset_id, img.status AS image_status, img.storage_path AS image_storage_path,
       img.protected_path AS image_protected_path, img.width AS image_width, img.height AS image_height,
       img.bytes AS image_bytes, img.mime_type AS image_mime_type,
       img.error_message AS image_error_message
     FROM chat_messages m
     LEFT JOIN chat_image_assets img ON img.message_id = m.id
     WHERE m.guest_session_id = ? AND m.session_id = ?
       AND m.sent_at >= DATE_SUB(NOW(3), INTERVAL ? DAY)
       ${messageDateWhere}
     ORDER BY m.display_order DESC, m.sent_at DESC, m.id DESC
     LIMIT ${MAX_CONVERSATION_MESSAGES + 1}`,
    messageParams
  );
  const hasMore = messageRows.length > MAX_CONVERSATION_MESSAGES;
  const messages = messageRows.slice(0, MAX_CONVERSATION_MESSAGES).reverse();
  return {
    ok: true,
    item: {
      ...mapConversationRow({
        ...session,
        id: segmentDate ? buildGuestConversationSegmentId(session.id, segmentDate) : session.id,
        last_message_at: messages[messages.length - 1]?.sent_at || session.last_message_at,
        latest_text: "",
        latest_sender_type: "",
        message_count: messages.length,
        user_message_count: messages.filter((message) => message.sender_type === "user").length,
      }),
      hasMore,
      messages: messages.map(mapConversationMessageRow),
    },
  };
}

function buildGuestConversationSegmentId(sessionId, segmentDate) {
  return `${sessionId}${CONVERSATION_SEGMENT_SEPARATOR}${segmentDate}`;
}

function parseGuestConversationSegmentId(value) {
  const normalized = String(value || "").trim();
  const separatorIndex = normalized.lastIndexOf(CONVERSATION_SEGMENT_SEPARATOR);
  if (separatorIndex < 0) return { sessionId: normalized.slice(0, 64), segmentDate: "" };
  const sessionId = normalized.slice(0, separatorIndex).trim().slice(0, 64);
  const segmentDate = normalized.slice(separatorIndex + CONVERSATION_SEGMENT_SEPARATOR.length).trim();
  if (!SEGMENT_DATE_PATTERN.test(segmentDate)) return { sessionId: normalized.slice(0, 64), segmentDate: "" };
  return { sessionId, segmentDate };
}

async function getAdminGuestSummary({ dateRange = "all", startDate = "", endDate = "" } = {}) {
  const where = [];
  const params = [];
  appendAdminDateFilter(where, params, {
    dateRange,
    startDate,
    endDate,
    expression: "COALESCE(guest_activity.last_message_at, call_activity.last_call_at, g.claimed_at, g.updated_at, g.created_at)",
  });
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const [[row]] = await getDbPool().execute(
    `SELECT
       COUNT(*) AS total_guest_sessions,
       SUM(
         EXISTS(
           SELECT 1
           FROM chat_messages message
           WHERE message.guest_session_id = g.id
             AND message.sender_type = 'user'
           LIMIT 1
         )
       ) AS guest_sessions_with_user_messages,
       SUM(g.session_status = 'active' AND g.expires_at > NOW(3)) AS valid_guest_sessions,
       SUM(
         COALESCE(guest_activity.user_message_count, 0) > 0
         OR COALESCE(call_activity.call_count, 0) > 0
       ) AS participated_in_range,
       SUM(g.session_status = 'claimed') AS claimed_in_range
     FROM guest_sessions g
     LEFT JOIN sites site ON site.id = g.site_id
     LEFT JOIN ai_characters mascot ON mascot.id = g.mascot_character_id
     LEFT JOIN users claimed ON claimed.id = g.claimed_user_id
     ${guestActivityJoinsSql()}
     ${whereSql}`,
    params
  );
  return {
    totalGuestSessions: Number(row?.total_guest_sessions || 0),
    guestSessionsWithUserMessages: Number(row?.guest_sessions_with_user_messages || 0),
    validGuestSessions: Number(row?.valid_guest_sessions || 0),
    participatedToday: Number(row?.participated_in_range || 0),
    claimedToday: Number(row?.claimed_in_range || 0),
  };
}

function mapAdminGuestSession(row) {
  const status = resolveGuestStatus(row);
  return {
    id: row.id,
    displayId: shortGuestId(row.id),
    siteId: row.site_id || "",
    siteName: row.site_name || "已删除站点",
    siteSlug: row.site_slug || "",
    characterId: row.mascot_character_id || "",
    characterName: row.character_name || "已删除角色",
    characterRole: row.role_title || "",
    characterAvatarUrl: row.avatar_url || "",
    sessionStatus: row.session_status || "",
    status: status.value,
    statusLabel: status.label,
    userMessageCount: Number(row.user_message_count || 0),
    characterConversationCount: Number(row.character_conversation_count || 0),
    quotaMessageCount: row.current_quota_message_count === undefined || row.current_quota_message_count === null
      ? currentQuotaMessageCount(row)
      : Number(row.current_quota_message_count || 0),
    productMessageCount: Number(row.product_message_count || 0),
    voiceInputCount: Number(row.voice_input_count || 0),
    attachmentMessageCount: Number(row.attachment_message_count || 0),
    callCount: Number(row.call_count || 0),
    callDurationMilliseconds: Number(row.call_duration_milliseconds || 0),
    callTurnCount: Number(row.call_turn_count || 0),
    messageLimit: GUEST_MESSAGE_LIMIT,
    imageEntitlementStatus: row.entitlement_status || "missing",
    imageAssetId: row.entitlement_asset_id || "",
    claimedUserId: row.claimed_user_id || "",
    claimedAccount: row.claimed_email || row.claimed_nickname || row.claimed_username || "",
    claimedAt: row.claimed_at,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    lastActiveAt: latestActivityAt(row.last_message_at, row.last_call_at) || row.claimed_at || row.updated_at || row.created_at,
    lastIp: row.last_ip || "",
    lastIpRegion: row.last_ip_region || "",
    lastIpAt: row.last_ip_at || null,
    lastDevice: describeUserAgent(row.last_user_agent),
    ...mapAdminSourcePage(row.external_source_context_json),
  };
}

function resolveGuestStatus(row) {
  const sessionStatus = String(row.session_status || "").toLowerCase();
  if (sessionStatus === "claimed") return { value: "converted", label: "已转注册" };
  const expired = !row.expires_at || new Date(row.expires_at).getTime() <= Date.now();
  if (expired || ["revoked", "cleanup_pending"].includes(sessionStatus)) return { value: "expired", label: "已过期" };
  if (sessionStatus === "claiming") return { value: "claiming", label: "认证中" };
  if (sessionStatus === "active" && currentQuotaMessageCount(row) >= GUEST_MESSAGE_LIMIT) {
    return { value: "limit", label: "额度已满" };
  }
  if (sessionStatus === "active") return { value: "active", label: "活跃中" };
  return { value: "abnormal", label: "状态异常" };
}

function appendStatusFilter(where, status) {
  if (status === "active") {
    where.push(`g.session_status = 'active'
      AND g.expires_at > NOW(3)
      AND NOT EXISTS (
        SELECT 1 FROM guest_character_sessions quota_session
         WHERE quota_session.guest_session_id = g.id
           AND quota_session.message_window_started_at > DATE_SUB(NOW(3), INTERVAL 24 HOUR)
           AND quota_session.message_window_count >= ${GUEST_MESSAGE_LIMIT}
      )`);
  } else if (status === "limit") {
    where.push(`g.session_status = 'active'
      AND g.expires_at > NOW(3)
      AND EXISTS (
        SELECT 1 FROM guest_character_sessions quota_session
         WHERE quota_session.guest_session_id = g.id
           AND quota_session.message_window_started_at > DATE_SUB(NOW(3), INTERVAL 24 HOUR)
           AND quota_session.message_window_count >= ${GUEST_MESSAGE_LIMIT}
      )`);
  } else if (status === "converted") {
    where.push("g.session_status = 'claimed'");
  } else if (status === "expired") {
    where.push(`g.session_status <> 'claimed'
      AND (g.expires_at <= NOW(3) OR g.expires_at IS NULL OR g.session_status IN ('revoked', 'cleanup_pending'))`);
  }
}

function currentQuotaMessageCount(row) {
  const startedAt = new Date(row.message_window_started_at || 0).getTime();
  if (!startedAt || Date.now() - startedAt >= MESSAGE_WINDOW_MS) return 0;
  return Math.max(0, Number(row.message_window_count || 0));
}

function normalizePositiveInteger(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.floor(parsed);
}

function normalizeGuestStatusFilter(status) {
  const value = String(status || "all").trim().toLowerCase();
  return ["active", "limit", "converted", "expired"].includes(value) ? value : "all";
}

function normalizeSiteFilter(site) {
  const value = String(site || "all").trim();
  return !value || value === "all" ? "all" : value.slice(0, 64);
}

function normalizeGuestId(value) {
  const normalized = String(value || "").trim().slice(0, 64);
  if (!normalized) throw createPublicError("游客对话不存在", 404);
  return normalized;
}

function shortGuestId(value) {
  const normalized = String(value || "").trim();
  const compact = normalized.replace(/^guest[_-]?/i, "");
  return compact.slice(-8).toUpperCase() || normalized.slice(-8).toUpperCase();
}

function latestActivityAt(...values) {
  return values.filter(Boolean).sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0] || null;
}
