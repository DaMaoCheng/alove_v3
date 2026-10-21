import assert from "node:assert/strict";
import { initializeDatabase, getDbPool } from "../server/db.js";
import { listAdminMascotSettings } from "../server/admin-mascot-service.js";

await initializeDatabase();
const pool = getDbPool();

try {
  const result = await listAdminMascotSettings();

  assert.equal(result.ok, true);
  assert.ok(result.template, "template mascot should exist");
  assert.equal(result.template.id, "mascot_template");
  assert.ok(result.template.name, "template mascot should have a name");
  assert.ok(Array.isArray(result.template.knowledge), "template knowledge should be an array");
  assert.ok(Array.isArray(result.sites), "sites should be an array");
  assert.ok(result.sites.length >= 1, "at least one site should be returned");

  const defaultSite = result.sites.find((site) => site.id === "site_gg");
  assert.ok(defaultSite, "GG default site should be returned");
  assert.ok(defaultSite.mascot.id, "GG default site should have a resolved mascot id");
  assert.ok(defaultSite.mascot.name, "GG default site should have a resolved mascot name");
  assert.equal(typeof defaultSite.productApiUrl, "string");
  assert.equal(typeof defaultSite.sentAdCount, "number");
  assert.equal(typeof defaultSite.userCount, "number");

  const fkkSite = result.sites.find((site) => site.id === "site_fkk");
  assert.ok(fkkSite, "FKK site should be returned");
  assert.ok(fkkSite.mascot.id, "FKK site should have a resolved mascot id");
  assert.ok(fkkSite.mascot.source, "FKK site should have a mascot source label");
  assert.equal(fkkSite.slug, "footballkituk");
  assert.match(fkkSite.mascot.greeting, /Football Kit UK guide/i, "bound mascot should expose its character opening line in admin settings");
  assert.match(fkkSite.mascot.greeting, /menu in the top-left/i, "front-desk opening line should guide visitors to the app navigation");
  assert.match(fkkSite.mascot.personaPrompt, /Millie|front-desk|Alove/i, "bound mascot should expose its character persona in admin settings");
  assert.ok(fkkSite.mascot.speakingStyle, "bound mascot should expose its character speaking style in admin settings");
  assert.match(result.template.greeting, /Alove football guide/i, "template mascot settings should stay aligned with the seeded opening line");
  assert.match(result.template.greeting, /menu in the top-left/i, "template mascot opening line should guide visitors to the app navigation");

  console.log(JSON.stringify({
    ok: true,
    checked: "admin mascot settings API data shape",
    siteCount: result.sites.length,
  }, null, 2));
} finally {
  await pool.end();
}
