import assert from "node:assert/strict";
import { closeDbPool, getDbPool, initializeDatabase } from "../server/db.js";
import { searchAdminGeoRegions } from "../server/geo-region-search-service.js";

await initializeDatabase();
const db = getDbPool();
const REGION_ID = "geo_gb_manchester";

try {
  await cleanup();

  const localBefore = await searchAdminGeoRegions("Manchester", { fetchImpl: mockManchesterFetch });
  assert.equal(localBefore.source, "remote", "missing local region should attempt remote search");
  assert.equal(localBefore.items.length, 1, "remote result should be imported as selectable region");
  assert.equal(localBefore.items[0].id, REGION_ID, "remote city should be normalized to deterministic region id");
  assert.ok(localBefore.regions.some((item) => item.id === "geo_uk_country"), "country parent should exist after import");
  assert.ok(localBefore.regions.some((item) => item.id === "geo_europe"), "continent parent should exist after import");

  const localAfter = await searchAdminGeoRegions("Manchester", { fetchImpl: mockManchesterFetch });
  assert.equal(localAfter.source, "local", "imported region should be reused from local cache");
  assert.ok(localAfter.items.some((item) => item.id === REGION_ID), "local cache should include imported region");

  console.log("geo region online search self-check passed");
} finally {
  await cleanup();
  await closeDbPool();
}

async function mockManchesterFetch() {
  return {
    ok: true,
    async json() {
      return [{
        name: "Manchester",
        display_name: "Manchester, Greater Manchester, England, United Kingdom",
        address: {
          city: "Manchester",
          country: "United Kingdom",
          country_code: "gb",
        },
      }];
    },
  };
}

async function cleanup() {
  await db.execute("DELETE FROM site_geo_regions WHERE region_id = ?", [REGION_ID]).catch(() => {});
  await db.execute("DELETE FROM geo_regions WHERE id = ?", [REGION_ID]).catch(() => {});
}
