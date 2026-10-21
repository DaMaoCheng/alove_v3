import { getDbPool } from "./db.js";
import { DEFAULT_SITE_SLUG, INTERNAL_DEMO_PRODUCT_PATH } from "./product-search-constants.js";
import { normalizeCurrency } from "./product-normalizer.js";
import { buildShopifyAdminStorefrontUrl, isShopifyAdminProductSource } from "./product-source-shopify-admin-service.js";
import { isTtmallProductSource } from "./product-source-ttmall-service.js";
import { normalizePaymentMethods } from "../shared/payment-methods.js";
import { normalizeProductSiteSlug } from "./product-request-guard-service.js";

export async function resolveSearchSite(siteSlug = "", { allowDefault = true } = {}) {
  const siteSlugText = String(siteSlug || "").trim();
  const canonicalSiteSlug = normalizeProductSiteSlug(siteSlugText);
  if (siteSlugText && !canonicalSiteSlug) return null;
  const normalizedSlug = canonicalSiteSlug || DEFAULT_SITE_SLUG;
  const [rows] = await getDbPool().execute(
    `SELECT id, name, slug, site_url, site_logo_url, currency, product_api_url, product_access_token_encrypted, payment_methods_json, commerce_enabled
     FROM sites
     WHERE slug = ? AND site_status = 'active'
     LIMIT 1`,
    [normalizedSlug]
  );
  if (rows[0]) return rows[0];
  if (!allowDefault) return null;

  const [defaultRows] = await getDbPool().execute(
    `SELECT id, name, slug, site_url, site_logo_url, currency, product_api_url, product_access_token_encrypted, payment_methods_json, commerce_enabled
     FROM sites
     WHERE is_default = 1 AND site_status = 'active'
     ORDER BY updated_at DESC
     LIMIT 1`
  );
  return defaultRows[0] || null;
}

export async function resolveAdminSearchSite(siteId = "") {
  const normalizedId = safeString(siteId);
  if (!normalizedId) return null;
  const [rows] = await getDbPool().execute(
    `SELECT id, name, slug, site_url, site_logo_url, currency, product_api_url, product_access_token_encrypted, payment_methods_json, commerce_enabled
     FROM sites
     WHERE id = ? AND site_status = 'active'
     LIMIT 1`,
    [normalizedId]
  );
  return rows[0] || null;
}

export function mapProductSearchSite(site = null) {
  if (!site) return null;
  return {
    id: site.id || "",
    name: site.name || "",
    slug: site.slug || DEFAULT_SITE_SLUG,
    currency: normalizeCurrency(site.currency),
    siteUrl: site.site_url || "",
    logoUrl: site.site_logo_url || "",
    storefrontUrl: resolveStorefrontUrl(site),
    paymentMethods: normalizePaymentMethods(site.payment_methods_json || site.paymentMethods),
    commerceEnabled: site.commerce_enabled == null ? true : Boolean(site.commerce_enabled),
  };
}

function resolveStorefrontUrl(site = {}) {
  if (site.site_url) return site.site_url;
  if (isShopifyAdminProductSource(site.product_api_url)) {
    return buildShopifyAdminStorefrontUrl(site.product_api_url);
  }
  if (isTtmallProductSource(site.product_api_url)) return "";
  return site.product_api_url || "";
}

export function isInternalDemoProductApi(value = "") {
  const text = safeString(value);
  if (!text) return false;
  try {
    return new URL(text, "http://127.0.0.1:4173").pathname === INTERNAL_DEMO_PRODUCT_PATH;
  } catch {
    return false;
  }
}

function safeString(value) {
  return String(value == null ? "" : value).trim();
}
