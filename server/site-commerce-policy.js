import { createPublicError } from "./public-error-utils.js";

export function isSiteCommerceEnabled(site = null) {
  if (!site || typeof site !== "object") return true;
  if (site.commerce_enabled == null && site.commerceEnabled == null) return true;
  return Boolean(site.commerce_enabled ?? site.commerceEnabled);
}

export function assertSiteCommerceEnabled(site = null) {
  if (!isSiteCommerceEnabled(site)) {
    throw createPublicError("Online purchase is temporarily unavailable for this store. Please view the product on the store website.", 409, "SITE_COMMERCE_DISABLED");
  }
}
