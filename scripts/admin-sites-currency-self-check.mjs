import assert from "node:assert/strict";
import { initializeDatabase, getDbPool } from "../server/db.js";
import { listAdminSites } from "../server/admin-site-service.js";
import { adminSiteEditorHtml, adminSitesTableHtml } from "../src/features/admin-console/admin-console-sites-template.js";

const site = {
  id: "site_global",
  name: "AIOVE Global",
  slug: "global",
  siteUrl: "https://alove.fans/global",
  defaultLanguage: "English",
  currency: "USD",
  isDefault: true,
  mascotCharacterId: "mascot_global",
  mascotName: "Kit",
  productApiUrl: "https://example.com/products",
  description: "Global site",
  userCount: 12,
  creatorCount: 3,
};

const tableHtml = adminSitesTableHtml({ items: [site] });
assert.ok(!tableHtml.includes("货币"), "sites table should not render currency column header");
assert.ok(!tableHtml.includes("USD"), "sites table should not render currency values");

const editHtml = adminSiteEditorHtml(site);
assert.ok(!editHtml.includes("货币"), "site editor should not render currency label");
assert.ok(!editHtml.includes('name="currency"'), "site editor should not submit currency field");
assert.ok(!editHtml.includes("USD"), "site editor should not render currency value");

await initializeDatabase();
const pool = getDbPool();
try {
  const result = await listAdminSites();
  assert.equal(result.ok, true);
  assert.ok(Array.isArray(result.items), "site API should return items");
  assert.ok(result.items.length >= 1, "site API should return at least one site");
  assert.ok(!Object.hasOwn(result.items[0], "currency"), "site API should not expose currency field");
  console.log(JSON.stringify({
    ok: true,
    checked: "admin sites currency removal",
  }, null, 2));
} finally {
  await pool.end();
}
