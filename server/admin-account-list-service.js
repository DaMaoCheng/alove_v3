import { getDbPool } from "./db.js";
import { mapAccountRow } from "./admin-account-mapper.js";
import { accountSelectSql } from "./admin-account-shared.js";
import { appendAdminDateFilter } from "./admin-date-filter.js";

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

export async function listAdminAccounts({ page = 1, limit = DEFAULT_LIMIT, query = "", type = "all", site = "all", dateRange = "all", startDate = "", endDate = "" } = {}) {
  const safePage = Math.max(1, Number(page || 1));
  const safeLimit = Math.max(1, Math.min(MAX_LIMIT, Number(limit || DEFAULT_LIMIT)));
  const offset = (safePage - 1) * safeLimit;
  const normalizedQuery = String(query || "").trim();
  const normalizedType = normalizeAccountTypeFilter(type);
  const normalizedSite = normalizeSiteFilter(site);
  const { where, params } = buildAccountFilters({ normalizedQuery, normalizedType, normalizedSite, dateRange, startDate, endDate });

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const [[countRow]] = await getDbPool().execute(
    `SELECT COUNT(*) AS total FROM users u ${whereSql}`,
    params
  );
  const total = Number(countRow?.total || 0);

  const [rows] = await getDbPool().execute(
    `${accountSelectSql()}
     ${whereSql}
     ORDER BY u.created_at DESC, u.id DESC
     LIMIT ${safeLimit} OFFSET ${offset}`,
    params
  );

  return {
    ok: true,
    items: rows.map(mapAccountRow),
    page: safePage,
    limit: safeLimit,
    total,
    pages: Math.max(1, Math.ceil(total / safeLimit)),
    summary: await getAdminAccountSummary({ dateRange, startDate, endDate }),
    siteCounts: await getAdminAccountSiteCounts({ normalizedQuery, normalizedType, dateRange, startDate, endDate }),
  };
}

function buildAccountFilters({ normalizedQuery = "", normalizedType = "all", normalizedSite = "all", dateRange = "all", startDate = "", endDate = "" } = {}) {
  const where = [];
  const params = [];
  if (normalizedQuery) {
    where.push("(u.id LIKE ? OR u.username LIKE ? OR u.nickname LIKE ? OR u.email LIKE ?)");
    const like = `%${normalizedQuery}%`;
    params.push(like, like, like, like);
  }
  if (normalizedType !== "all") {
    where.push("u.account_type = ?");
    params.push(normalizedType);
  }
  if (normalizedSite === "unassigned") {
    where.push("(u.site_id IS NULL OR u.site_id = '')");
  } else if (normalizedSite !== "all") {
    where.push("u.site_id = ?");
    params.push(normalizedSite);
  }
  appendAdminDateFilter(where, params, {
    dateRange,
    startDate,
    endDate,
    expression: "COALESCE(u.last_seen_at, u.created_at)",
  });
  return { where, params };
}

async function getAdminAccountSiteCounts({ normalizedQuery = "", normalizedType = "all", dateRange = "all", startDate = "", endDate = "" } = {}) {
  const { where, params } = buildAccountFilters({ normalizedQuery, normalizedType, dateRange, startDate, endDate });
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const [rows] = await getDbPool().execute(
    `SELECT COALESCE(u.site_id, 'unassigned') AS site_id,
            COUNT(DISTINCT chat.id) AS total_sessions,
            COUNT(DISTINCT CASE WHEN chat.has_user_message = 1 THEN chat.id END) AS active_sessions
       FROM users u
       LEFT JOIN (
         SELECT s.id, s.internal_uid, MAX(m.sender_type = 'user') AS has_user_message
         FROM chat_sessions s
         LEFT JOIN chat_messages m ON m.session_id = s.id
         WHERE s.internal_uid IS NOT NULL
           AND s.source_type = 'user'
           AND s.session_status = 'active'
         GROUP BY s.id, s.internal_uid
       ) chat ON chat.internal_uid = u.id
       ${whereSql}
       GROUP BY COALESCE(u.site_id, 'unassigned')`,
    params
  );
  const total = rows.reduce((sum, row) => sum + Number(row.total_sessions || 0), 0);
  const active = rows.reduce((sum, row) => sum + Number(row.active_sessions || 0), 0);
  return [
    { siteId: "all", active, total },
    ...rows.map((row) => ({ siteId: row.site_id, active: Number(row.active_sessions || 0), total: Number(row.total_sessions || 0) })),
  ];
}

async function getAdminAccountSummary({ dateRange = "all", startDate = "", endDate = "" } = {}) {
  const where = [];
  const params = [];
  appendAdminDateFilter(where, params, {
    dateRange,
    startDate,
    endDate,
    expression: "COALESCE(u.last_seen_at, u.created_at)",
  });
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const [[row]] = await getDbPool().execute(
    `SELECT
       COUNT(*) AS total_accounts,
       SUM(account_type = 'creator') AS creator_accounts,
       SUM(account_status <> 'active') AS unavailable_accounts,
       SUM(account_status <> 'active') AS unavailable_this_month
     FROM users u
     ${whereSql}`,
    params
  );
  return {
    totalAccounts: Number(row?.total_accounts || 0),
    creatorAccounts: Number(row?.creator_accounts || 0),
    unavailableAccounts: Number(row?.unavailable_accounts || 0),
    unavailableThisMonth: Number(row?.unavailable_this_month || 0),
  };
}

function normalizeAccountTypeFilter(type) {
  const value = String(type || "all").trim().toLowerCase();
  return ["personal", "creator", "admin"].includes(value) ? value : "all";
}

function normalizeSiteFilter(site) {
  const value = String(site || "all").trim();
  if (!value || value === "all") return "all";
  if (value === "unassigned") return "unassigned";
  return value.slice(0, 64);
}
