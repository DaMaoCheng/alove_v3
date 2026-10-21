import { requireAuth } from "./auth-service.js";
import { getDbPool } from "./db.js";
import { readAuthToken } from "./http-utils.js";
import { hashSessionToken } from "./security.js";

export async function requireRequestUser(req) {
  return requireAuth(req, readAuthToken);
}

export async function getOptionalRequestUser(req) {
  const token = readAuthToken(req);
  if (!token) return null;
  const tokenHash = hashSessionToken(token);
  const [rows] = await getDbPool().execute(
    `SELECT u.id, u.email, u.nickname, u.username, u.account_type, u.site_id,
            s.slug AS site_slug
     FROM users u
     LEFT JOIN sites s ON s.id = u.site_id AND s.site_status = 'active'
     WHERE u.auth_token = ? AND u.token_expires_at > NOW(3) AND u.account_status = 'active'
     LIMIT 1`,
    [tokenHash]
  );
  return rows[0] || null;
}
