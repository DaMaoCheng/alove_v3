import { getDbPool } from "./db.js";
import { createPublicError } from "./public-error-utils.js";
import { createToken, hashSessionToken } from "./security.js";
import { normalizeAccountType } from "./auth-normalizers.js";
import { recordUserLastAccess, recordUserLastLogin, resolveRequestAccess } from "./access-location-service.js";

export const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

export async function issueUserSession(user, { db = getDbPool(), maxAgeSeconds = SESSION_MAX_AGE_SECONDS, access = null } = {}) {
  const token = createToken();
  const tokenHash = hashSessionToken(token);
  const expiresAt = new Date(Date.now() + maxAgeSeconds * 1000);
  await db.execute(
    "UPDATE users SET auth_token = ?, token_expires_at = ?, last_seen_at = NOW(3) WHERE id = ?",
    [tokenHash, expiresAt, user.id]
  );
  if (access) {
    await recordUserLastAccess(db, { userId: user.id, access });
    await recordUserLastLogin(db, { userId: user.id, access });
  }

  return {
    sessionToken: token,
    authResponse: {
      ok: true,
      userId: user.id,
      accountType: normalizeAccountType(user.account_type),
      user: {
        id: user.id,
        email: user.email,
        nickname: user.nickname || "",
        accountType: normalizeAccountType(user.account_type),
        avatarUrl: user.avatar_url || "",
        siteId: user.site_id || "",
        siteSlug: user.site_slug || "",
        siteName: user.site_name || "",
      },
      maxAgeSeconds,
    },
  };
}

export async function requireAuth(req, readAuthToken) {
  const token = readAuthToken(req);
  if (!token) {
    throw createPublicError("Please sign in first.", 401);
  }
  const tokenHash = hashSessionToken(token);

  const [rows] = await getDbPool().execute(
    `SELECT u.id, u.email, u.nickname, u.username, u.account_type, u.site_id,
            s.slug AS site_slug, s.name AS site_name, latest_oauth.avatar_url
     FROM users u
     LEFT JOIN sites s ON s.id = u.site_id AND s.site_status = 'active'
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
     WHERE u.auth_token = ? AND u.token_expires_at > NOW(3) AND u.account_status = 'active'
     LIMIT 1`,
    [tokenHash]
  );
  const user = rows[0] || null;
  if (!user) {
    throw createPublicError("Your session has expired. Please sign in again.", 401);
  }
  await recordUserLastAccess(getDbPool(), { userId: user.id, access: resolveRequestAccess(req) });
  return user;
}

export async function getCurrentUser(req, readAuthToken) {
  const user = await requireAuth(req, readAuthToken);
  return {
    ok: true,
    user: {
      id: user.id,
      email: user.email,
      nickname: user.nickname || "",
      accountType: normalizeAccountType(user.account_type),
      avatarUrl: user.avatar_url || "",
      siteId: user.site_id || "",
      siteSlug: user.site_slug || "",
      siteName: user.site_name || "",
    },
  };
}
