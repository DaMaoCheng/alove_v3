import { requireAuth } from "./auth-service.js";
import { SERVER_CONFIG } from "./config.js";
import { readAuthToken } from "./http-utils.js";

export const ADMIN_SCOPES = Object.freeze({
  READ: "admin:read",
  ACCOUNTS_WRITE: "admin:accounts:write",
  CAROUSEL_WRITE: "admin:carousel:write",
  CHARACTERS_WRITE: "admin:characters:write",
  FEEDBACK_WRITE: "admin:feedback:write",
  KITSHOP_WRITE: "admin:kitshop:write",
  KNOWLEDGE_WRITE: "admin:knowledge:write",
  MASCOT_WRITE: "admin:mascot:write",
  PROMOTIONS_WRITE: "admin:promotions:write",
  SITES_WRITE: "admin:sites:write",
});

export function decodeUploadFilename(value) {
  const raw = Array.isArray(value) ? value[0] : value;
  try {
    return decodeURIComponent(String(raw || "").trim());
  } catch {
    return String(raw || "").trim();
  }
}

export async function requireAdmin(req, scope = ADMIN_SCOPES.READ) {
  const user = await requireAuth(req, readAuthToken);
  if (String(user.account_type || "").trim().toLowerCase() !== "admin") {
    const error = new Error("无权访问管理后台");
    error.statusCode = 403;
    throw error;
  }
  if (!adminHasScope(user, scope)) {
    const error = new Error("当前管理员没有执行该操作的权限");
    error.statusCode = 403;
    throw error;
  }
  return user;
}

function adminHasScope(user, scope) {
  const normalizedScope = normalizeScope(scope);
  if (!normalizedScope || normalizedScope === ADMIN_SCOPES.READ) return true;

  const explicitScopes = parseScopeList(user.admin_scopes || user.adminScopes);
  if (explicitScopes.has("*") || explicitScopes.has(normalizedScope)) return true;

  return isSuperAdmin(user);
}

function isSuperAdmin(user) {
  const email = String(user.email || "").trim().toLowerCase();
  if (!email) return false;
  return SERVER_CONFIG.security.superAdminEmails.includes(email);
}

function parseScopeList(value) {
  if (Array.isArray(value)) {
    return new Set(value.map(normalizeScope).filter(Boolean));
  }
  return new Set(String(value || "")
    .split(/[,\s]+/)
    .map(normalizeScope)
    .filter(Boolean));
}

function normalizeScope(value) {
  return String(value || "").trim().toLowerCase();
}
