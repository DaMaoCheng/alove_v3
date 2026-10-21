import { SERVER_CONFIG } from "./config.js";
import { getDbPool, withTransaction } from "./db.js";
import { normalizeEmail, normalizeNickname, resolveRegistrationSite, throwUserError } from "./auth-service.js";
import { issueUserSession, SESSION_MAX_AGE_SECONDS } from "./auth-session-service.js";
import { activateRegistrationMascotForDb } from "./mascot-activation-service.js";
import { activateUserCharacterForDb } from "./character-activation-service.js";
import { claimGuestSessionForUser, GUEST_CLAIM_STATUSES, toPublicGuestClaim } from "./guest-auth-claim-service.js";
import { acquireGuestReplyLockForToken } from "./guest-chat-service.js";
import { createId, createToken, hashSecret } from "./security.js";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";
export function isGoogleAuthConfigured() {
  return Boolean(SERVER_CONFIG.google.clientId && SERVER_CONFIG.google.clientSecret);
}

export function buildGoogleStartUrl(state) {
  if (!isGoogleAuthConfigured()) {
    const error = new Error("Google sign-in is not configured yet.");
    error.statusCode = 503;
    throw error;
  }

  const params = new URLSearchParams({
    client_id: SERVER_CONFIG.google.clientId,
    redirect_uri: SERVER_CONFIG.google.redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

export async function completeGoogleLogin({ code, siteSlug, guestToken = "", access = null } = {}) {
  if (!isGoogleAuthConfigured()) {
    const error = new Error("Google sign-in is not configured yet.");
    error.statusCode = 503;
    throw error;
  }
  const authCode = String(code || "").trim();
  if (!authCode) throwUserError("Missing Google authorization code.");

  const tokenPayload = await requestGoogleToken(authCode);
  const profile = await requestGoogleProfile(tokenPayload.access_token);
  const providerUserId = String(profile.sub || "").trim();
  const email = normalizeEmail(profile.email);
  if (!providerUserId || !email) throwUserError("Google account information is incomplete.");

  const releaseGuestReplyLock = await acquireGuestReplyLockForToken(guestToken);
  try {
    return await withTransaction(async (db) => {
    const existingOAuthUser = await findOAuthUser(db, providerUserId);
    if (existingOAuthUser) {
      return finishGoogleLogin(db, existingOAuthUser.id, {
        isNewUser: false,
        guestToken,
        access,
      });
    }

    const existingEmailUser = await findUserByEmail(db, email);
    const userId = existingEmailUser?.id || createId("u");
    let site = null;
    if (!existingEmailUser) {
      site = await resolveRegistrationSite(siteSlug, db);
      await createGoogleBackedUser(db, {
        userId,
        email,
        nickname: normalizeNickname(profile.name || email.split("@")[0]),
        siteId: site.id,
      });
    }

    await db.execute(
      `INSERT INTO oauth_accounts (
         internal_uid, provider, provider_user_id, email, display_name, avatar_url, raw_profile_json
       ) VALUES (?, 'google', ?, ?, ?, ?, ?)`,
      [
        userId,
        providerUserId,
        email,
        normalizeNickname(profile.name || ""),
        String(profile.picture || "").trim() || null,
        JSON.stringify(profile),
      ]
    );

    return finishGoogleLogin(db, userId, {
      isNewUser: !existingEmailUser,
      guestToken,
      registrationSiteId: site?.id || "",
      access,
    });
    });
  } finally {
    await releaseGuestReplyLock();
  }
}

async function finishGoogleLogin(db, userId, {
  isNewUser = false,
  guestToken = "",
  registrationSiteId = "",
  access = null,
} = {}) {
  const guestClaim = await claimGuestSessionForUser(db, {
    guestToken,
    userId,
    strictSiteMatch: isNewUser,
  });
  if (guestClaim.status === GUEST_CLAIM_STATUSES.CLAIMED) {
    await activateUserCharacterForDb(db, {
      userId,
      characterId: guestClaim.characterId,
      sourceType: "guest_claim",
      sourceRef: "google-guest-claim",
    });
  } else if (isNewUser) {
    await activateRegistrationMascotForDb(db, { userId, siteId: registrationSiteId });
  }
  return issueSession(db, userId, { isNewUser, guestClaim, access });
}

async function requestGoogleToken(code) {
  const response = await fetchGoogle(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: SERVER_CONFIG.google.clientId,
      client_secret: SERVER_CONFIG.google.clientSecret,
      redirect_uri: SERVER_CONFIG.google.redirectUri,
      grant_type: "authorization_code",
    }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.access_token) {
    const error = new Error("Google authorization failed. Please try again later.");
    error.statusCode = 400;
    throw error;
  }
  return payload;
}

async function requestGoogleProfile(accessToken) {
  const response = await fetchGoogle(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.sub) {
    const error = new Error("Could not read your Google account information.");
    error.statusCode = 400;
    throw error;
  }
  return payload;
}

async function fetchGoogle(url, options) {
  try {
    return await fetch(url, options);
  } catch (cause) {
    const error = new Error("Google sign-in is temporarily unavailable. Please try again later.");
    error.statusCode = 503;
    error.cause = cause;
    throw error;
  }
}

async function findOAuthUser(db, providerUserId) {
  const [rows] = await db.execute(
    `SELECT u.*
     FROM oauth_accounts oa
     JOIN users u ON u.id = oa.internal_uid
     WHERE oa.provider = 'google' AND oa.provider_user_id = ?
     LIMIT 1`,
    [providerUserId]
  );
  return rows[0] || null;
}

async function findUserByEmail(db, email) {
  const [rows] = await db.execute(
    "SELECT * FROM users WHERE email = ? LIMIT 1",
    [email]
  );
  return rows[0] || null;
}

async function createGoogleBackedUser(db, { userId, email, nickname, siteId }) {
  const placeholderPasswordHash = hashSecret(createToken());
  await db.execute(
    `INSERT INTO users (
     id, platform, platform_uid, locale, username, password_hash, nickname,
       email, email_verified_at, email_auth_provider, account_type, site_id, last_seen_at
     ) VALUES (?, 'web', ?, 'cn', ?, ?, ?, ?, NOW(3), 'google', 'personal', ?, NOW(3))`,
    [userId, email, email, placeholderPasswordHash, nickname, email, siteId]
  );
  await db.execute(
    "INSERT INTO billing_accounts (internal_uid, balance, currency) VALUES (?, 0, 'credits')",
    [userId]
  );
}

async function issueSession(db, userId, { isNewUser = false, guestClaim = null, access = null } = {}) {
  const [rows] = await db.execute(
    `SELECT u.id, u.email, u.nickname, u.account_type, u.site_id, latest_oauth.avatar_url, s.slug AS site_slug, s.name AS site_name
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
     WHERE u.id = ?
     LIMIT 1`,
    [userId]
  );
  const user = rows[0] || { id: userId };
  const landingCharacterId = guestClaim?.claimed
    ? guestClaim.characterId
    : await findAuthLandingCharacterId(db, userId);
  const session = await issueUserSession(user, { db, maxAgeSeconds: SESSION_MAX_AGE_SECONDS, access });
  return {
    sessionToken: session.sessionToken,
    authResponse: {
      ...session.authResponse,
      userId,
      accountType: ["personal", "creator", "admin"].includes(String(user.account_type || "")) ? user.account_type : "personal",
      siteSlug: user.site_slug || "",
      landingCharacterId,
      isNewUser,
      ...(guestClaim ? { guestClaim: toPublicGuestClaim(guestClaim) } : {}),
      maxAgeSeconds: SESSION_MAX_AGE_SECONDS,
    },
    guestClaimInternal: guestClaim,
  };
}

async function findAuthLandingCharacterId(db, userId) {
  const [rows] = await db.execute(
    `SELECT a.character_id
     FROM user_character_activations a
     INNER JOIN ai_characters c ON c.id = a.character_id
     WHERE a.internal_uid = ?
       AND a.activation_status = 'active'
       AND c.character_status = 'published'
       AND (c.visibility = 'public' OR c.owner_uid = ?)
     ORDER BY a.updated_at DESC, a.activated_at DESC
     LIMIT 1`,
    [userId, userId]
  );
  return rows[0]?.character_id || "";
}
