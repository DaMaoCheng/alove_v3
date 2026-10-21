import assert from "node:assert/strict";
import { initializeDatabase, closeDbPool } from "../server/db.js";
import { listAdminSites } from "../server/admin-site-service.js";
import { resolveSiteForIpLocation, resolveSiteForRequest } from "../server/geo-site-resolver-service.js";
import { DEFAULT_SITE_SLUG, getSiteSlugFromPath, shouldRedirectToDefaultSite, sitePathForUnprefixedPath } from "../src/app/site-routing.js";

await initializeDatabase();

try {
  const result = await listAdminSites();
  const sites = result.items || [];
  const regions = result.regions || [];
  const defaultSite = sites.find((site) => site.isDefault);
  const gg = sites.find((site) => site.id === "site_gg");
  const fkk = sites.find((site) => site.id === "site_fkk");

  assert.equal(DEFAULT_SITE_SLUG, "gogoalshop", "frontend default site slug should be gogoalshop");
  assert.ok(defaultSite, "one active default site should exist");
  assert.ok(defaultSite.slug, "the active default site must have a slug");
  assert.ok(gg, "GG site should exist");
  assert.ok(fkk, "FKK site should exist");
  assert.equal(gg.slug, "gogoalshop", "GG site slug should be gogoalshop");
  assert.equal(fkk.slug, "footballkituk", "FKK site slug should be footballkituk");

  assert.ok(regions.some((region) => region.id === "geo_europe"), "geo region library should include Europe");
  assert.ok(regions.some((region) => region.id === "geo_uk_country" && region.parentId === "geo_europe"), "geo region library should include UK under Europe");
  assert.ok(regions.some((region) => region.id === "geo_london" && region.parentId === "geo_uk_country"), "geo region library should include London under UK");

  assert.equal(shouldRedirectToDefaultSite("/login"), true, "bare /login should be eligible for site resolution");
  assert.equal(shouldRedirectToDefaultSite("/register"), true, "bare /register should be eligible for site resolution");
  assert.equal(shouldRedirectToDefaultSite("/discover"), true, "bare /discover should be eligible for site resolution");
  assert.equal(shouldRedirectToDefaultSite("/admin"), false, "admin route must stay global");
  assert.equal(getSiteSlugFromPath("/footballkituk/discover"), "footballkituk", "site-prefixed route should resolve FKK slug");
  assert.equal(sitePathForUnprefixedPath("footballkituk", "/register", "?invite=ABC"), "/footballkituk/register?invite=ABC", "bare register path should preserve query when assigned to FKK");

  const defaultResolution = await resolveSiteForIpLocation({ countryCode: "ZZ" });
  assert.equal(defaultResolution.siteSlug, defaultSite.slug, "unmatched location should use the configured active default site");
  assert.equal(defaultResolution.matchLevel, "default", "unmatched location should report default match level");

  const privateRequest = await resolveSiteForRequest(mockRequest("127.0.0.1"), {
    fetchImpl: async () => {
      throw new Error("private IP should not call external provider");
    },
  });
  assert.equal(privateRequest.siteSlug, defaultSite.slug, "private IP should fall back to the configured active default site");
  assert.equal(privateRequest.matchLevel, "default", "private IP should report default match level");

  console.log("multisite preflight self-check passed");
} finally {
  await closeDbPool();
}

function mockRequest(ip) {
  return {
    headers: { "x-forwarded-for": ip },
    socket: { remoteAddress: "127.0.0.1" },
  };
}
