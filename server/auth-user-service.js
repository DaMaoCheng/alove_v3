import { getDbPool } from "./db.js";
import { normalizeEmail } from "./auth-normalizers.js";

export async function findUserByEmail(email, db = getDbPool()) {
  const [rows] = await db.execute(
    `SELECT u.*, s.slug AS site_slug, s.name AS site_name, latest_oauth.avatar_url
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
     WHERE u.email = ?
     LIMIT 1`,
    [normalizeEmail(email)]
  );
  return rows[0] || null;
}
