import { randomBytes, randomUUID, createHash } from "node:crypto";
import { getDbPool } from "./db-core.js";
import { createPublicError } from "./public-error-utils.js";

export const REPORTING_SCOPES = Object.freeze([
  { id: "accounts:read", label: "读取正式账号资料（含邮箱、最近 IP、设备）" },
  { id: "guests:read", label: "读取游客资料（含最近 IP、设备）" },
  { id: "conversations:read", label: "读取对话列表" },
  { id: "messages:read", label: "读取对话消息内容" },
]);
export async function createReportingTables() {
  await getDbPool().query(`CREATE TABLE IF NOT EXISTS reporting_api_tokens (
    id VARCHAR(64) PRIMARY KEY, name VARCHAR(80) NOT NULL, token_hash CHAR(64) NOT NULL UNIQUE,
    token_prefix VARCHAR(24) NOT NULL, scopes_json JSON NOT NULL, all_sites BOOLEAN NOT NULL,
    site_ids_json JSON NOT NULL, created_by VARCHAR(64) NOT NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    expires_at DATETIME(3) NOT NULL, revoked_at DATETIME(3) NULL, last_used_at DATETIME(3) NULL,
    request_count BIGINT UNSIGNED NOT NULL DEFAULT 0
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
}
const parse = (value) => typeof value === "string" ? JSON.parse(value) : value;
function mapToken(row) {
  return { id: row.id, name: row.name, tokenPrefix: row.token_prefix, scopes: parse(row.scopes_json),
    allSites: Boolean(row.all_sites), siteIds: parse(row.site_ids_json), createdAt: row.created_at,
    expiresAt: row.expires_at, lastUsedAt: row.last_used_at, requestCount: Number(row.request_count),
    status: row.revoked_at ? "revoked" : new Date(row.expires_at).getTime() <= Date.now() ? "expired" : "active" };
}
export async function listReportingTokens() {
  const [rows] = await getDbPool().execute("SELECT * FROM reporting_api_tokens ORDER BY created_at DESC, id DESC");
  const [sites] = await getDbPool().execute("SELECT id, name, slug FROM sites ORDER BY name, id");
  return { ok: true, items: rows.map(mapToken), scopes: REPORTING_SCOPES, sites };
}
export async function createReportingToken(body, actor) {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const scopes = Array.isArray(body.scopes) ? [...new Set(body.scopes)] : [];
  const siteIds = Array.isArray(body.siteIds) ? [...new Set(body.siteIds)] : [];
  if (!name || name.length > 80 || !scopes.length || scopes.some((scope) => !REPORTING_SCOPES.some((item) => item.id === scope))) throw createPublicError("名称或读取权限无效", 400);
  if (typeof body.allSites !== "boolean" || (!body.allSites && !siteIds.length) || siteIds.some((id) => typeof id !== "string" || id.length > 64)) throw createPublicError("请选择明确的站点范围", 400);
  if (![30, 90, 365].includes(body.expiresInDays)) throw createPublicError("有效期须为 30、90 或 365 天", 400);
  if (siteIds.length) {
    const [sites] = await getDbPool().execute(`SELECT id FROM sites WHERE id IN (${siteIds.map(() => "?").join(",")})`, siteIds);
    if (sites.length !== siteIds.length) throw createPublicError("包含不存在的站点", 400);
  }
  const token = `alove_rpt_${randomBytes(32).toString("hex")}`;
  const id = randomUUID();
  await getDbPool().execute(`INSERT INTO reporting_api_tokens
    (id,name,token_hash,token_prefix,scopes_json,all_sites,site_ids_json,created_by,expires_at)
    VALUES (?,?,?,?,?,?,?,?,?)`,
  [id, name, hash(token), token.slice(0, 18), JSON.stringify(scopes), body.allSites, JSON.stringify(body.allSites ? [] : siteIds), actor.id, new Date(Date.now() + body.expiresInDays * 86400000)]);
  const [[row]] = await getDbPool().execute("SELECT * FROM reporting_api_tokens WHERE id = ?", [id]);
  return { ok: true, token, item: mapToken(row) };
}
export async function revokeReportingToken(id) {
  const [result] = await getDbPool().execute("UPDATE reporting_api_tokens SET revoked_at = COALESCE(revoked_at,NOW(3)) WHERE id = ?", [id]);
  if (!result.affectedRows) throw createPublicError("Token 不存在", 404);
  return { ok: true };
}
const requestWindows = new Map();
export async function requireReportingToken(req, scopes) {
  const match = String(req.headers.authorization || "").match(/^Bearer (alove_rpt_[a-f0-9]{64})$/);
  if (!match) throw createPublicError("需要有效的报告 API Token", 401);
  const [[row]] = await getDbPool().execute("SELECT * FROM reporting_api_tokens WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > NOW(3)", [hash(match[1])]);
  if (!row) throw createPublicError("Token 无效、已撤销或已过期", 401);
  const token = mapToken(row);
  if (scopes.some((scope) => !token.scopes.includes(scope))) throw createPublicError("Token 没有此读取权限", 403);
  const now = Date.now();
  for (const [id, window] of requestWindows) if (now - window.startedAt >= 60000) requestWindows.delete(id);
  const window = requestWindows.get(token.id) || { startedAt: now, count: 0 };
  if (window.count >= 60) throw createPublicError("读取频率超过每分钟 60 次，请稍后重试", 429);
  window.count += 1;
  requestWindows.set(token.id, window);
  await getDbPool().execute("UPDATE reporting_api_tokens SET last_used_at = NOW(3), request_count = request_count + 1 WHERE id = ?", [token.id]);
  return token;
}
function hash(value) { return createHash("sha256").update(value).digest("hex"); }
