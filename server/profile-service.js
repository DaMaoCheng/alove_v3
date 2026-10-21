import { normalizeNickname } from "./auth-service.js";
import { getDbPool, withTransaction } from "./db.js";
import { createPublicError } from "./public-error-utils.js";
import { createNumericCode } from "./security.js";

export async function getUserProfile(user) {
  const userId = normalizeUserId(user);
  await ensureReferralCode(userId);
  const [[row]] = await getDbPool().execute(
    `${profileSelectSql()} WHERE u.id = ? LIMIT 1`,
    [userId]
  );
  if (!row) throwNotFound();
  return { ok: true, profile: mapProfileRow(row) };
}

export async function updateUserProfile(user, payload = {}) {
  const userId = normalizeUserId(user);
  const nickname = normalizeNickname(payload.nickname);
  const favoriteClub = normalizeFavoriteClub(payload.favoriteClub);
  if (!nickname) throwUserError("请输入昵称");

  await withTransaction(async (db) => {
    await ensureReferralCode(userId, db);
    const [result] = await db.execute(
      `UPDATE users
       SET nickname = ?, favorite_club = ?, updated_at = NOW(3)
       WHERE id = ?
       LIMIT 1`,
      [nickname, favoriteClub || null, userId]
    );
    if (!result.affectedRows) throwNotFound();
  });

  return getUserProfile({ id: userId });
}

async function ensureReferralCode(userId, db = getDbPool()) {
  const [[row]] = await db.execute("SELECT referral_code FROM users WHERE id = ? LIMIT 1", [userId]);
  if (!row) throwNotFound();
  if (String(row.referral_code || "").trim()) return row.referral_code;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = createReferralCode(userId);
    try {
      await db.execute("UPDATE users SET referral_code = ?, updated_at = NOW(3) WHERE id = ? AND (referral_code IS NULL OR referral_code = '') LIMIT 1", [code, userId]);
      return code;
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
    }
  }

  const error = new Error("邀请码生成失败，请稍后再试");
  error.statusCode = 500;
  throw error;
}

function profileSelectSql() {
  return `SELECT
     u.id,
     u.email,
     u.nickname,
     u.account_type,
     u.favorite_club,
     u.referral_code,
     u.site_id,
     s.slug AS site_slug,
     s.name AS site_name,
     latest_oauth.avatar_url,
     COALESCE(stats.chat_count, 0) AS chat_count,
     COALESCE(activations.legend_count, 0) AS legend_count,
     COALESCE(kits.kits_unlocked, 0) AS kits_unlocked,
     COALESCE(invites.friends_joined, 0) AS friends_joined,
     COALESCE(invites.reward_credits, 0) AS reward_credits
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
   LEFT JOIN (
     SELECT s.internal_uid, COUNT(m.id) AS chat_count
     FROM chat_sessions s
     LEFT JOIN chat_messages m ON m.session_id = s.id AND m.sender_type = 'user'
     WHERE s.internal_uid IS NOT NULL
       AND s.session_status = 'active'
       AND s.source_type = 'user'
     GROUP BY s.internal_uid
   ) stats ON stats.internal_uid = u.id
   LEFT JOIN (
     SELECT internal_uid, COUNT(*) AS legend_count
     FROM user_character_activations
     WHERE activation_status = 'active'
     GROUP BY internal_uid
   ) activations ON activations.internal_uid = u.id
   LEFT JOIN (
     SELECT internal_uid, COUNT(DISTINCT ref_id) AS kits_unlocked
     FROM billing_logs
     WHERE charged > 0
       AND (reason IN ('kit_unlock', 'product_unlock', 'merch_unlock') OR message_type IN ('kit_unlock', 'product_unlock', 'merch_unlock'))
     GROUP BY internal_uid
   ) kits ON kits.internal_uid = u.id
   LEFT JOIN (
     SELECT used_referral_code, COUNT(*) AS friends_joined, COUNT(*) * 5 AS reward_credits
     FROM users
     WHERE used_referral_code IS NOT NULL AND used_referral_code <> ''
     GROUP BY used_referral_code
   ) invites ON invites.used_referral_code = u.referral_code`;
}

function mapProfileRow(row) {
  const displayName = row.nickname || emailName(row.email) || "AIOVE User";
  const referralCode = row.referral_code || "";
  return {
    id: row.id,
    email: row.email || "",
    nickname: row.nickname || "",
    displayName,
    accountType: normalizeAccountType(row.account_type),
    avatarUrl: row.avatar_url || "",
    favoriteClub: row.favorite_club || "",
    siteId: row.site_id || "",
    siteSlug: row.site_slug || "",
    siteName: row.site_name || "",
    stats: {
      chats: Number(row.chat_count || 0),
      legends: Number(row.legend_count || 0),
      kitsUnlocked: Number(row.kits_unlocked || 0),
    },
    invite: {
      code: referralCode,
      friendsJoined: Number(row.friends_joined || 0),
      earnedCredits: Number(row.reward_credits || 0),
    },
  };
}

function createReferralCode(userId) {
  const suffix = String(userId || "").replace(/[^a-z0-9]/gi, "").slice(-4).toUpperCase() || "AIOV";
  return `AIOVE-${suffix}${createNumericCode(4)}`;
}

function normalizeFavoriteClub(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 128);
}

function normalizeUserId(user) {
  const userId = String(user?.id || "").trim();
  if (!userId) throwUserError("未登录，请先登录");
  return userId;
}

function normalizeAccountType(value = "personal") {
  const normalized = String(value || "").trim().toLowerCase();
  return ["personal", "creator", "admin"].includes(normalized) ? normalized : "personal";
}

function emailName(email = "") {
  return String(email || "").split("@")[0]?.trim();
}

function isDuplicateKeyError(error) {
  return error?.code === "ER_DUP_ENTRY" || Number(error?.errno || 0) === 1062;
}

function throwUserError(message) {
  throw createPublicError(message, 400);
}

function throwNotFound() {
  throw createPublicError("用户不存在", 404);
}
