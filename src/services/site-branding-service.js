import { API_ENDPOINTS } from "../config/api-config.js";
import { requestJson } from "./http-client.js";
import { normalizePublicSiteSlug } from "../../shared/site-slug.js";
import { normalizeSiteLanguage } from "../../shared/site-language.js";

const brandingRequests = new Map();

export function getSiteBranding(siteSlug = "") {
  const slug = normalizePublicSiteSlug(siteSlug);
  if (!slug) return Promise.resolve(null);
  if (!brandingRequests.has(slug)) {
    const params = new URLSearchParams({ siteSlug: slug });
    const request = requestJson(`${API_ENDPOINTS.site.branding}?${params.toString()}`, { notifyUnauthorized: false })
      .then((result) => normalizeSiteBranding(result?.item))
      .finally(() => {
        if (brandingRequests.get(slug) === request) brandingRequests.delete(slug);
      });
    brandingRequests.set(slug, request);
  }
  return brandingRequests.get(slug);
}

export function normalizeSiteBranding(value = null) {
  if (!value || typeof value !== "object") return null;
  const slug = normalizePublicSiteSlug(value.slug || value.siteSlug);
  if (!slug) return null;
  return {
    siteId: String(value.siteId || value.id || "").trim(),
    name: String(value.name || value.siteName || "").trim(),
    slug,
    siteUrl: String(value.siteUrl || "").trim(),
    logoUrl: String(value.logoUrl || value.siteLogoUrl || "").trim(),
    language: normalizeSiteLanguage(value.language || value.defaultLanguage || value.default_language),
    hasProductAccessToken: value.hasProductAccessToken === true,
    shopifyLoginEnabled: value.shopifyLoginEnabled !== false,
    commerceEnabled: value.commerceEnabled !== false,
  };
}

export function clearSiteBrandingCache(siteSlug = "") {
  const slug = normalizePublicSiteSlug(siteSlug);
  if (slug) brandingRequests.delete(slug);
  else brandingRequests.clear();
}
