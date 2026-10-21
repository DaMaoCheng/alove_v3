import assert from "node:assert/strict";
import { closeDbPool, getDbPool, initializeDatabase } from "../server/db.js";
import { updateAdminSite, listAdminSites } from "../server/admin-site-service.js";
import { resolveSiteForIpLocation, resolveSiteForRequest } from "../server/geo-site-resolver-service.js";

await initializeDatabase();
const db = getDbPool();
const regionSnapshot = await snapshotSiteRegions(["site_gg", "site_fkk"]);

try {
  await cleanup();

  const initial = await listAdminSites();
  const gg = initial.items.find((item) => item.id === "site_gg");
  const fkk = initial.items.find((item) => item.id === "site_fkk");
  const defaultSite = initial.items.find((item) => item.isDefault) || gg;
  assert.ok(gg && fkk, "seeded sites should exist");
  assert.ok(defaultSite, "a default site should exist");

  await updateAdminSite("site_gg", sitePayload(gg, ["geo_europe"]));
  await updateAdminSite("site_fkk", sitePayload(fkk, ["geo_uk_country", "geo_london"]));

  const afterBindings = await listAdminSites();
  const boundFkk = afterBindings.items.find((item) => item.id === "site_fkk");
  assertProductSourcePreserved(boundFkk, fkk);

  const london = await resolveSiteForIpLocation({ countryCode: "GB", subdivision: "London" });
  assert.equal(london.siteId, "site_fkk", "subdivision match should win over country and continent");
  assert.equal(london.matchLevel, "subdivision", "London should match the subdivision binding");

  const manchester = await resolveSiteForIpLocation({ countryCode: "GB", subdivision: "Manchester" });
  assert.equal(manchester.siteId, "site_fkk", "country match should catch UK users without a city binding");
  assert.equal(manchester.matchLevel, "country", "Manchester should fall back to UK country binding");

  const germany = await resolveSiteForIpLocation({ countryCode: "DE" });
  assert.equal(germany.siteId, "site_gg", "continent binding should catch unmatched European countries");
  assert.equal(germany.matchLevel, "continent", "Germany should fall back to Europe binding");

  const unknown = await resolveSiteForIpLocation({ countryCode: "ZZ" });
  assert.equal(unknown.siteId, defaultSite.id, "unknown locations should use configured default site");
  assert.equal(unknown.matchLevel, "default", "unknown locations should be marked as default fallback");

  const fromRequest = await resolveSiteForRequest(mockRequest("203.0.113.8"), { fetchImpl: mockUkIpFetch });
  assert.equal(fromRequest.siteId, "site_fkk", "public request IP should resolve through provider and match site");
  assert.equal(fromRequest.matchLevel, "subdivision", "mock UK London IP should match London binding");

  const fallbackRequest = await resolveSiteForRequest(mockRequest("185.248.85.37"), { fetchImpl: mockProviderFallbackToIpApiUkFetch });
  assert.equal(fallbackRequest.siteId, "site_fkk", "provider fallback should resolve UK IP when the first provider is rate limited");
  assert.equal(fallbackRequest.siteSlug, "footballkituk", "provider fallback should preserve the resolved UK site slug");
  assert.equal(fallbackRequest.location.source, "ip-api", "provider fallback should report the provider that returned the location");

  const cloudflareRequest = await resolveSiteForRequest(mockRequest("", { "cf-ipcountry": "GB" }), {
    fetchImpl: async () => {
      throw new Error("Cloudflare country header should not call external geo provider");
    },
  });
  assert.equal(cloudflareRequest.siteId, "site_fkk", "Cloudflare country header should resolve the visitor site without an external API");
  assert.equal(cloudflareRequest.location.source, "cloudflare", "Cloudflare country header should be reported as the geo source");

  let privateFetchCalled = false;
  const localRequest = await resolveSiteForRequest(mockRequest("127.0.0.1"), {
    fetchImpl: async () => {
      privateFetchCalled = true;
      throw new Error("private IP should not call geo provider");
    },
  });
  assert.equal(privateFetchCalled, false, "private IP should skip external geo provider");
  assert.equal(localRequest.siteId, defaultSite.id, "private IP should fall back to configured default site");
  assert.equal(localRequest.matchLevel, "default", "private IP should be marked as default fallback");

  console.log("geo site resolver self-check passed");
} finally {
  await restoreSiteRegions(regionSnapshot);
  await closeDbPool();
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
  assert.equal(actual.productApiUrl, expected.productApiUrl, "geo resolver self-check should preserve product API URL");
  assert.equal(actual.productSourceType, expected.productSourceType, "geo resolver self-check should preserve product source type");
  assert.equal(actual.productShopDomain, expected.productShopDomain, "geo resolver self-check should preserve Shopify shop domain");
  assert.equal(actual.productApiVersion, expected.productApiVersion, "geo resolver self-check should preserve Shopify API version");
}

async function cleanup() {
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

function mockRequest(ip, headers = {}) {
  return {
    headers: { "x-forwarded-for": ip, ...headers },
    socket: { remoteAddress: "127.0.0.1" },
  };
}

async function mockUkIpFetch(url) {
  assert.ok(String(url).includes("203.0.113.8"), "provider request should include forwarded public IP");
  return {
    ok: true,
    async json() {
      return { country_code: "GB", region: "London", city: "London" };
    },
  };
}

async function mockProviderFallbackToIpApiUkFetch(url) {
  const value = String(url);
  assert.ok(value.includes("185.248.85.37"), "provider request should include forwarded UK VPN IP");
  if (value.includes("ip-api.com")) {
    return {
      ok: true,
      async json() {
        return { status: "success", countryCode: "GB", regionName: "England", city: "London" };
      },
    };
  }
  if (value.includes("ipwho.is") || value.includes("ipapi.co")) return { ok: false, status: 429, async json() { return {}; } };
  throw new Error(`unexpected geo provider URL: ${value}`);
}
