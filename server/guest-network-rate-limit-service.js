import { createHash } from "node:crypto";
import { SERVER_CONFIG } from "./config.js";
import { getRequestIp } from "./http-utils.js";
import { createPublicError } from "./public-error-utils.js";
import { getDbPool } from "./db.js";

const WINDOW_MS = 10 * 60 * 1000;
const SESSION_CREATE_LIMIT = 12;
const MESSAGE_LIMIT = 60;
const SEARCH_LIMIT = 30;
export const GUEST_NETWORK_LIMIT_RETENTION_HOURS = 24;

export function buildGuestNetworkHash(req) {
  const requestIp = getRequestIp(req) || "unknown";
  return createHash("sha256")
    .update(`${SERVER_CONFIG.guestChat.networkPepper}:${requestIp}`)
    .digest("hex");
}

export async function consumeGuestNetworkQuota(db, { networkHash = "", siteId = "", action = "message" } = {}) {
  const normalizedHash = String(networkHash || "").trim();
  const normalizedSiteId = String(siteId || "").trim();
  if (!normalizedHash || !normalizedSiteId) throw createPublicError("Guest access is unavailable.", 503);
  await db.execute(
    `INSERT IGNORE INTO guest_network_rate_limits (network_hash, site_id)
     VALUES (?, ?)`,
    [normalizedHash, normalizedSiteId]
  );
  const [rows] = await db.execute(
    `SELECT *, NOW(3) AS db_now
     FROM guest_network_rate_limits
     WHERE network_hash = ? AND site_id = ?
     LIMIT 1 FOR UPDATE`,
    [normalizedHash, normalizedSiteId]
  );
  const row = rows[0];
  if (!row) throw createPublicError("Guest access is unavailable.", 503);
  const scope = action === "session_create" ? "session" : action === "product_search" ? "search" : "message";
  const startKey = `${scope}_window_started_at`;
  const countKey = `${scope}_window_count`;
  const limit = scope === "session" ? SESSION_CREATE_LIMIT : scope === "search" ? SEARCH_LIMIT : MESSAGE_LIMIT;
  const now = new Date(row.db_now).getTime();
  const startedAt = new Date(row[startKey] || 0).getTime();
  const fresh = !startedAt || now - startedAt >= WINDOW_MS;
  const count = fresh ? 0 : Number(row[countKey] || 0);
  if (count >= limit) throw createPublicError("Guest traffic is busy. Please try again later.", 429);
  const startColumn = startKey;
  const countColumn = countKey;
  await db.execute(
    `UPDATE guest_network_rate_limits
     SET ${startColumn} = ?, ${countColumn} = ?, updated_at = NOW(3)
     WHERE network_hash = ? AND site_id = ?`,
    [fresh ? row.db_now : row[startKey], count + 1, normalizedHash, normalizedSiteId]
  );
}

export async function cleanupExpiredGuestNetworkLimits({
  retentionHours = GUEST_NETWORK_LIMIT_RETENTION_HOURS,
  now = new Date(),
  db = getDbPool(),
} = {}) {
  const normalizedHours = Math.max(1, Number(retentionHours || GUEST_NETWORK_LIMIT_RETENTION_HOURS));
  const cutoff = new Date(new Date(now).getTime() - normalizedHours * 60 * 60 * 1000);
  const [result] = await db.execute(
    `DELETE FROM guest_network_rate_limits
     WHERE updated_at < ?`,
    [cutoff]
  );
  return {
    cutoff,
    deletedGuestNetworkLimits: Number(result.affectedRows || 0),
  };
}
