import { withTransaction } from "./db.js";
import { activateRegistrationMascotForDb } from "./mascot-activation-service.js";
import { activateUserCharacterForDb } from "./character-activation-service.js";
import { claimGuestSessionForUser, GUEST_CLAIM_STATUSES, toPublicGuestClaim } from "./guest-auth-claim-service.js";
import { acquireGuestReplyLockForToken } from "./guest-chat-service.js";
import { createId, hashSecret, verifySecret } from "./security.js";
import { findUserByEmail } from "./auth-user-service.js";
import { recordTtmallBindingCandidate } from "./ttmall-account-binding-service.js";
import { consumeEmailCode, sendEmailCode, checkEmailAvailability } from "./email-code-service.js";
import {
  LOGIN_ERROR_MESSAGE,
  assertLoginAllowed,
  clearLoginFailures,
  recordLoginFailure,
} from "./auth-login-throttle-service.js";
import { getCurrentUser, issueUserSession, requireAuth, SESSION_MAX_AGE_SECONDS } from "./auth-session-service.js";
import { resolveReferralInvite, resolveRegistrationSite } from "./registration-site-service.js";
import {
  isValidEmail,
  normalizeAccountType,
  normalizeEmail,
  normalizeLocale,
  normalizeNickname,
  normalizeRequestIp,
  throwUserError,
} from "./auth-normalizers.js";

const LOGIN_INVALID_CREDENTIALS = "LOGIN_INVALID_CREDENTIALS";

export { checkEmailAvailability, getCurrentUser, requireAuth, resolveRegistrationSite, sendEmailCode };
export { isValidEmail, normalizeAccountType, normalizeEmail, normalizeNickname, throwUserError };
export async function registerUser(payload = {}, { guestToken = "", access = null } = {}) {
  const email = normalizeEmail(payload.email);
  const nickname = normalizeNickname(payload.nickname || payload.displayName || email.split("@")[0]);
  const password = String(payload.password || "");
  const confirmPassword = String(payload.confirmPassword || "");
  const verificationCode = String(payload.verificationCode || payload.code || "").trim();
  const locale = normalizeLocale(payload.locale);

  assertEmailPasswordPayload({ email, password, confirmPassword });
  if (!verificationCode) throwUserError("Please enter the verification code.");
  const releaseGuestReplyLock = await acquireGuestReplyLockForToken(guestToken);
  try {
    const registered = await withTransaction(async (db) => {
    const existing = await findUserByEmail(email, db);
    if (existing) throwUserError("This email is already registered. Please sign in.");

    await consumeEmailCode(db, { email, scene: "register", code: verificationCode });

    const userId = createId("u");
    const site = await resolveRegistrationSite(payload.siteSlug, db);
    const invite = await resolveReferralInvite(payload.inviteCode, site, db);
    await db.execute(
      `INSERT INTO users (
         id, platform, platform_uid, locale, username, password_hash, nickname,
         email, email_verified_at, email_auth_provider, account_type, site_id,
         used_referral_code, last_seen_at
       ) VALUES (?, 'web', ?, ?, ?, ?, ?, ?, NOW(3), 'email', 'personal', ?, ?, NOW(3))`,
      [userId, email, locale, email, hashSecret(password), nickname, email, site.id, invite?.code || null]
    );
    await db.execute(
      `INSERT INTO billing_accounts (internal_uid, balance, currency)
       VALUES (?, 0, 'credits')`,
      [userId]
    );
    const guestClaim = await claimGuestSessionForUser(db, {
      guestToken,
      userId,
      strictSiteMatch: true,
    });
    if (guestClaim.status === GUEST_CLAIM_STATUSES.CLAIMED) {
      await activateUserCharacterForDb(db, {
        userId,
        characterId: guestClaim.characterId,
        sourceType: "guest_claim",
        sourceRef: "registration-guest-claim",
      });
    } else {
      await activateRegistrationMascotForDb(db, { userId, siteId: site.id });
    }

    return exposeAuthResult(await issueUserSession({
      id: userId,
      email,
      nickname,
      account_type: "personal",
      avatar_url: "",
      site_id: site.id,
      site_slug: site.slug,
      site_name: site.name,
    }, { db, maxAgeSeconds: SESSION_MAX_AGE_SECONDS, access }), { guestClaim });
    });
    try {
      await recordTtmallBindingCandidate({
        userId: registered.authResponse.userId,
        email,
        siteSlug: registered.authResponse.user.siteSlug,
      });
    } catch (error) {
      // AIOVE registration stays committed if the local-only TTMall test source is unavailable.
      console.warn("[aiove] TTMall binding candidate registration failed", { name: String(error?.name || "Error") });
    }
    return registered;
  } finally {
    await releaseGuestReplyLock();
  }
}

export async function loginUser(payload = {}, { guestToken = "", access = null } = {}) {
  const email = normalizeEmail(payload.username || payload.email);
  const password = String(payload.password || "");
  const remember = payload.remember !== false;
  const requestIp = normalizeRequestIp(payload.requestIp);
  assertLoginAllowed({ email, requestIp });
  if (!isValidEmail(email) || !password) {
    recordLoginFailure({ email, requestIp });
    throwUserError(LOGIN_ERROR_MESSAGE, 401, LOGIN_INVALID_CREDENTIALS);
  }
  const user = await findUserByEmail(email);
  if (!user || String(user.account_status || "active") !== "active" || !verifySecret(password, user.password_hash)) {
    recordLoginFailure({ email, requestIp });
    throwUserError(LOGIN_ERROR_MESSAGE, 401, LOGIN_INVALID_CREDENTIALS);
  }

  const maxAgeSeconds = remember ? SESSION_MAX_AGE_SECONDS : 12 * 60 * 60;
  let result;
  if (guestToken) {
    const releaseGuestReplyLock = await acquireGuestReplyLockForToken(guestToken);
    try {
      result = await withTransaction(async (db) => {
        const guestClaim = await claimGuestSessionForUser(db, {
          guestToken,
          userId: user.id,
          strictSiteMatch: false,
        });
        if (guestClaim.status === GUEST_CLAIM_STATUSES.CLAIMED) {
          await activateUserCharacterForDb(db, {
            userId: user.id,
            characterId: guestClaim.characterId,
            sourceType: "guest_claim",
            sourceRef: "login-guest-claim",
          });
        }
        return exposeAuthResult(await issueUserSession(user, { db, maxAgeSeconds, access }), { guestClaim });
      });
    } finally {
      await releaseGuestReplyLock();
    }
  } else {
    result = exposeAuthResult(await issueUserSession(user, { maxAgeSeconds, access }));
  }
  clearLoginFailures({ email, requestIp });
  return result;
}

export async function resetPassword(payload = {}) {
  const email = normalizeEmail(payload.email);
  const password = String(payload.password || "");
  const confirmPassword = String(payload.confirmPassword || "");
  const verificationCode = String(payload.verificationCode || payload.code || "").trim();

  assertEmailPasswordPayload({ email, password, confirmPassword });
  if (!verificationCode) throwUserError("Please enter the verification code.");
  return withTransaction(async (db) => {
    const user = await findUserByEmail(email, db);
    if (!user) throwUserError("No account exists for this email.");
    await consumeEmailCode(db, { email, scene: "forgot_password", code: verificationCode });
    await db.execute(
      "UPDATE users SET password_hash = ?, auth_token = NULL, token_expires_at = NULL, updated_at = NOW(3) WHERE id = ?",
      [hashSecret(password), user.id]
    );
    return { ok: true };
  });
}

function assertEmailPasswordPayload({ email, password, confirmPassword }) {
  if (!isValidEmail(email)) throwUserError("Please enter a valid email address.");
  if (!password) throwUserError("Please enter a password.");
  if (password.length < 8) throwUserError("Password must be at least 8 characters.");
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) throwUserError("Password must include letters and numbers.");
  if (!confirmPassword) throwUserError("Please confirm your password.");
  if (password !== confirmPassword) throwUserError("The two passwords do not match.");
}

function exposeAuthResult(result, { guestClaim = null } = {}) {
  const authResponse = guestClaim ? { ...result.authResponse, guestClaim: toPublicGuestClaim(guestClaim) } : result.authResponse;
  return {
    ...authResponse,
    sessionToken: result.sessionToken,
    authResponse,
    guestClaimInternal: guestClaim,
  };
}
