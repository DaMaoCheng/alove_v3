import { getDbPool } from "./db.js";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

export async function listAdminFeedback({ page = 1, limit = DEFAULT_LIMIT, status = "all", query = "", site = "all" } = {}) {
  const safePage = Math.max(1, Number(page || 1));
  const safeLimit = Math.max(1, Math.min(MAX_LIMIT, Number(limit || DEFAULT_LIMIT)));
  const normalizedStatus = normalizeStatusFilter(status);
  const normalizedQuery = normalizeSearchQuery(query);
  const normalizedSite = normalizeSiteFilter(site);
  const params = [];
  const where = [];

  if (normalizedStatus !== "all") {
    where.push("uf.feedback_status = ?");
    params.push(normalizedStatus);
  }
  if (normalizedSite === "unassigned") {
    where.push("COALESCE(uf.site_id, '') = '' AND COALESCE(uf.site_slug, '') = ''");
  } else if (normalizedSite !== "all") {
    where.push("(uf.site_id = ? OR uf.site_slug = ?)");
    params.push(normalizedSite, normalizedSite);
  }
  if (normalizedQuery) {
    const pattern = `%${normalizedQuery}%`;
    where.push(`(
      uf.user_email LIKE ?
      OR COALESCE(NULLIF(u.nickname, ''), NULLIF(u.username, ''), '') LIKE ?
      OR uf.subject LIKE ?
      OR uf.content LIKE ?
    )`);
    params.push(pattern, pattern, pattern, pattern);
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const [[countRow]] = await getDbPool().execute(
    `SELECT COUNT(*) AS total
     FROM user_feedback uf
     LEFT JOIN users u ON u.id = uf.internal_uid
     ${whereSql}`,
    params
  );
  const total = Number(countRow?.total || 0);
  const pages = Math.max(1, Math.ceil(total / safeLimit));
  const safeCurrentPage = Math.min(safePage, pages);
  const safeOffset = (safeCurrentPage - 1) * safeLimit;

  const [rows] = await getDbPool().execute(
    `SELECT
       uf.id, uf.internal_uid, uf.guest_session_id, guest.id AS guest_session_exists, uf.user_email, uf.account_type, uf.site_id, uf.site_slug, uf.client_ip, uf.client_ip_region,
       site.name AS site_name,
       uf.subject, uf.content, uf.page_path, uf.user_agent, uf.feedback_status,
       uf.created_at, uf.updated_at,
       COALESCE(NULLIF(u.nickname, ''), NULLIF(u.username, ''), '') AS user_name
     FROM user_feedback uf
     LEFT JOIN users u ON u.id = uf.internal_uid
     LEFT JOIN guest_sessions guest ON guest.id = uf.guest_session_id
     LEFT JOIN sites site ON site.id = uf.site_id
     ${whereSql}
     ORDER BY uf.created_at DESC, uf.id DESC
     LIMIT ${safeLimit} OFFSET ${safeOffset}`,
    params
  );

  return {
    ok: true,
    items: rows.map(mapFeedbackRow),
    page: safeCurrentPage,
    pages,
    total,
    limit: safeLimit,
    filters: {
      status: normalizedStatus,
      query: normalizedQuery,
      site: normalizedSite,
    },
  };
}

export async function updateAdminFeedbackStatus(feedbackId, { status = "" } = {}) {
  const safeId = normalizeFeedbackId(feedbackId);
  const nextStatus = normalizeWritableStatus(status);

  const [result] = await getDbPool().execute(
    `UPDATE user_feedback
     SET feedback_status = ?, updated_at = NOW(3)
     WHERE id = ?
     LIMIT 1`,
    [nextStatus, safeId]
  );
  if (!result.affectedRows) {
    const error = new Error("反馈记录不存在");
    error.statusCode = 404;
    throw error;
  }

  const [rows] = await getDbPool().execute(
    `SELECT
       uf.id, uf.internal_uid, uf.guest_session_id, guest.id AS guest_session_exists, uf.user_email, uf.account_type, uf.site_id, uf.site_slug, uf.client_ip, uf.client_ip_region,
       site.name AS site_name,
       uf.subject, uf.content, uf.page_path, uf.user_agent, uf.feedback_status,
       uf.created_at, uf.updated_at,
       COALESCE(NULLIF(u.nickname, ''), NULLIF(u.username, ''), '') AS user_name
     FROM user_feedback uf
     LEFT JOIN users u ON u.id = uf.internal_uid
     LEFT JOIN guest_sessions guest ON guest.id = uf.guest_session_id
     LEFT JOIN sites site ON site.id = uf.site_id
     WHERE uf.id = ?
     LIMIT 1`,
    [safeId]
  );

  return {
    ok: true,
    item: mapFeedbackRow(rows[0]),
  };
}

function mapFeedbackRow(row) {
  return {
    id: row.id,
    internalUid: row.internal_uid,
    guestSessionId: row.guest_session_id || "",
    guestSessionExists: Boolean(row.guest_session_exists),
    userEmail: row.user_email || "",
    userName: row.user_name || (String(row.account_type || "").toLowerCase() === "guest" ? "Guest" : ""),
    accountType: row.account_type || "",
    siteId: row.site_id || "",
    siteName: row.site_name || "",
    siteSlug: row.site_slug || "",
    clientIp: row.client_ip || "",
    clientIpRegion: row.client_ip_region || "",
    subject: row.subject || "",
    content: row.content || "",
    pagePath: row.page_path || "",
    userAgent: row.user_agent || "",
    status: row.feedback_status || "new",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeStatusFilter(status) {
  const value = String(status || "all").trim().toLowerCase();
  return value === "new" ? "new" : "all";
}

function normalizeSearchQuery(query) {
  return String(query || "").trim().slice(0, 120);
}

function normalizeSiteFilter(site) {
  const value = String(site || "all").trim();
  if (!value || value === "all") return "all";
  if (value === "unassigned") return "unassigned";
  return value.slice(0, 64);
}

function normalizeWritableStatus(status) {
  const value = String(status || "").trim().toLowerCase();
  if (value === "done") return "done";
  const error = new Error("反馈状态不支持");
  error.statusCode = 400;
  throw error;
}

function normalizeFeedbackId(feedbackId) {
  const id = String(feedbackId || "").trim();
  if (!id) {
    const error = new Error("反馈 ID 不能为空");
    error.statusCode = 400;
    throw error;
  }
  return id.slice(0, 64);
}
