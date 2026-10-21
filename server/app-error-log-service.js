import { createId } from "./security.js";
import { getDbPool } from "./db.js";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const MAX_MESSAGE_LENGTH = 500;
const MAX_STACK_LENGTH = 1200;
const MAX_CONTEXT_LENGTH = 2000;

export async function recordAppErrorLog(payload = {}) {
  try {
    const request = normalizeRequest(payload.request);
    const contextJson = safeJson(payload.context || payload.metadata || {});
    await getDbPool().execute(
      `INSERT INTO app_error_logs (
         id, source, level, error_type, action, status_code, safe_message, raw_message,
         stack_trace, page, endpoint, request_method, request_id, user_agent, client_ip,
         internal_uid, context_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        normalizeString(payload.id) || createId("app_log"),
        normalizeOneOf(payload.source, ["client", "server"], "server"),
        normalizeLevel(payload.level, payload.statusCode, payload.rawMessage || payload.message),
        normalizeType(payload.type, payload.statusCode),
        normalizeString(payload.action).slice(0, 128) || null,
        normalizeStatusCode(payload.statusCode),
        normalizeString(payload.safeMessage || payload.userMessage).slice(0, MAX_MESSAGE_LENGTH) || null,
        redactSensitiveText(normalizeString(payload.rawMessage || payload.message || payload.error)).slice(0, MAX_MESSAGE_LENGTH) || null,
        redactSensitiveText(normalizeString(payload.stack)).slice(0, MAX_STACK_LENGTH) || null,
        normalizeString(payload.page || request.page).slice(0, 255) || null,
        normalizeString(payload.endpoint || request.endpoint).slice(0, 255) || null,
        normalizeString(payload.method || request.method).slice(0, 16) || null,
        normalizeString(payload.requestId || request.requestId).slice(0, 128) || null,
        normalizeString(payload.userAgent || request.userAgent).slice(0, 500) || null,
        normalizeString(payload.clientIp || request.clientIp).slice(0, 64) || null,
        normalizeString(payload.userId || payload.internalUid || payload.internal_uid).slice(0, 64) || null,
        contextJson,
      ]
    );
  } catch (error) {
    console.warn("[aiove] app error log write failed:", error.message);
  }
}

export async function listAppErrorLogs({ level = "all", limit = DEFAULT_LIMIT } = {}) {
  const normalizedLevel = normalizeAdminLevel(level);
  const normalizedLimit = Math.min(Math.max(Number(limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  let whereClause = "WHERE level IN ('warning', 'error', 'critical') AND (status_code IS NULL OR status_code = 429 OR status_code >= 500)";
  if (normalizedLevel === "error") {
    whereClause = "WHERE level IN ('error', 'critical') AND (status_code IS NULL OR status_code >= 500)";
  } else if (normalizedLevel === "warn") {
    whereClause = "WHERE level = 'warning' AND (status_code IS NULL OR status_code = 429 OR status_code >= 500)";
  }

  const [rows] = await getDbPool().execute(
    `SELECT id, source, level, error_type, action, status_code, safe_message, raw_message,
       stack_trace, page, endpoint, request_method, request_id, user_agent, client_ip,
       internal_uid, context_json, created_at
     FROM app_error_logs
     ${whereClause}
     ORDER BY created_at DESC
     LIMIT ${normalizedLimit}`
  );

  return rows.map(mapAppLogRow);
}

export function buildRequestLogContext(req, requestUrl) {
  return {
    method: req?.method || "",
    endpoint: requestUrl?.pathname || "",
    page: requestUrl?.pathname || "",
    requestId: req?.headers?.["x-request-id"] || "",
    userAgent: req?.headers?.["user-agent"] || "",
    clientIp: getClientIp(req),
  };
}

function mapAppLogRow(row) {
  return {
    id: row.id,
    logType: "app",
    source: row.source || "server",
    level: mapAppLevel(row.level),
    status: row.level || "error",
    type: row.error_type || "app_error",
    action: row.action || "",
    statusCode: row.status_code ? Number(row.status_code) : null,
    safeMessage: row.safe_message || "",
    errorMessage: row.raw_message || row.safe_message || "",
    stack: row.stack_trace || "",
    page: row.page || "",
    endpoint: row.endpoint || "",
    method: row.request_method || "",
    requestId: row.request_id || "",
    userAgent: row.user_agent || "",
    clientIp: row.client_ip || "",
    userId: row.internal_uid || "",
    context: row.context_json || null,
    createdAt: row.created_at,
  };
}

function normalizeRequest(request = {}) {
  if (!request || typeof request !== "object" || Array.isArray(request)) return {};
  return request;
}

function normalizeAdminLevel(level) {
  const normalized = normalizeString(level).toLowerCase();
  return ["all", "error", "warn"].includes(normalized) ? normalized : "all";
}

function normalizeLevel(level, statusCode, rawMessage) {
  const normalized = normalizeString(level).toLowerCase();
  if (["warning", "error", "critical"].includes(normalized)) return normalized;
  const text = normalizeString(rawMessage).toLowerCase();
  if (Number(statusCode) >= 500 || /critical|uncaught|unhandled|fatal|exception/.test(text)) return "error";
  if (/timeout|network|abort|rate.?limit|429/.test(text)) return "warning";
  return "error";
}

function mapAppLevel(level) {
  if (level === "warning") return "WARN";
  if (level === "critical" || level === "error") return "ERROR";
  return "INFO";
}

function normalizeType(type, statusCode) {
  const normalized = normalizeString(type).toLowerCase().replace(/[^a-z0-9_-]+/g, "_");
  return normalized || (statusCode ? "api_error" : "app_error");
}

function normalizeStatusCode(value) {
  const code = Number(value || 0);
  return Number.isFinite(code) && code > 0 ? Math.floor(code) : null;
}

function normalizeOneOf(value, allowed, fallback) {
  const normalized = normalizeString(value).toLowerCase();
  return allowed.includes(normalized) ? normalized : fallback;
}

function safeJson(value) {
  try {
    return JSON.stringify(JSON.parse(redactSensitiveText(JSON.stringify(value == null ? {} : value)).slice(0, MAX_CONTEXT_LENGTH)));
  } catch {
    return JSON.stringify({});
  }
}

function redactSensitiveText(value = "") {
  return String(value || "")
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s"'<>]+/gi, "$1[REDACTED]")
    .replace(/((?:api[_-]?key|apikey|token|secret|password|passwd|private[_-]?key|access[_-]?token|refresh[_-]?token)\s*[:=]\s*)["']?[^"',\s}<>]+["']?/gi, "$1[REDACTED]")
    .replace(/(sk-[a-zA-Z0-9_-]{12,})/g, "sk-[REDACTED]");
}

function getClientIp(req) {
  const forwarded = String(req?.headers?.["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || String(req?.socket?.remoteAddress || "").trim();
}

function normalizeString(value) {
  return String(value == null ? "" : value).trim();
}
