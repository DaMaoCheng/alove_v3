import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { closeDbPool, getDbPool, initializeDatabase } from "../server/db.js";
import { createAdminSite, updateAdminSite } from "../server/admin-site-service.js";
import { mapPublicSiteBranding, resolvePublicSiteBranding } from "../server/site-branding-service.js";
import { resolveRegistrationSite } from "../server/registration-site-service.js";
import { resolveSiteForIpLocation } from "../server/geo-site-resolver-service.js";
import { resolveSiteBrandLogoCandidates } from "../src/features/shared-ui/site-branding.js";
import { normalizeSiteBranding } from "../src/services/site-branding-service.js";

const [loginSource, loginStyles, authFormStyles, providerWordmark, rendererSource, routeSource, siteTemplateSource] = await Promise.all([
  readFile("src/pages/login/login-page.js", "utf8"),
  readFile("src/pages/login/login.css", "utf8"),
  readFile("src/features/app-shell/styles/auth-forms.css", "utf8"),
  readFile("assets/brand/shopify-wordmark-white.svg", "utf8"),
  readFile("src/features/chat/chat-product-panel-renderer.js", "utf8"),
  readFile("server/admin-client-event-routes.js", "utf8"),
  readFile("src/features/admin-console/admin-console-sites-template.js", "utf8"),
]);

assert.match(siteTemplateSource, /name="logoUrl"/, "site admin should expose the shared logo URL field");
assert.match(routeSource, /\/api\/site\/branding/, "public site branding route should be mounted");
assert.match(rendererSource, /getSiteBranding\(siteSlug\)/, "product detail should refresh branding by site slug");
assert.match(rendererSource, /bindSiteBrandImage/, "product detail should use the shared image fallback binder");
assert.match(loginSource, /button\.disabled = !isAvailable/, "site login preview must stay disabled until a real auth action exists");
assert.match(loginSource, /!siteBranding\?\.hasProductAccessToken/, "site login preview must stay hidden when the site token is not configured");
assert.match(loginSource, /!siteBranding\?\.shopifyLoginEnabled/, "site login preview must stay hidden when the site login switch is disabled");
assert.match(siteTemplateSource, /name="shopifyLoginEnabled"/, "site admin should expose the Shopify login switch");
assert.match(loginSource, /shopify-wordmark-white\.svg/, "site login should use the local Shopify SVG wordmark instead of typed provider text");
assert.match(loginStyles, /background:\s*#5433eb/, "site login Shopify corner ribbon should use the approved purple");
assert.match(loginStyles, /width:\s*140px/, "site login Shopify corner ribbon should fully cross the button corner");
assert.doesNotMatch(authFormStyles, /\.btn-site-auth\s*\{/, "site login button styles must have one canonical source");
assert.match(providerWordmark, /<svg[\s\S]*<path/, "local Shopify provider asset should remain a vector wordmark");
const brandingWithoutToken = mapPublicSiteBranding({ id: "site_without_token", slug: "without-token", shopify_login_enabled: 1 });
assert.equal(brandingWithoutToken.hasProductAccessToken, false);
assert.equal(brandingWithoutToken.shopifyLoginEnabled, true);
assert.deepEqual(brandingWithoutToken.language, { code: "en", label: "English", uiCode: "en" });
const brandingWithDisabledLogin = mapPublicSiteBranding({
  id: "site_with_token",
  slug: "with-token",
  product_access_token_encrypted: "configured",
  shopify_login_enabled: 0,
});
assert.equal(brandingWithDisabledLogin.hasProductAccessToken, true);
assert.equal(brandingWithDisabledLogin.shopifyLoginEnabled, false);
assert.equal(normalizeSiteBranding({ slug: "legacy", hasProductAccessToken: true }).shopifyLoginEnabled, true);
assert.equal(normalizeSiteBranding({ slug: "disabled", hasProductAccessToken: true, shopifyLoginEnabled: false }).shopifyLoginEnabled, false);

assert.deepEqual(resolveSiteBrandLogoCandidates({
  logoUrl: "https://cdn.example.com/logo.png",
  siteUrl: "https://store.example.com/",
  productUrl: "https://product.example.net/items/1",
}), [
  "https://cdn.example.com/logo.png",
  "https://www.google.com/s2/favicons?domain=store.example.com&sz=64",
  "https://www.google.com/s2/favicons?domain=product.example.net&sz=64",
]);
assert.deepEqual(resolveSiteBrandLogoCandidates({
  logoUrl: "javascript:alert(1)",
  siteUrl: "",
  productUrl: "",
}), [], "unsafe logo protocols must not reach an image src");

await initializeDatabase();
const db = getDbPool();
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
const slug = `brand-check-${suffix}`;
const regionId = `geo-brand-${suffix}`;
const regionCode = `XZ${suffix.replace(/[^a-z0-9]/gi, "").slice(-8)}`.toUpperCase();
let siteId = "";

try {
  const [columns] = await db.execute(
    `SELECT COLUMN_NAME
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'sites'
       AND COLUMN_NAME IN ('site_logo_url', 'shopify_login_enabled')`
  );
  assert.deepEqual(
    columns.map((column) => column.COLUMN_NAME).sort(),
    ["shopify_login_enabled", "site_logo_url"],
    "site branding migrations should exist"
  );

  const created = await createAdminSite({
    name: "Brand Check",
    slug,
    siteUrl: "https://brand-check.example.com",
    logoUrl: "https://cdn.example.com/brand-check.png",
    productSourceType: "shopify_admin",
    productShopDomain: "brand-check.myshopify.com",
    productApiVersion: "2026-04",
    productAccessToken: "shpca_branding_self_check_token_123456",
    defaultLanguage: "English",
    status: "active",
    shopifyLoginEnabled: true,
    guestChatEnabled: false,
    paymentMethods: [],
    paymentMethodsTouched: true,
    regionIds: [],
  });
  siteId = created.item.id;
  assert.equal(created.item.logoUrl, "https://cdn.example.com/brand-check.png");
  assert.equal(created.item.shopifyLoginEnabled, true);

  const publicBranding = await resolvePublicSiteBranding(slug);
  assert.deepEqual(Object.keys(publicBranding).sort(), ["commerceEnabled", "hasProductAccessToken", "language", "logoUrl", "name", "shopifyLoginEnabled", "siteId", "siteUrl", "slug"]);
  assert.equal(publicBranding.logoUrl, "https://cdn.example.com/brand-check.png");
  assert.equal(publicBranding.siteUrl, "https://brand-check.example.com/");
  assert.equal(publicBranding.hasProductAccessToken, true);
  assert.equal(publicBranding.shopifyLoginEnabled, true);
  assert.equal(publicBranding.commerceEnabled, true);
  assert.deepEqual(publicBranding.language, { code: "en", label: "English", uiCode: "en" });
  assert.equal("productAccessToken" in publicBranding, false, "public branding must not expose the raw site token");

  await db.execute(
    `INSERT INTO geo_regions (id, level, code, name_zh, name_en, aliases_json, display_order, is_active)
     VALUES (?, 'country', ?, '品牌测试地区', 'Brand test region', JSON_ARRAY('Brand test region'), 9999, 1)`,
    [regionId, regionCode]
  );
  await db.execute("INSERT INTO site_geo_regions (site_id, region_id, priority) VALUES (?, ?, 0)", [siteId, regionId]);
  const geoBranding = await resolveSiteForIpLocation({ countryCode: regionCode });
  assert.equal(geoBranding.siteSlug, slug);
  assert.equal(geoBranding.hasProductAccessToken, true, "IP resolution must preserve the site login token capability");
  assert.equal(geoBranding.shopifyLoginEnabled, true, "IP resolution must preserve the site login switch");
  assert.deepEqual(geoBranding.language, { code: "en", label: "English", uiCode: "en" });

  const disabledLogin = await updateAdminSite(siteId, {
    name: "Brand Check",
    slug,
    siteUrl: "https://brand-check.example.com",
    defaultLanguage: "English",
    status: "active",
    shopifyLoginEnabled: false,
    regionIds: [],
  });
  assert.equal(disabledLogin.item.hasProductAccessToken, true, "disabling site login must not remove the product token");
  assert.equal(disabledLogin.item.shopifyLoginEnabled, false);
  assert.equal((await resolvePublicSiteBranding(slug)).shopifyLoginEnabled, false);

  const updatedWithoutLogo = await updateAdminSite(siteId, {
    name: "Brand Check Renamed",
    slug,
    siteUrl: "https://brand-check.example.com",
    defaultLanguage: "English",
    status: "active",
    guestChatEnabled: false,
    paymentMethods: [],
    paymentMethodsTouched: true,
    regionIds: [],
  });
  assert.equal(updatedWithoutLogo.item.logoUrl, "https://cdn.example.com/brand-check.png", "omitted logo should preserve admin configuration");
  assert.equal(updatedWithoutLogo.item.shopifyLoginEnabled, false, "omitted site login switch should preserve admin configuration");

  await assert.rejects(
    updateAdminSite(siteId, {
      name: "Brand Check Renamed",
      slug,
      siteUrl: "https://brand-check.example.com",
      logoUrl: "javascript:alert(1)",
      defaultLanguage: "English",
      status: "active",
      regionIds: [],
    }),
    /HTTP\(S\)/
  );
  await assert.rejects(
    updateAdminSite(siteId, {
      name: "Brand Check Renamed",
      slug,
      siteUrl: "https://brand-check.example.com",
      logoUrl: "https://user:secret@cdn.example.com/logo.png",
      defaultLanguage: "English",
      status: "active",
      regionIds: [],
    }),
    /HTTP\(S\)/
  );
  await assert.rejects(
    createAdminSite({ name: "Reserved Brand", slug: "login", status: "active", regionIds: [] }),
    /保留路径/
  );
  await assert.rejects(
    resolveRegistrationSite(`unknown-${suffix}`, db),
    /currently unavailable/
  );
  assert.equal(await resolvePublicSiteBranding("login"), null, "reserved slugs must never resolve as public sites");

  await db.execute("UPDATE sites SET site_url = NULL WHERE id = ?", [siteId]);
  await db.execute(
    `INSERT INTO site_product_cache (
       id, site_id, site_slug, external_product_key, product_title, product_url, cached_status
     ) VALUES (?, ?, ?, ?, ?, ?, 'active')`,
    [`product-${suffix}`, siteId, slug, `external-${suffix}`, "Brand fallback product", "https://catalog.brand-check.example.com/products/example"]
  );
  assert.equal(
    (await resolvePublicSiteBranding(slug)).siteUrl,
    "https://catalog.brand-check.example.com",
    "empty site URL should derive the current storefront origin from the same site's active trusted cache"
  );

  await db.execute("UPDATE sites SET site_status = 'inactive' WHERE id = ?", [siteId]);
  assert.equal(await resolvePublicSiteBranding(slug), null, "inactive sites must not expose public branding");
  await assert.rejects(
    resolveRegistrationSite(slug, db),
    /currently unavailable/,
    "inactive explicit sites must not register into the default site"
  );

  console.log("site branding self-check passed");
} finally {
  if (siteId) {
    await db.execute("DELETE FROM site_geo_regions WHERE site_id = ?", [siteId]).catch(() => {});
    await db.execute("DELETE FROM sites WHERE id = ?", [siteId]).catch(() => {});
  }
  await db.execute("DELETE FROM geo_regions WHERE id = ?", [regionId]).catch(() => {});
  await closeDbPool();
}
