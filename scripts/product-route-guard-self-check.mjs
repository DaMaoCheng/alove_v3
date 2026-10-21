import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  AUTHENTICATED_PRODUCT_REQUEST_LIMIT,
  AUTHENTICATED_PRODUCT_IN_FLIGHT_LIMIT,
  ADMIN_PRODUCT_SEARCH_QUERY_LIMIT,
  assertAdminProductSearchQuery,
  consumeAdminProductSearchQuota,
  consumeAuthenticatedProductRequestQuota,
  resetAuthenticatedProductRequestQuotaForTests,
  resolveProductRequestSiteSlug,
} from "../server/product-request-guard-service.js";
import { toClientKitshopResult, toClientResolvedProduct } from "../server/product-response-sanitizer.js";

const personal = { id: "user-fkk", account_type: "personal", site_slug: "footballkituk" };
const admin = { id: "admin", account_type: "admin", site_slug: "footballkituk" };

assert.equal(resolveProductRequestSiteSlug(personal, "footballkituk"), "footballkituk", "ordinary accounts should access their own site catalog");
assert.throws(
  () => resolveProductRequestSiteSlug(personal, "gogoalshop"),
  (error) => Number(error?.statusCode || 0) === 403,
  "ordinary accounts should not read another site's trusted catalog"
);
assert.equal(resolveProductRequestSiteSlug(admin, "gogoalshop"), "gogoalshop", "admins should retain cross-site catalog access");
assert.equal(resolveProductRequestSiteSlug(admin, "FootballKitUK"), "footballkituk", "site slugs should use one canonical identity");
assert.throws(
  () => resolveProductRequestSiteSlug(admin, "footballkituk!"),
  (error) => Number(error?.statusCode || 0) === 400,
  "malformed explicit site slugs should be rejected instead of reaching the canonical site through a separate quota key"
);
assert.throws(
  () => resolveProductRequestSiteSlug(admin, "!!!"),
  (error) => Number(error?.statusCode || 0) === 400,
  "an explicit site slug that canonicalizes to empty should not fall back to the default site"
);
assert.throws(
  () => resolveProductRequestSiteSlug({ ...personal, site_slug: null }, "inactive-site"),
  (error) => Number(error?.statusCode || 0) === 403,
  "accounts without an active bound site should not fall back to the default catalog"
);

resetAuthenticatedProductRequestQuotaForTests();
for (let index = 0; index < AUTHENTICATED_PRODUCT_REQUEST_LIMIT; index += 1) {
  consumeAuthenticatedProductRequestQuota(personal, "footballkituk", 1000)();
}
assert.throws(
  () => consumeAuthenticatedProductRequestQuota(personal, "footballkituk", 1000),
  (error) => Number(error?.statusCode || 0) === 429,
  "authenticated catalog requests should be rate limited per account and site"
);

resetAuthenticatedProductRequestQuotaForTests();
const releases = Array.from({ length: AUTHENTICATED_PRODUCT_IN_FLIGHT_LIMIT }, () => (
  consumeAuthenticatedProductRequestQuota(personal, "footballkituk", 1000)
));
assert.throws(
  () => consumeAuthenticatedProductRequestQuota(personal, "footballkituk", 1000),
  (error) => Number(error?.statusCode || 0) === 429,
  "authenticated catalog requests should reject bursts above the in-flight limit"
);
releases.forEach((release) => release());

resetAuthenticatedProductRequestQuotaForTests();
const adminReleases = Array.from({ length: AUTHENTICATED_PRODUCT_IN_FLIGHT_LIMIT }, () => (
  consumeAdminProductSearchQuota(admin, "SITE_FKK", 1000)
));
assert.throws(
  () => consumeAdminProductSearchQuota(admin, "site_fkk", 1000),
  (error) => Number(error?.statusCode || 0) === 429,
  "admin product search should share one in-flight bucket per canonical site id"
);
adminReleases.forEach((release) => release());
assert.equal(assertAdminProductSearchQuery("  shirt  "), "shirt", "admin product search should normalize its bounded query");
assert.throws(
  () => assertAdminProductSearchQuery("x".repeat(ADMIN_PRODUCT_SEARCH_QUERY_LIMIT + 1)),
  (error) => Number(error?.statusCode || 0) === 400,
  "admin product search should reject oversized source queries before calling Shopify"
);

const safeResolved = toClientResolvedProduct({
  ok: true,
  sourceItem: { id: "internal-source" },
  item: { id: "public-item", sizes: [{ label: "M", inventoryQuantity: 7, available: true }] },
});
assert.equal("sourceItem" in safeResolved, false, "resolved product responses should not expose the internal source item");
assert.equal("inventoryQuantity" in safeResolved.item.sizes[0], false, "product responses should not expose exact Admin inventory");
assert.deepEqual(
  toClientResolvedProduct({ item: { sizes: [null, "M", 42, { label: "L", inventoryQuantity: 3 }] } }).item.sizes,
  [{ label: "L" }],
  "client-controlled malformed size rows should be discarded without throwing"
);
const safeKitshop = toClientKitshopResult({
  adminWarning: "销量数据暂时不可用，已显示最近销量缓存",
  shelves: [{ key: "one", items: [{ sizes: [{ label: "M", inventoryQuantity: 8 }] }] }],
});
assert.equal("inventoryQuantity" in safeKitshop.shelves[0].items[0].sizes[0], false, "authenticated Kitshop responses should not expose exact Admin inventory");
assert.equal("adminWarning" in safeKitshop, false, "authenticated Kitshop responses must not expose sales operations warnings");

const routeSource = readFileSync(new URL("../server/product-search-routes.js", import.meta.url), "utf8");
const kitshopRouteSource = readFileSync(new URL("../server/kitshop-routes.js", import.meta.url), "utf8");
const requestUserSource = readFileSync(new URL("../server/request-user-service.js", import.meta.url), "utf8");
const adminPromotionRouteSource = readFileSync(new URL("../server/admin-promotion-routes.js", import.meta.url), "utf8");
assert.match(routeSource, /if \(!user\) \{\s+assertPublicAppOrigin\(req\);/, "guest product search and resolve should require the Alove origin");
assert.match(routeSource, /strictSite:\s*true/g, "product search and resolve should never fall back from an explicit site to the default catalog");
assert.match(kitshopRouteSource, /if \(!user\) \{\s+assertPublicAppOrigin\(req\);/, "guest Kitshop reads should require the Alove origin");
assert.match(kitshopRouteSource, /strictSite:\s*true/, "Kitshop should never fall back from an explicit site to the default catalog");
assert.match(requestUserSource, /s\.slug AS site_slug/, "optional authenticated users should carry their bound site into product authorization");
assert.match(requestUserSource, /s\.site_status = 'active'/, "inactive account sites should not authorize trusted catalog reads");
assert.match(adminPromotionRouteSource, /requireAdmin\(req, ADMIN_SCOPES\.PROMOTIONS_WRITE\)/, "admin product selection should require promotion write permission");
assert.match(adminPromotionRouteSource, /consumeAdminProductSearchQuota\(admin, siteId\)/, "admin product selection should apply per-admin and per-site quota before Shopify reads");

console.log("product route guard self-check passed");
