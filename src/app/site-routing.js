import { normalizePublicSiteSlug } from "../../shared/site-slug.js";
import { normalizeSiteLanguage } from "../../shared/site-language.js";

export const DEFAULT_SITE_SLUG = "gogoalshop";
export const SITE_SLUGS = Object.freeze([DEFAULT_SITE_SLUG, "footballkituk"]);
const GLOBAL_PATHS = new Set(["/admin", "/api"]);

const VIEW_SEGMENTS = Object.freeze({
  login: "login",
  register: "register",
  "forgot-password": "forgot-password",
  discover: "discover",
  kitshop: "kitshop",
  search: "search",
  create: "create",
  chat: "chat",
  creator: "creator",
  "not-found": "404",
});

const SEGMENT_VIEWS = Object.freeze(Object.fromEntries(
  Object.entries(VIEW_SEGMENTS).map(([view, segment]) => [segment, view])
));
export function normalizeSiteSlug(slug = "") {
  return normalizePublicSiteSlug(slug);
}

export function getSiteSlugFromPath(pathname = "") {
  const parts = pathParts(pathname);
  return normalizeSiteSlug(parts[0] || "");
}

export function getViewFromSitePath(pathname = "") {
  const siteSlug = getSiteSlugFromPath(pathname);
  if (!siteSlug) return "";
  const segment = pathParts(pathname)[1] || "login";
  return SEGMENT_VIEWS[segment] || "not-found";
}

export function pathForSiteView(siteSlug = DEFAULT_SITE_SLUG, view = "login", { agent = "" } = {}) {
  const safeSlug = normalizeSiteSlug(siteSlug) || DEFAULT_SITE_SLUG;
  const segment = VIEW_SEGMENTS[view] || VIEW_SEGMENTS.login;
  const path = `/${safeSlug}/${segment}`;
  const normalizedAgent = String(agent || "").trim();
  if (view === "chat" && normalizedAgent) {
    return `${path}?agent=${encodeURIComponent(normalizedAgent)}`;
  }
  return path;
}

export function shouldRedirectToDefaultSite(pathname = "") {
  const normalizedPath = normalizePath(pathname);
  if (getSiteSlugFromPath(normalizedPath)) return false;
  if (isGlobalPath(normalizedPath)) return false;
  return Object.values(VIEW_SEGMENTS).some((segment) => normalizedPath === `/${segment}`) || normalizedPath === "/";
}

export function shouldReplaceExplicitSiteRoute(error = null) {
  return Number(error?.status || 0) === 404;
}

export function defaultSitePathFor(pathname = "", search = "") {
  const normalizedPath = normalizePath(pathname);
  const segment = normalizedPath === "/" ? VIEW_SEGMENTS.login : normalizedPath.replace(/^\//, "").split("/")[0];
  const view = SEGMENT_VIEWS[segment] || "login";
  const nextPath = pathForSiteView(DEFAULT_SITE_SLUG, view);
  return `${nextPath}${String(search || "")}`;
}

export function sitePathForUnprefixedPath(siteSlug = DEFAULT_SITE_SLUG, pathname = "", search = "") {
  const normalizedPath = normalizePath(pathname);
  const segment = normalizedPath === "/" ? VIEW_SEGMENTS.login : normalizedPath.replace(/^\//, "").split("/")[0];
  const view = SEGMENT_VIEWS[segment] || "login";
  const nextPath = pathForSiteView(siteSlug || DEFAULT_SITE_SLUG, view);
  return `${nextPath}${String(search || "")}`;
}

export function sitePathForRejectedSitePath(siteSlug = DEFAULT_SITE_SLUG, pathname = "", search = "") {
  const parts = pathParts(pathname);
  const segment = parts[1] || VIEW_SEGMENTS.login;
  const view = SEGMENT_VIEWS[segment] || "login";
  return `${pathForSiteView(siteSlug || DEFAULT_SITE_SLUG, view)}${String(search || "")}`;
}

export function resolveCurrentSiteSlug(pathname = "") {
  return getSiteSlugFromPath(pathname) || DEFAULT_SITE_SLUG;
}

export function resolveEffectiveSiteSlug({ currentSlug = "", visitorSiteSlug = "", assignedSiteSlug = "" } = {}) {
  const assigned = normalizeSiteSlug(assignedSiteSlug);
  if (assigned) return assigned;
  return normalizeSiteSlug(currentSlug) || normalizeSiteSlug(visitorSiteSlug) || DEFAULT_SITE_SLUG;
}

export function resolveSitePageLanguage(value = "") {
  return normalizeSiteLanguage(value).label;
}

function isGlobalPath(pathname = "") {
  const normalizedPath = normalizePath(pathname);
  return Array.from(GLOBAL_PATHS).some((path) => normalizedPath === path || normalizedPath.startsWith(`${path}/`));
}

function pathParts(pathname = "") {
  return normalizePath(pathname).split("/").filter(Boolean);
}

function normalizePath(pathname = "") {
  const value = `/${String(pathname || "").split("?")[0].replace(/^\/+/, "")}`;
  return value.replace(/\/+$/, "") || "/";
}
