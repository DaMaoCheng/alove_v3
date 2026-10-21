import { createSiteCopy } from "../i18n/site-copy.js";

const SYSTEM_ERROR_PATTERNS = [
  /\bHTTP\s+\d{3}\b/i,
  /\bECONN[A-Z_]*\b/i,
  /\bETIMEDOUT\b/i,
  /\bAbortError\b/i,
  /\bTypeError\b/i,
  /\bSyntaxError\b/i,
  /\bSQL\b/i,
  /\bMySQL\b/i,
  /\bstack\b/i,
  /\bOpenAI\b/i,
  /\bElevenLabs\b/i,
  /\bprovider\b/i,
  /\bfetch\b/i,
  /\bnetwork\b/i,
];

const VALIDATION_HINT_PATTERNS = [
  /\b(email|password|verification|code|invite|sign in|session|file|format|size|too large|unsupported|required|missing|permission|access denied|not found|registered)\b/i,
  /邮箱|邮件|密码|验证码|邀请码|登录|注册|文件|格式|大小|过大|不支持|不能为空|不存在|无权限|已存在|已注册/,
];

export function getUserFacingErrorMessage(error, {
  pageLanguage = "English",
  fallbackType = "generic",
  allowKnownValidation = true,
} = {}) {
  const copy = createSiteCopy(pageLanguage);
  const locale = copy.locale;
  const rawMessage = normalizeMessage(error?.message || error);
  const status = Number(error?.status || error?.payload?.status || 0);
  const fallback = resolveFallback(copy, fallbackType);

  if (status === 401) return copy.t("error.unauthorized");
  if (isNetworkLikeError(error, rawMessage)) return copy.t("error.network");
  if (status >= 500) return fallback;

  if (allowKnownValidation && isSafeKnownValidationMessage(rawMessage, locale)) {
    return rawMessage;
  }

  return fallback;
}

export function getRawErrorMessage(error) {
  return normalizeMessage(error?.message || error);
}

export function isChineseLanguage(language = "") {
  const normalized = String(language || "").trim().toLowerCase();
  return normalized.startsWith("zh") || normalized.includes("chinese") || normalized.includes("中文") || normalized.includes("中国");
}

function resolveFallback(copy, fallbackType) {
  const known = new Set(["generic", "chat", "voice", "attachment", "auth", "profileLoad", "profileSave"]);
  return copy.t(`error.${known.has(fallbackType) ? fallbackType : "generic"}`);
}

function isNetworkLikeError(error, message) {
  if (error?.name === "AbortError") return true;
  return /\b(failed to fetch|networkerror|load failed|network request failed)\b/i.test(message);
}

function isSafeKnownValidationMessage(message, locale) {
  if (!message) return false;
  if (SYSTEM_ERROR_PATTERNS.some((pattern) => pattern.test(message))) return false;
  if (!VALIDATION_HINT_PATTERNS.some((pattern) => pattern.test(message))) return false;
  if (locale === "en" && /[\u4e00-\u9fff]/.test(message)) return false;
  if (locale === "zh" && !/[\u4e00-\u9fff]/.test(message)) return false;
  return message.length <= 180;
}

function normalizeMessage(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}
