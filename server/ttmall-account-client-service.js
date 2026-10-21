import { randomBytes } from "node:crypto";
import { SERVER_CONFIG } from "./config.js";
import { createPublicError } from "./public-error-utils.js";
import { safeString } from "./product-source-shared-service.js";
import { fetchTtmallApiBytes, fetchTtmallApiJson } from "./product-source-ttmall-client-service.js";

const CAPTCHA_PURPOSE_IDS = Object.freeze({ login: "1", register: "2" });
const MAX_EMAIL_LENGTH = 254;
const MAX_PASSWORD_LENGTH = 128;
const MAX_CHECK_CODE_LENGTH = 64;
const CAPTCHA_SESSION_TTL_MS = 5 * 60_000;
const MAX_CAPTCHA_SESSIONS = 128;
const captchaSessions = new Map();

export async function requestTtmallAccountCaptcha(source, purpose = "", { timeoutMs = SERVER_CONFIG.productApi.timeoutMs, sessionScope = {} } = {}) {
  const normalizedPurpose = safeString(purpose).toLowerCase();
  const purposeId = CAPTCHA_PURPOSE_IDS[normalizedPurpose];
  if (!purposeId) throw createPublicError("Invalid verification request.", 400, "TTMALL_CAPTCHA_PURPOSE_INVALID");
  let result;
  try {
    result = await fetchTtmallApiBytes(source, `/v1/user/verify?id=${encodeURIComponent(purposeId)}`, {
      timeoutMs,
      maxBytes: 512 * 1024,
    });
  } catch {
    throw createPublicError("TTMall verification is temporarily unavailable. Please refresh and try again.", 503, "TTMALL_CAPTCHA_UNAVAILABLE");
  }
  const captcha = normalizeCaptcha({
    base64: result.buffer.toString("base64"),
    contentType: result.contentType,
  });
  if (!captcha) {
    throw createPublicError("TTMall verification is temporarily unavailable. Please refresh and try again.", 503, "TTMALL_CAPTCHA_UNAVAILABLE");
  }
  const captchaSessionId = createCaptchaSession({
    source,
    purpose: normalizedPurpose,
    sessionScope,
    cookie: toCookieHeader(result.setCookies),
  });
  if (!captchaSessionId) {
    throw createPublicError("TTMall verification is temporarily unavailable. Please refresh and try again.", 503, "TTMALL_CAPTCHA_UNAVAILABLE");
  }
  return { ok: true, captcha, captchaSessionId, purpose: normalizedPurpose };
}

export async function signInTtmallAccount(source, payload = {}, { timeoutMs = SERVER_CONFIG.productApi.timeoutMs, sessionScope = {} } = {}) {
  return submitTtmallAccount(source, "/v1/user/sign", payload, { timeoutMs, mode: "login", sessionScope });
}

export async function registerTtmallAccount(source, payload = {}, { timeoutMs = SERVER_CONFIG.productApi.timeoutMs, sessionScope = {} } = {}) {
  const password = validateRegistrationPassword(payload.password);
  const confirmPassword = readPassword(payload.confirmPassword || payload.repassword);
  if (!confirmPassword || password !== confirmPassword) {
    throw createPublicError("Please make sure the two passwords match.", 400, "TTMALL_PASSWORD_CONFIRMATION_INVALID");
  }
  return submitTtmallAccount(source, "/v1/user/register", { ...payload, password, repassword: confirmPassword }, { timeoutMs, mode: "register", sessionScope });
}

async function submitTtmallAccount(source, pathname, payload, { timeoutMs, mode, sessionScope }) {
  const email = readEmail(payload.email);
  const password = readPassword(payload.password);
  const checkcode = readCheckCode(payload.checkcode || payload.checkCode || payload.verificationCode);
  if (!email || !password || !checkcode) {
    throw createPublicError("Please complete your TTMall email, password, and verification code.", 400, "TTMALL_CREDENTIALS_REQUIRED");
  }
  const body = mode === "register"
    ? { email, password, repassword: readPassword(payload.repassword), checkcode }
    : { email, password, checkcode };
  const captchaSession = consumeCaptchaSession({
    source,
    purpose: mode,
    sessionScope,
    captchaSessionId: payload.captchaSessionId || payload.captcha_session_id,
  });
  const response = await requestTtmallAccountApi(source, pathname, {
    timeoutMs,
    method: "POST",
    body,
    sessionCookie: captchaSession.cookie,
  });
  const responseData = response?.data && typeof response.data === "object" ? response.data : {};
  const user = responseData.user && typeof responseData.user === "object"
    ? responseData.user
    : (responseData.user_info && typeof responseData.user_info === "object"
      ? responseData.user_info
      : (response?.user && typeof response.user === "object" ? response.user : {}));
  const token = safeString(user.token || response?.data?.token || response?.token);
  const resolvedEmail = readEmail(user.email || responseData.email || email);
  const externalUserId = resolveExternalUserId(user, resolvedEmail);
  if (!token || !externalUserId || !resolvedEmail) {
    throw createPublicError("TTMall did not return a usable account session. Please try again.", 422, "TTMALL_ACCOUNT_SESSION_MISSING");
  }
  return { externalUserId, email: resolvedEmail, token, providerCode: safeString(response?.code || "") };
}

async function requestTtmallAccountApi(source, pathname, { timeoutMs, method = "GET", body = null, sessionCookie = "" } = {}) {
  let result;
  try {
    // TTMall user endpoints still require the site-scoped service bearer token.
    // The user's token is never sent until a later cart/order phase.
    result = await fetchTtmallApiJson(source, pathname, {
      timeoutMs,
      method,
      body,
      sessionCookie,
      retryAuth: false,
      allowErrorPayload: true,
      includeResponseMeta: true,
    });
  } catch {
    throw createPublicError("TTMall is temporarily unavailable. Please try again later.", 503, "TTMALL_ACCOUNT_UPSTREAM_UNAVAILABLE");
  }
  const status = Number(result?.status || 0);
  const payload = result?.payload && typeof result.payload === "object" ? result.payload : {};
  const code = Number(payload.code);
  if (status >= 200 && status < 300 && [0, 1, 200].includes(code)) return payload;
  throw resolveUpstreamError(payload, status);
}

function createCaptchaSession({ source, purpose, sessionScope, cookie }) {
  pruneCaptchaSessions();
  const scopeKey = toSessionScopeKey(sessionScope);
  if (!cookie || !source?.cacheKey || !CAPTCHA_PURPOSE_IDS[purpose] || !scopeKey) return "";
  while (captchaSessions.size >= MAX_CAPTCHA_SESSIONS) captchaSessions.delete(captchaSessions.keys().next().value);
  const id = randomBytes(24).toString("base64url");
  captchaSessions.set(id, {
    sourceCacheKey: source.cacheKey,
    purpose,
    scopeKey,
    cookie,
    expiresAt: Date.now() + CAPTCHA_SESSION_TTL_MS,
  });
  return id;
}

function consumeCaptchaSession({ source, purpose, sessionScope, captchaSessionId }) {
  pruneCaptchaSessions();
  const id = safeString(captchaSessionId);
  const session = captchaSessions.get(id);
  captchaSessions.delete(id);
  if (!session
    || session.sourceCacheKey !== source?.cacheKey
    || session.purpose !== purpose
    || session.scopeKey !== toSessionScopeKey(sessionScope)
    || session.expiresAt <= Date.now()) {
    throw createPublicError("The verification code has expired. Please refresh it and try again.", 401, "TTMALL_CAPTCHA_SESSION_INVALID");
  }
  return session;
}

function toSessionScopeKey({ userId = "", siteId = "" } = {}) {
  const normalizedUserId = safeString(userId);
  const normalizedSiteId = safeString(siteId);
  return normalizedUserId && normalizedSiteId ? `${normalizedUserId}|${normalizedSiteId}` : "";
}

function toCookieHeader(values = []) {
  const pairs = (Array.isArray(values) ? values : [values])
    .map((value) => safeString(value).split(";", 1)[0])
    .filter((value) => /^[A-Za-z0-9!#$%&'*+.^_|~-]+=[^;\r\n]{1,2048}$/.test(value))
    .slice(0, 4);
  return pairs.length ? pairs.join("; ") : "";
}

function pruneCaptchaSessions() {
  const now = Date.now();
  for (const [id, session] of captchaSessions) {
    if (!session || session.expiresAt <= now) captchaSessions.delete(id);
  }
}

export function resetTtmallAccountCaptchaSessionsForTests() {
  captchaSessions.clear();
}

function resolveUpstreamError(payload = {}, status = 0) {
  const code = Number(payload.code);
  const message = safeString(payload.message || payload.msg || payload.error).toLowerCase();
  if (code === 1005) {
    return createPublicError("This TTMall email already has an account. Please sign in instead.", 409, "TTMALL_EMAIL_EXISTS");
  }
  if (code === 1006) {
    return createPublicError("This TTMall site requires an invitation code before an account can be created.", 422, "TTMALL_INVITATION_REQUIRED");
  }
  if (code === 1003) {
    return createPublicError("TTMall rejected one or more submitted fields. Refresh the verification image and check the email, passwords, and code.", 422, "TTMALL_ACCOUNT_REQUEST_INVALID");
  }
  if (/email.+(exist|used|register)|already.+(exist|register)|邮箱.*(已存在|已被|注册)/.test(message)) {
    return createPublicError("This TTMall email already has an account. Please sign in instead.", 409, "TTMALL_EMAIL_EXISTS");
  }
  if (/verif|captcha|checkcode|验证码|校验码/.test(message)) {
    return createPublicError("The verification code is incorrect or expired. Please refresh it and try again.", 401, "TTMALL_CAPTCHA_INVALID");
  }
  if (/password|密码/.test(message)) {
    return createPublicError("The TTMall password does not meet the required format. Please use letters and numbers.", 400, "TTMALL_PASSWORD_FORMAT_INVALID");
  }
  if (code === 1001 || code === 1002 || /credential|login|账户|账号/.test(message)) {
    return createPublicError("The TTMall email or password is incorrect.", 401, "TTMALL_ACCOUNT_AUTH_FAILED");
  }
  if (Number(status) === 429) return createPublicError("Too many TTMall requests. Please try again shortly.", 429, "TTMALL_ACCOUNT_RATE_LIMITED");
  if (Number(status) >= 500) return createPublicError("TTMall is temporarily unavailable. Please try again later.", 503, "TTMALL_ACCOUNT_UPSTREAM_UNAVAILABLE");
  return createPublicError("TTMall could not complete this request. Please check your details and try again.", 422, "TTMALL_ACCOUNT_REQUEST_FAILED");
}

function resolveExternalUserId(user = {}, email = "") {
  const raw = safeString(user.user_id || user.id || user.uid || user.userId);
  return raw ? `ttmall:${raw}` : `email:${safeString(email).toLowerCase()}`;
}

function normalizeCaptcha(value) {
  if (typeof value === "object" && value) {
    const contentType = safeString(value.contentType).toLowerCase();
    const imageValue = value.base64 || value.image || value.captcha || "";
    if (contentType && !/^image\/(png|jpeg|gif|webp)$/.test(contentType)) return "";
    const normalized = normalizeCaptcha(imageValue);
    if (!normalized) return "";
    return contentType && !normalized.startsWith("data:image/")
      ? `data:${contentType};base64,${safeString(imageValue)}`
      : normalized;
  }
  const text = safeString(value);
  if (!text) return "";
  if (/^(data:image\/|https:\/\/)/i.test(text)) return text;
  if (/^[a-z0-9+/=]+$/i.test(text) && text.length > 32) return `data:image/png;base64,${text}`;
  return "";
}

function readEmail(value) {
  const email = safeString(value).toLowerCase();
  return email.length <= MAX_EMAIL_LENGTH && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

function readPassword(value) {
  const password = String(value || "");
  return password.length >= 6 && password.length <= MAX_PASSWORD_LENGTH ? password : "";
}

function validateRegistrationPassword(value) {
  const password = readPassword(value);
  if (!password) {
    throw createPublicError("TTMall passwords must be between 6 and 128 characters.", 400, "TTMALL_PASSWORD_LENGTH_INVALID");
  }
  if (!/[a-z]/i.test(password) || !/\d/.test(password)) {
    throw createPublicError("TTMall passwords must include at least one letter and one number.", 400, "TTMALL_PASSWORD_FORMAT_INVALID");
  }
  return password;
}

function readCheckCode(value) {
  const code = safeString(value);
  return code.length > 0 && code.length <= MAX_CHECK_CODE_LENGTH ? code : "";
}
