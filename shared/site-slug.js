export const RESERVED_SITE_SLUGS = Object.freeze([
  "admin",
  "api",
  "login",
  "register",
  "forgot-password",
  "discover",
  "kitshop",
  "search",
  "create",
  "chat",
  "creator",
  "404",
]);

const RESERVED_SITE_SLUG_SET = new Set(RESERVED_SITE_SLUGS);

export function normalizePublicSiteSlug(value = "") {
  const slug = String(value || "").trim().toLowerCase().replace(/^\/+|\/+$/g, "");
  if (RESERVED_SITE_SLUG_SET.has(slug)) return "";
  return /^[a-z0-9](?:[a-z0-9-]{0,94}[a-z0-9])?$/.test(slug) ? slug : "";
}

export function isReservedSiteSlug(value = "") {
  return RESERVED_SITE_SLUG_SET.has(String(value || "").trim().toLowerCase());
}
