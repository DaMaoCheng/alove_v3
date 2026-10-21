import { ADMIN_NAV } from "./admin-console-data.js";

const DEFAULT_ADMIN_VIEW = "overview";
const ADMIN_VIEW_KEYS = new Set(ADMIN_NAV.map(([key]) => key));

export function normalizeAdminView(value = "") {
  const normalized = String(value || "").trim();
  return ADMIN_VIEW_KEYS.has(normalized) ? normalized : DEFAULT_ADMIN_VIEW;
}

export function resolveAdminViewFromSearch(search = "") {
  return normalizeAdminView(new URLSearchParams(search || "").get("view"));
}

export function resolveAdminAccountTargetFromSearch(search = "") {
  return String(new URLSearchParams(search || "").get("accountId") || "").trim().slice(0, 64);
}

export function resolveAdminGuestTargetFromSearch(search = "") {
  return String(new URLSearchParams(search || "").get("guestSessionId") || "").trim().slice(0, 64);
}

export function pathForAdminView(view = DEFAULT_ADMIN_VIEW, { accountId = "", guestSessionId = "" } = {}) {
  const normalized = normalizeAdminView(view);
  if (normalized === DEFAULT_ADMIN_VIEW) return "/admin";
  const params = new URLSearchParams({ view: normalized });
  const targetId = String(accountId || "").trim().slice(0, 64);
  if (normalized === "accounts" && targetId) params.set("accountId", targetId);
  const guestTargetId = String(guestSessionId || "").trim().slice(0, 64);
  if (normalized === "accounts" && guestTargetId) params.set("guestSessionId", guestTargetId);
  return `/admin?${params.toString()}`;
}
