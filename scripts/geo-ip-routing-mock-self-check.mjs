import assert from "node:assert/strict";
import { closeDbPool, getDbPool, initializeDatabase } from "../server/db.js";
import { updateAdminSite, listAdminSites } from "../server/admin-site-service.js";
import { loginUser } from "../server/auth-service.js";
import { resolveSiteForRequest } from "../server/geo-site-resolver-service.js";
import { hashSecret } from "../server/security.js";
import { pathForSiteView, resolveEffectiveSiteSlug } from "../src/app/site-routing.js";

const db = getDbPool();
const PASSWORD = "IpRoutingCheck123";
const BOUND_USER_ID = "u_ip_route_bound_check";
const ADMIN_USER_ID = "u_ip_route_admin_check";
const BOUND_EMAIL = "ip-route-bound@example.local";
const ADMIN_EMAIL = "ip-route-admin@example.local";

await initializeDatabase();
const regionSnapshot = await snapshotSiteRegions(["site_gg", "site_fkk"]);

try {
  await cleanup();
  const defaultSite = await seedRegions();
  await seedUser({ id: BOUND_USER_ID, email: BOUND_EMAIL, accountType: "personal", siteId: "site_fkk" });
  await seedUser({ id: ADMIN_USER_ID, email: ADMIN_EMAIL, accountType: "admin", siteId: "site_fkk" });

  const ukVisitor = await resolveSiteForRequest(mockRequest("203.0.113.8"), { fetchImpl: mockUkIpFetch });
  assert.equal(ukVisitor.siteId, "site_fkk", "UK public IP should resolve to the UK site");
  assert.equal(ukVisitor.siteSlug, "footballkituk", "UK public IP should resolve to footballkituk");
  assert.equal(ukVisitor.matchLevel, "subdivision", "UK London IP should match the most specific region");

  const unmatchedVisitor = await resolveSiteForRequest(mockRequest("198.51.100.9"), { fetchImpl: mockUnknownIpFetch });
  assert.equal(unmatchedVisitor.siteId, defaultSite.id, "unmatched public IP should resolve to configured default site");
  assert.equal(unmatchedVisitor.siteSlug, defaultSite.slug, "unmatched public IP should resolve to configured default site slug");
  assert.equal(unmatchedVisitor.matchLevel, "default", "unmatched public IP should be marked as default fallback");

  const boundLogin = await loginUser({ email: BOUND_EMAIL, password: PASSWORD });
  const boundEffectiveSlug = resolveEffectiveSiteSlug({
    currentSlug: unmatchedVisitor.siteSlug,
    visitorSiteSlug: unmatchedVisitor.siteSlug,
    assignedSiteSlug: boundLogin.user.siteSlug,
    accountType: boundLogin.user.accountType,
  });
  assert.equal(boundEffectiveSlug, "footballkituk", "bound personal user should prefer account site over IP/default site");
  assert.equal(pathForSiteView(boundEffectiveSlug, "discover"), "/footballkituk/discover", "bound personal user should route to assigned site path");

  const adminLogin = await loginUser({ email: ADMIN_EMAIL, password: PASSWORD });
  const adminEffectiveSlug = resolveEffectiveSiteSlug({
    currentSlug: unmatchedVisitor.siteSlug,
    visitorSiteSlug: unmatchedVisitor.siteSlug,
    assignedSiteSlug: adminLogin.user.siteSlug,
    accountType: adminLogin.user.accountType,
  });
  assert.equal(adminEffectiveSlug, "footballkituk", "bound admin user should prefer account site over IP/default site");

  console.log("geo IP routing mock self-check passed");
} finally {
  await cleanup();
  await restoreSiteRegions(regionSnapshot);
  await closeDbPool();
}

async function seedRegions() {
  const initial = await listAdminSites();
  const gg = initial.items.find((item) => item.id === "site_gg");
  const fkk = initial.items.find((item) => item.id === "site_fkk");
  const defaultSite = initial.items.find((item) => item.isDefault) || gg;
  assert.ok(gg && fkk, "seeded GG and FKK sites should exist");
  assert.ok(defaultSite, "a default site should exist");
  await updateAdminSite("site_gg", sitePayload(gg, []));
  await updateAdminSite("site_fkk", sitePayload(fkk, ["geo_uk_country", "geo_london"]));
  const updated = await listAdminSites();
  const updatedFkk = updated.items.find((item) => item.id === "site_fkk");
  assertProductSourcePreserved(updatedFkk, fkk);
  return defaultSite;
}

function sitePayload(site, regionIds) {
  return {
    name: site.name,
    slug: site.slug,
    siteUrl: site.siteUrl,
    defaultLanguage: site.defaultLanguage || "English",
    mascotCharacterId: site.mascotCharacterId,
    productApiUrl: site.productApiUrl || "",
    productSourceType: site.productSourceType || "",
    productShopDomain: site.productShopDomain || "",
    productApiVersion: site.productApiVersion || "",
    productAccessToken: "",
    description: site.description,
    regionIds,
  };
}

function assertProductSourcePreserved(actual, expected) {
  assert.equal(actual.productApiUrl, expected.productApiUrl, "geo IP routing self-check should preserve product API URL");
  assert.equal(actual.productSourceType, expected.productSourceType, "geo IP routing self-check should preserve product source type");
  assert.equal(actual.productShopDomain, expected.productShopDomain, "geo IP routing self-check should preserve Shopify shop domain");
  assert.equal(actual.productApiVersion, expected.productApiVersion, "geo IP routing self-check should preserve Shopify API version");
}

async function seedUser({ id, email, accountType, siteId }) {
  await db.execute(
    `INSERT INTO users (
       id, platform, platform_uid, locale, username, password_hash, nickname,
       email, email_verified_at, email_auth_provider, account_type, site_id, last_seen_at
     ) VALUES (?, 'web', ?, 'cn', ?, ?, 'Geo IP Routing Check', ?, NOW(3), 'email', ?, ?, NOW(3))`,
    [id, email, email, hashSecret(PASSWORD), email, accountType, siteId]
  );
  await db.execute("INSERT INTO billing_accounts (internal_uid, balance, currency) VALUES (?, 0, 'credits')", [id]);
}

async function cleanup() {
  await db.execute("DELETE FROM billing_accounts WHERE internal_uid IN (?, ?)", [BOUND_USER_ID, ADMIN_USER_ID]).catch(() => {});
  await db.execute("DELETE FROM users WHERE id IN (?, ?)", [BOUND_USER_ID, ADMIN_USER_ID]).catch(() => {});
  await db.execute("DELETE FROM site_geo_regions WHERE site_id IN ('site_gg', 'site_fkk')").catch(() => {});
}

async function snapshotSiteRegions(siteIds) {
  const placeholders = siteIds.map(() => "?").join(",");
  const [rows] = await db.execute(
    `SELECT site_id, region_id, priority FROM site_geo_regions WHERE site_id IN (${placeholders}) ORDER BY site_id, priority`,
    siteIds
  );
  const snapshot = new Map(siteIds.map((siteId) => [siteId, []]));
  rows.forEach((row) => {
    if (!snapshot.has(row.site_id)) snapshot.set(row.site_id, []);
    snapshot.get(row.site_id).push({ regionId: row.region_id, priority: Number(row.priority || 0) });
  });
  return snapshot;
}

async function restoreSiteRegions(snapshot) {
  const siteIds = Array.from(snapshot.keys());
  if (!siteIds.length) return;
  const placeholders = siteIds.map(() => "?").join(",");
  await db.execute(`DELETE FROM site_geo_regions WHERE site_id IN (${placeholders})`, siteIds).catch(() => {});
  const values = [];
  snapshot.forEach((regions, siteId) => {
    regions.forEach((region) => values.push(siteId, region.regionId, region.priority));
  });
  if (!values.length) return;
  await db.execute(
    `INSERT INTO site_geo_regions (site_id, region_id, priority) VALUES ${Array.from({ length: values.length / 3 }, () => "(?, ?, ?)").join(", ")}`,
    values
  );
}

function mockRequest(ip) {
  return {
    headers: { "x-forwarded-for": ip },
    socket: { remoteAddress: "127.0.0.1" },
  };
}

async function mockUkIpFetch(url) {
  assert.ok(String(url).includes("203.0.113.8"), "provider request should include forwarded UK test IP");
  return {
    ok: true,
    async json() {
      return { country_code: "GB", region: "London", city: "London" };
    },
  };
}

async function mockUnknownIpFetch(url) {
  assert.ok(String(url).includes("198.51.100.9"), "provider request should include forwarded unmatched test IP");
  return {
    ok: true,
    async json() {
      return { country_code: "ZZ", region: "Unknown", city: "Unknown" };
    },
  };
}
