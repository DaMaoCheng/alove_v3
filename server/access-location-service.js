import { getRequestIp } from "./http-utils.js";
import { isTrustedProxyRequest } from "./http-request-utils.js";
import { normalizeUserAgent } from "./device-info-service.js";

const ACCESS_WRITE_INTERVAL_SECONDS = 10 * 60;

export function resolveRequestAccess(req) {
  const ip = String(getRequestIp(req) || "").trim().slice(0, 64);
  const trustedProxy = isTrustedProxyRequest(req?.socket?.remoteAddress || "");
  const countryCode = trustedProxy ? normalizeCountryCode(req?.headers?.["cf-ipcountry"]) : "";
  return {
    ip,
    region: countryNameZh(countryCode),
    userAgent: normalizeUserAgent(req?.headers?.["user-agent"]),
  };
}

export async function recordUserLastAccess(db, { userId = "", access = {} } = {}) {
  return recordLastAccess(db, { table: "users", id: userId, access });
}

export async function recordGuestLastAccess(db, { guestSessionId = "", access = {} } = {}) {
  await recordLastAccess(db, { table: "guest_sessions", id: guestSessionId, access });
  await recordLastUserAgent(db, {
    table: "guest_sessions",
    column: "last_user_agent",
    id: guestSessionId,
    userAgent: access?.userAgent,
  });
}

export async function recordUserLastLogin(db, { userId = "", access = {} } = {}) {
  return recordLastUserAgent(db, {
    table: "users",
    column: "last_login_user_agent",
    id: userId,
    userAgent: access?.userAgent,
  });
}

async function recordLastAccess(db, { table, id, access }) {
  const normalizedId = String(id || "").trim();
  const ip = String(access?.ip || "").trim().slice(0, 64);
  if (!normalizedId || !ip || !db?.execute) return;
  const region = String(access?.region || "未知地区").trim().slice(0, 96) || "未知地区";
  try {
    await db.execute(
      `UPDATE ${table}
       SET last_ip = ?, last_ip_region = ?, last_ip_at = NOW(3)
       WHERE id = ?
         AND (last_ip IS NULL OR last_ip <> ? OR COALESCE(last_ip_region, '') <> ? OR last_ip_at IS NULL OR last_ip_at < DATE_SUB(NOW(3), INTERVAL ${ACCESS_WRITE_INTERVAL_SECONDS} SECOND))`,
      [ip, region, normalizedId, ip, region]
    );
  } catch (error) {
    console.warn("[aiove] last access record unavailable", {
      table,
      code: String(error?.code || error?.name || "Error").slice(0, 64),
    });
  }
}

async function recordLastUserAgent(db, { table, column, id, userAgent }) {
  const normalizedId = String(id || "").trim();
  const normalizedUserAgent = normalizeUserAgent(userAgent);
  if (!normalizedId || !normalizedUserAgent || !db?.execute) return;
  try {
    await db.execute(
      `UPDATE ${table}
       SET ${column} = ?
       WHERE id = ?
         AND COALESCE(${column}, '') <> ?`,
      [normalizedUserAgent, normalizedId, normalizedUserAgent]
    );
  } catch (error) {
    console.warn("[aiove] device access record unavailable", {
      table,
      code: String(error?.code || error?.name || "Error").slice(0, 64),
    });
  }
}

function normalizeCountryCode(value = "") {
  const code = String(value || "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) && code !== "XX" && code !== "T1" ? code : "";
}

function countryNameZh(countryCode = "") {
  if (!countryCode) return "未知地区";
  try {
    return new Intl.DisplayNames(["zh-CN"], { type: "region" }).of(countryCode) || "未知地区";
  } catch {
    return "未知地区";
  }
}
