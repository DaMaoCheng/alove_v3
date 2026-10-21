import { getDbPool } from "./db.js";
import { normalizePublicSiteSlug } from "../shared/site-slug.js";
import { normalizeSiteLanguage } from "../shared/site-language.js";

export async function resolvePublicSiteBranding(siteSlug = "") {
  const slug = normalizePublicSiteSlug(siteSlug);
  if (!slug) return null;
  const [[site]] = await getDbPool().execute(
    `SELECT id, name, slug, site_url, site_logo_url, default_language,
            product_access_token_encrypted, shopify_login_enabled, commerce_enabled
     FROM sites
     WHERE slug = ? AND site_status = 'active'
     LIMIT 1`,
    [slug]
  );
  if (!site) return null;
  const branding = mapPublicSiteBranding(site);
  if (branding.siteUrl) return branding;
  const [[cachedProduct]] = await getDbPool().execute(
    `SELECT product_url
     FROM site_product_cache
     WHERE site_id = ? AND cached_status = 'active' AND product_url IS NOT NULL AND product_url <> ''
     ORDER BY last_synced_at DESC, updated_at DESC
     LIMIT 1`,
    [site.id]
  );
  return {
    ...branding,
    siteUrl: publicOrigin(cachedProduct?.product_url),
  };
}

export function mapPublicSiteBranding(site = null) {
  if (!site || typeof site !== "object") return null;
  return {
    siteId: safeText(site.id, 64),
    name: safeText(site.name, 128),
    slug: safeText(site.slug, 96),
    siteUrl: safePublicUrl(site.site_url ?? site.siteUrl),
    logoUrl: safePublicUrl(site.site_logo_url ?? site.logoUrl),
    language: normalizeSiteLanguage(site.default_language ?? site.defaultLanguage ?? site.language),
    hasProductAccessToken: Boolean(site.product_access_token_encrypted ?? site.hasProductAccessToken),
    shopifyLoginEnabled: site.shopify_login_enabled == null && site.shopifyLoginEnabled == null
      ? true
      : Boolean(site.shopify_login_enabled ?? site.shopifyLoginEnabled),
    commerceEnabled: site.commerce_enabled == null && site.commerceEnabled == null
      ? true
      : Boolean(site.commerce_enabled ?? site.commerceEnabled),
  };
}

function safePublicUrl(value = "") {
  const text = safeText(value, 512);
  if (!text || text.includes("\\") || text.startsWith("//")) return "";
  try {
    const url = new URL(text);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.toString() : "";
  } catch {
    return "";
  }
}

function publicOrigin(value = "") {
  const url = safePublicUrl(value);
  if (!url) return "";
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}

function safeText(value = "", maxLength = 512) {
  return String(value == null ? "" : value).trim().slice(0, maxLength);
}
