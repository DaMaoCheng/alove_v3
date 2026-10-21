import { checkEmailAvailability, getCurrentUser, loginUser, registerUser, resetPassword, sendEmailCode } from "./auth-service.js";
import { buildGoogleStartUrl, completeGoogleLogin, isGoogleAuthConfigured } from "./google-auth-service.js";
import { clearAuthCookie, getRequestIp, readAuthToken, readCookie, readJson, redirect, sendHtml, sendJson, setAuthCookie, setCookie } from "./http-utils.js";
import { createToken } from "./security.js";
import { GUEST_COOKIE_NAME } from "./guest-chat-service.js";
import { assertPublicAppOrigin } from "./request-origin-service.js";
import { resolveRequestAccess } from "./access-location-service.js";
import { resolvePublicSiteBranding } from "./site-branding-service.js";
import { createSiteCopy } from "../src/i18n/site-copy.js";

export async function handleAuthRoute(req, res, { path, requestUrl }) {
  if (req.method === "GET" && path === "/api/auth/google/start") {
    const siteSlug = normalizeSiteSlug(requestUrl.searchParams.get("siteSlug"));
    if (!isGoogleAuthConfigured()) {
      const copy = await resolveGooglePageCopy(siteSlug);
      sendHtml(res, 503, renderGoogleUnavailablePage({ copy, siteSlug }));
      return true;
    }
    const state = createToken();
    setCookie(res, "aiove_google_oauth_state", state, { maxAgeSeconds: 600 });
    setCookie(res, "aiove_google_oauth_site", siteSlug, { maxAgeSeconds: 600 });
    redirect(res, buildGoogleStartUrl(state));
    return true;
  }

  if (req.method === "GET" && path === "/api/auth/google/callback") {
    const expectedState = readCookie(req, "aiove_google_oauth_state");
    const siteSlug = normalizeSiteSlug(readCookie(req, "aiove_google_oauth_site"));
    const copy = await resolveGooglePageCopy(siteSlug);
    const actualState = String(requestUrl.searchParams.get("state") || "").trim();
    const providerError = String(requestUrl.searchParams.get("error") || "").trim();
    if (providerError) {
      clearGoogleOAuthCookies(res);
      sendHtml(res, 400, renderGoogleUnavailablePage({
        title: copy.t("auth.googleNotCompletedTitle"),
        message: copy.t("auth.googleNotCompletedBody"),
        copy,
        siteSlug,
      }));
      return true;
    }
    if (!expectedState || expectedState !== actualState) {
      clearGoogleOAuthCookies(res);
      sendHtml(res, 400, renderGoogleUnavailablePage({
        title: copy.t("auth.googleExpiredTitle"),
        message: copy.t("auth.googleExpiredBody"),
        copy,
        siteSlug,
      }));
      return true;
    }
    try {
      const result = await completeGoogleLogin({
        code: requestUrl.searchParams.get("code"),
        siteSlug,
        guestToken: readCookie(req, GUEST_COOKIE_NAME),
        access: resolveRequestAccess(req),
      });
      setAuthCookie(res, result.sessionToken, result.authResponse.maxAgeSeconds);
      clearClaimedGuestCookie(res, result.guestClaimInternal);
      clearGoogleOAuthCookies(res);
      redirect(res, buildGoogleAuthSuccessPath(result.authResponse, siteSlug));
    } catch (error) {
      clearGoogleOAuthCookies(res);
      sendHtml(res, Number(error?.statusCode || 400), renderGoogleUnavailablePage({
        title: copy.t("auth.googleFailedTitle"),
        message: copy.t("auth.googleTemporaryBody"),
        copy,
        siteSlug,
      }));
    }
    return true;
  }

  if (req.method === "POST" && path === "/api/auth/email/send-code") {
    sendJson(res, 200, await sendEmailCode({ ...(await readJson(req)), requestIp: getRequestIp(req) }));
    return true;
  }
  if (req.method === "POST" && path === "/api/auth/email/check") {
    sendJson(res, 200, await checkEmailAvailability(await readJson(req)));
    return true;
  }
  if (req.method === "POST" && path === "/api/auth/register") {
    const guestToken = readCookie(req, GUEST_COOKIE_NAME);
    if (guestToken) assertPublicAppOrigin(req);
    const result = await registerUser(await readJson(req), { guestToken, access: resolveRequestAccess(req) });
    setAuthCookie(res, result.sessionToken, result.authResponse.maxAgeSeconds);
    clearClaimedGuestCookie(res, result.guestClaimInternal);
    sendJson(res, 200, result.authResponse);
    return true;
  }
  if (req.method === "POST" && path === "/api/auth/login") {
    const guestToken = readCookie(req, GUEST_COOKIE_NAME);
    if (guestToken) assertPublicAppOrigin(req);
    const result = await loginUser(
      { ...(await readJson(req)), requestIp: getRequestIp(req) },
      { guestToken, access: resolveRequestAccess(req) }
    );
    setAuthCookie(res, result.sessionToken, result.authResponse.maxAgeSeconds);
    clearClaimedGuestCookie(res, result.guestClaimInternal);
    sendJson(res, 200, result.authResponse);
    return true;
  }
  if (req.method === "POST" && path === "/api/auth/forgot-password/reset") {
    sendJson(res, 200, await resetPassword(await readJson(req)));
    return true;
  }
  if (req.method === "POST" && path === "/api/auth/logout") {
    clearAuthCookie(res);
    sendJson(res, 200, { ok: true });
    return true;
  }
  if (req.method === "GET" && path === "/api/auth/me") {
    try {
      sendJson(res, 200, await getCurrentUser(req, readAuthToken));
    } catch (error) {
      if (Number(error?.statusCode || 0) === 401) clearAuthCookie(res);
      throw error;
    }
    return true;
  }
  return false;
}

function normalizeSiteSlug(value = "") {
  const normalized = String(value || "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 96);
  return normalized || "gogoalshop";
}

function clearGoogleOAuthCookies(res) {
  setCookie(res, "aiove_google_oauth_state", "", { maxAgeSeconds: 0 });
  setCookie(res, "aiove_google_oauth_site", "", { maxAgeSeconds: 0 });
}

function clearClaimedGuestCookie(res, guestClaim = null) {
  if (!guestClaim?.clearGuestCookie) return;
  setCookie(res, GUEST_COOKIE_NAME, "", { maxAgeSeconds: 0 });
}

function buildGoogleAuthSuccessPath(result = {}, fallbackSiteSlug = "gogoalshop") {
  const safeSiteSlug = normalizeSiteSlug(result.siteSlug || fallbackSiteSlug);
  const characterId = String(result.landingCharacterId || "").trim();
  const siteMismatch = result.guestClaim?.status === "site_mismatch";
  if (characterId) {
    const path = `/${safeSiteSlug}/chat?agent=${encodeURIComponent(characterId)}`;
    return siteMismatch ? `${path}&authNotice=guest-site-mismatch` : path;
  }
  const path = `/${safeSiteSlug}/discover`;
  return siteMismatch ? `${path}?authNotice=guest-site-mismatch` : path;
}

async function resolveGooglePageCopy(siteSlug = "") {
  try {
    const branding = await resolvePublicSiteBranding(siteSlug);
    return createSiteCopy(branding?.language || "English");
  } catch {
    return createSiteCopy("English");
  }
}

function renderGoogleUnavailablePage({ title = "", message = "", siteSlug = "gogoalshop", copy = createSiteCopy("English") } = {}) {
  const safeTitle = escapeHtml(title || copy.t("auth.googleUnavailableTitle"));
  const safeMessage = escapeHtml(message || copy.t("auth.googleTemporaryBody"));
  const safeSiteSlug = normalizeSiteSlug(siteSlug);
  return `<!doctype html>
<html lang="${escapeHtml(copy.language.code)}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(copy.t("auth.googlePageTitle"))}</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px; font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f7faf8; color: #132019; }
    main { width: min(420px, 100%); text-align: center; }
    h1 { margin: 0 0 10px; font-size: 24px; }
    p { margin: 0 0 22px; color: #617066; line-height: 1.6; }
    a { display: inline-flex; align-items: center; justify-content: center; min-height: 42px; padding: 0 18px; border-radius: 999px; background: #163f2b; color: #fff; text-decoration: none; font-weight: 700; }
  </style>
</head>
<body>
  <main>
    <h1>${safeTitle}</h1>
    <p>${safeMessage}</p>
    <a href="/${safeSiteSlug}/login">${escapeHtml(copy.t("auth.backToSignIn"))}</a>
  </main>
</body>
</html>`;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
