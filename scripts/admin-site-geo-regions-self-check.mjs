import assert from "node:assert/strict";
import { closeDbPool, getDbPool, initializeDatabase } from "../server/db.js";
import { listAdminSites, updateAdminSite } from "../server/admin-site-service.js";

await initializeDatabase();
const db = getDbPool();
const regionSnapshot = await snapshotSiteRegions(["site_gg", "site_fkk"]);

try {
  await cleanup();
  const initial = await listAdminSites();
  assert.ok(initial.regions.some((item) => item.id === "geo_europe"), "region list should include Europe");
  assert.ok(initial.regions.some((item) => item.id === "geo_uk_country" && item.parentId === "geo_europe"), "region list should include UK under Europe");
  assert.ok(initial.regions.some((item) => item.id === "geo_london" && item.parentId === "geo_uk_country"), "region list should include London under UK");

  const gg = initial.items.find((item) => item.id === "site_gg");
  const fkk = initial.items.find((item) => item.id === "site_fkk");
  assert.ok(gg && fkk, "default seeded sites should exist");

  await updateAdminSite("site_gg", sitePayload(gg, ["geo_europe"]));
  await updateAdminSite("site_fkk", sitePayload(fkk, ["geo_uk_country", "geo_london"]));

  const updated = await listAdminSites();
  const updatedGg = updated.items.find((item) => item.id === "site_gg");
  const updatedFkk = updated.items.find((item) => item.id === "site_fkk");
  assert.deepEqual(updatedGg.regionIds, ["geo_europe"], "parent region can bind to one site");
  assert.deepEqual(updatedFkk.regionIds, ["geo_uk_country", "geo_london"], "country/subdivision can bind to another site");
  assertProductSourcePreserved(updatedFkk, fkk);

  await assert.rejects(
    () => updateAdminSite("site_gg", sitePayload(updatedGg, ["geo_uk_country"])),
    /目标地区已绑定到其他站点/,
    "same exact region should not bind to two sites"
  );

  console.log("admin site geo regions self-check passed");
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
  assert.equal(actual.productApiUrl, expected.productApiUrl, "site geo self-check should preserve product API URL");
  assert.equal(actual.productSourceType, expected.productSourceType, "site geo self-check should preserve product source type");
  assert.equal(actual.productShopDomain, expected.productShopDomain, "site geo self-check should preserve Shopify shop domain");
  assert.equal(actual.productApiVersion, expected.productApiVersion, "site geo self-check should preserve Shopify API version");
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
