import { withTransaction } from "./db.js";
import { createId } from "./security.js";
import { getAdminSite, getExistingSite } from "./admin-site-query-service.js";
import { inferProductSourceType, normalizeProductSourcePayload } from "./admin-site-product-source-service.js";
import {
  normalizeRegionIds,
  replaceSiteRegions,
} from "./site-region-binding-service.js";
import {
  normalizeOneOf,
  normalizeSiteLogoUrl,
  normalizeSiteUrl,
  normalizeSlug,
  nullableText,
  parseBoolean,
  safeString,
  throwNotFound,
  throwUserError,
} from "./admin-site-shared.js";
import { normalizePaymentMethods } from "../shared/payment-methods.js";
import { normalizeSiteLanguage } from "../shared/site-language.js";

export async function createAdminSite(payload = {}) {
  const fields = normalizeSitePayload(payload);
  const id = createId("site");
  await withTransaction(async (db) => {
    if (fields.isDefault) await db.execute("UPDATE sites SET is_default = 0 WHERE is_default = 1");
    await db.execute(
      `INSERT INTO sites (
         id, name, slug, site_url, site_logo_url, default_language, site_status, is_default,
         mascot_character_id, product_api_url, product_source_type, product_shop_domain,
         product_api_version, product_access_token_encrypted, shopify_login_enabled,
         payment_methods_json, commerce_enabled, guest_chat_enabled, description
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), ?, ?, ?)`,
      [
        id,
        fields.name,
        fields.slug,
        fields.siteUrl,
        fields.logoUrl,
        fields.defaultLanguage,
        fields.status,
        fields.isDefault ? 1 : 0,
        fields.mascotCharacterId,
        fields.productApiUrl,
        fields.productSourceType,
        fields.productShopDomain,
        fields.productApiVersion,
        fields.productAccessTokenEncrypted,
        fields.shopifyLoginEnabled ? 1 : 0,
        JSON.stringify(fields.paymentMethods),
        fields.commerceEnabled ? 1 : 0,
        fields.guestChatEnabled ? 1 : 0,
        fields.description,
      ]
    );
    await replaceSiteRegions(db, id, fields.regionIds);
  });
  return getAdminSite(id);
}

export async function updateAdminSite(siteId, payload = {}) {
  const normalizedId = safeString(siteId);
  if (!normalizedId) throwNotFound();
  const current = await getExistingSite(normalizedId);
  const sourceAwarePayload = hasProductSourcePayload(payload)
    ? payload
    : {
        ...payload,
        productSourceType: current.product_source_type || inferProductSourceType(current.product_api_url),
        productApiUrl: current.product_api_url || "",
        productShopDomain: current.product_shop_domain || "",
        productApiVersion: current.product_api_version || "",
      };
  const fields = normalizeSitePayload(sourceAwarePayload, {
    currentLogoUrl: current.site_logo_url,
    currentPaymentMethods: current.payment_methods_json,
    preserveUntouchedPaymentMethods: true,
    currentShopifyLoginEnabled: Boolean(current.shopify_login_enabled),
    currentGuestChatEnabled: Boolean(current.guest_chat_enabled),
    currentCommerceEnabled: current.commerce_enabled == null ? true : Boolean(current.commerce_enabled),
  });

  await withTransaction(async (db) => {
    if (fields.isDefault) await db.execute("UPDATE sites SET is_default = 0 WHERE is_default = 1 AND id <> ?", [normalizedId]);
    const shouldStayDefault = Boolean(current.is_default) && !fields.isDefault;
    const [result] = await db.execute(
      `UPDATE sites
       SET name = ?,
           slug = ?,
           site_url = ?,
           site_logo_url = ?,
           default_language = ?,
           site_status = ?,
           is_default = ?,
           mascot_character_id = ?,
           product_api_url = ?,
           product_source_type = ?,
           product_shop_domain = ?,
           product_api_version = ?,
           product_access_token_encrypted = CASE WHEN ? THEN ? ELSE product_access_token_encrypted END,
           shopify_login_enabled = ?,
           payment_methods_json = CAST(? AS JSON),
           commerce_enabled = ?,
           guest_chat_enabled = ?,
           description = ?,
           updated_at = NOW(3)
       WHERE id = ?
       LIMIT 1`,
      [
        fields.name,
        fields.slug,
        fields.siteUrl,
        fields.logoUrl,
        fields.defaultLanguage,
        fields.status,
        fields.isDefault || shouldStayDefault ? 1 : 0,
        fields.mascotCharacterId,
        fields.productApiUrl,
        fields.productSourceType,
        fields.productShopDomain,
        fields.productApiVersion,
        fields.shouldUpdateProductAccessToken ? 1 : 0,
        fields.productAccessTokenEncrypted,
        fields.shopifyLoginEnabled ? 1 : 0,
        JSON.stringify(fields.paymentMethods),
        fields.commerceEnabled ? 1 : 0,
        fields.guestChatEnabled ? 1 : 0,
        fields.description,
        normalizedId,
      ]
    );
    if (!result.affectedRows) throwNotFound();
    await replaceSiteRegions(db, normalizedId, fields.regionIds);
  });

  return getAdminSite(normalizedId);
}

function hasProductSourcePayload(payload = {}) {
  return [
    "productSourceType", "product_source_type", "productApiUrl", "product_api_url",
    "productShopDomain", "product_shop_domain", "productApiVersion", "product_api_version",
    "productAccessToken", "product_access_token", "productTtmallApiBaseUrl", "product_ttmall_api_base_url",
    "productTtmallWebsiteId", "product_ttmall_website_id",
  ].some((key) => Object.prototype.hasOwnProperty.call(payload, key));
}

export async function setDefaultAdminSite(siteId) {
  const normalizedId = safeString(siteId);
  if (!normalizedId) throwNotFound();
  await getExistingSite(normalizedId);

  await withTransaction(async (db) => {
    await db.execute("UPDATE sites SET is_default = 0 WHERE is_default = 1 AND id <> ?", [normalizedId]);
    const [result] = await db.execute(
      "UPDATE sites SET is_default = 1, updated_at = NOW(3) WHERE id = ? LIMIT 1",
      [normalizedId]
    );
    if (!result.affectedRows) throwNotFound();
  });

  return getAdminSite(normalizedId);
}

function normalizeSitePayload(payload = {}, {
  currentLogoUrl = "",
  currentPaymentMethods = [],
  preserveUntouchedPaymentMethods = false,
  currentShopifyLoginEnabled = true,
  currentGuestChatEnabled = false,
  currentCommerceEnabled = true,
} = {}) {
  const name = safeString(payload.name).slice(0, 128);
  if (!name) throwUserError("站点名称不能为空");

  const slug = normalizeSlug(payload.slug);
  if (!slug) throwUserError("站点路径不能为空");
  const hasPaymentMethods = Object.prototype.hasOwnProperty.call(payload, "paymentMethods")
    || Object.prototype.hasOwnProperty.call(payload, "payment_methods");
  const hasPaymentMethodsTouched = Object.prototype.hasOwnProperty.call(payload, "paymentMethodsTouched")
    || Object.prototype.hasOwnProperty.call(payload, "payment_methods_touched");
  const paymentMethodsTouched = hasPaymentMethodsTouched
    ? parseBoolean(payload.paymentMethodsTouched ?? payload.payment_methods_touched)
    : hasPaymentMethods;
  const paymentMethods = preserveUntouchedPaymentMethods && !paymentMethodsTouched
    ? normalizePaymentMethods(currentPaymentMethods)
    : normalizePaymentMethods(payload.paymentMethods ?? payload.payment_methods);
  const hasLogoUrl = ["logoUrl", "logo_url", "siteLogoUrl", "site_logo_url"]
    .some((key) => Object.prototype.hasOwnProperty.call(payload, key));
  const logoUrl = hasLogoUrl
    ? normalizeSiteLogoUrl(payload.logoUrl ?? payload.logo_url ?? payload.siteLogoUrl ?? payload.site_logo_url)
    : normalizeSiteLogoUrl(currentLogoUrl);

  return {
    name,
    slug,
    siteUrl: normalizeSiteUrl(payload.siteUrl || payload.site_url),
    logoUrl,
    defaultLanguage: normalizeSiteLanguage(payload.defaultLanguage || payload.default_language || "English").label,
    status: normalizeOneOf(payload.status || payload.siteStatus || payload.site_status, ["active", "inactive"], "active"),
    isDefault: parseBoolean(payload.isDefault ?? payload.is_default),
    mascotCharacterId: nullableText(payload.mascotCharacterId || payload.mascot_character_id, 64),
    ...normalizeProductSourcePayload(payload),
    paymentMethods,
    shopifyLoginEnabled: Object.prototype.hasOwnProperty.call(payload, "shopifyLoginEnabled") || Object.prototype.hasOwnProperty.call(payload, "shopify_login_enabled")
      ? parseBoolean(payload.shopifyLoginEnabled ?? payload.shopify_login_enabled)
      : currentShopifyLoginEnabled,
    guestChatEnabled: Object.prototype.hasOwnProperty.call(payload, "guestChatEnabled") || Object.prototype.hasOwnProperty.call(payload, "guest_chat_enabled")
      ? parseBoolean(payload.guestChatEnabled ?? payload.guest_chat_enabled)
      : currentGuestChatEnabled,
    commerceEnabled: Object.prototype.hasOwnProperty.call(payload, "commerceEnabled") || Object.prototype.hasOwnProperty.call(payload, "commerce_enabled")
      ? parseBoolean(payload.commerceEnabled ?? payload.commerce_enabled)
      : currentCommerceEnabled,
    description: nullableText(payload.description, 500),
    regionIds: normalizeRegionIds(payload.regionIds || payload.region_ids || payload.geoRegionIds || payload.geo_region_ids),
  };
}
