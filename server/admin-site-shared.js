import { isReservedSiteSlug } from "../shared/site-slug.js";

export function normalizeSlug(value = "") {
  const slug = safeString(value)
    .toLowerCase()
    .replace(/^\/+/, "")
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 96);
  if (isReservedSiteSlug(slug)) throwUserError("站点路径与系统保留路径冲突，请使用其他 slug");
  return slug;
}

export function nullableText(value, maxLength) {
  const normalized = safeString(value).slice(0, maxLength);
  return normalized || null;
}

export function normalizeSiteUrl(value) {
  const normalized = safeString(value).slice(0, 512);
  if (!normalized) return null;
  if (/^https?:\/\//i.test(normalized)) return normalized;
  return `https://${normalized.replace(/^\/+/, "")}`;
}

export function normalizeSiteLogoUrl(value) {
  const raw = safeString(value);
  if (!raw) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw) && !/^https?:\/\//i.test(raw)) {
    throwUserError("站点 Logo 必须是有效的 HTTP(S) 图片链接");
  }
  const normalized = /^https?:\/\//i.test(raw) ? raw : `https://${raw.replace(/^\/+/, "")}`;
  try {
    const url = new URL(normalized);
    if (!["http:", "https:"].includes(url.protocol) || !url.hostname || url.username || url.password) throw new Error("invalid logo url");
    const result = url.toString();
    if (result.length > 512) throw new Error("logo url too long");
    return result;
  } catch {
    throwUserError("站点 Logo 必须是有效的 HTTP(S) 图片链接");
  }
}

export function normalizeOneOf(value, allowed, fallback) {
  const normalized = safeString(value).toLowerCase();
  return allowed.includes(normalized) ? normalized : fallback;
}

export function parseBoolean(value) {
  if (value === true || value === 1) return true;
  const normalized = safeString(value).toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

export function parseJsonArray(value) {
  if (Array.isArray(value)) return value.map((item) => safeString(item)).filter(Boolean);
  if (value == null || value === "") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((item) => safeString(item)).filter(Boolean) : [];
  } catch {
    return [];
  }
}

export function safeString(value) {
  return String(value == null ? "" : value).trim();
}

export function throwUserError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  throw error;
}

export function throwNotFound() {
  const error = new Error("站点不存在");
  error.statusCode = 404;
  throw error;
}
