import { SERVER_CONFIG } from "./config.js";
import {
  inferProductSourceType,
  inferShopifyAdminDomain,
  inferTtmallSource,
} from "./admin-site-product-source-service.js";
import { normalizePaymentMethods } from "../shared/payment-methods.js";

export function mapSiteRow(row, regions = []) {
  const ttmallSource = inferTtmallSource(row.product_api_url);
  return {
    id: row.id,
    name: row.name || "",
    slug: row.slug || "",
    siteUrl: row.site_url || "",
    logoUrl: row.site_logo_url || "",
    defaultLanguage: row.default_language || "",
    status: row.site_status || "active",
    isDefault: Boolean(row.is_default),
    mascotCharacterId: row.effective_mascot_character_id || row.mascot_character_id || "",
    mascotName: row.mascot_name || "",
    productApiUrl: row.product_api_url || "",
    productSourceType: row.product_source_type || inferProductSourceType(row.product_api_url),
    productShopDomain: row.product_shop_domain || inferShopifyAdminDomain(row.product_api_url),
    productApiVersion: row.product_api_version || SERVER_CONFIG.productApi.shopifyAdminApiVersion,
    productTtmallApiBaseUrl: ttmallSource?.apiBaseUrl || "",
    productTtmallWebsiteId: ttmallSource?.websiteId || "",
    hasProductAccessToken: Boolean(row.product_access_token_encrypted),
    shopifyLoginEnabled: Boolean(row.shopify_login_enabled),
    guestChatEnabled: Boolean(row.guest_chat_enabled),
    paymentMethods: normalizePaymentMethods(row.payment_methods_json),
    commerceEnabled: row.commerce_enabled == null ? true : Boolean(row.commerce_enabled),
    description: row.description || "",
    regions,
    regionIds: regions.map((region) => region.id),
    userCount: Number(row.user_count || 0),
    creatorCount: Number(row.creator_count || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
