import { getViewFromSitePath, pathForSiteView } from "./site-routing.js";

const VIEW_PATHS = Object.freeze({
  login: "/login",
  register: "/register",
  "forgot-password": "/forgot-password",
  discover: "/discover",
  kitshop: "/kitshop",
  search: "/search",
  create: "/create",
  chat: "/chat",
  creator: "/creator",
  admin: "/admin",
  "not-found": "/404",
});

const PATH_VIEWS = Object.freeze({
  "/": "login",
  "/login": "login",
  "/register": "register",
  "/forgot-password": "forgot-password",
  "/discover": "discover",
  "/kitshop": "kitshop",
  "/search": "search",
  "/create": "create",
  "/chat": "chat",
  "/creator": "creator",
  "/admin": "admin",
  "/404": "not-found",
});

export function normalizeAccountType(value = "personal") {
  const normalized = String(value || "").trim().toLowerCase();
  return ["personal", "creator", "admin"].includes(normalized) ? normalized : "personal";
}

export function canAccessView(view, accountType = "personal") {
  const normalizedType = normalizeAccountType(accountType);
  if (view === "creator") return normalizedType === "creator";
  if (view === "admin") return normalizedType === "admin";
  return true;
}

export function resolveAuthorizedView(view, accountType = "personal") {
  return canAccessView(view, accountType) ? view : "not-found";
}

export function requiresAuth(view) {
  return ["discover", "kitshop", "search", "create", "chat", "creator", "admin"].includes(view);
}

export function getInitialViewFromPath(pathname = window.location.pathname) {
  const siteView = getViewFromSitePath(pathname);
  if (siteView) return siteView;
  return PATH_VIEWS[String(pathname || "").replace(/\/+$/, "") || "/"] || "not-found";
}

export function getInitialAgentFromPath(search = window.location.search) {
  return String(new URLSearchParams(search || "").get("agent") || "").trim();
}

export function getInitialExternalHandoffFromPath(search = window.location.search) {
  return String(new URLSearchParams(search || "").get("handoff") || "").trim().slice(0, 4096);
}

export function pathForView(view, { agent = "", siteSlug = "" } = {}) {
  if (view !== "admin" && siteSlug) {
    return pathForSiteView(siteSlug, view, { agent });
  }
  const path = VIEW_PATHS[view] || "/login";
  const normalizedAgent = String(agent || "").trim();
  if (view === "chat" && normalizedAgent) {
    return `${path}?agent=${encodeURIComponent(normalizedAgent)}`;
  }
  return path;
}
