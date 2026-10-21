import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const schemaSource = readFileSync("database/schema.sql", "utf8");
const dbSource = readFileSync("server/db.js", "utf8");
const migrationSource = readFileSync("server/db-column-migrations.js", "utf8");
const serverSource = readFileSync("server/home-carousel-service.js", "utf8");
const homeRoutesSource = readFileSync("server/home-routes.js", "utf8");
const clientServiceSource = readFileSync("src/services/home-carousel-service.js", "utf8");
const loadActionsSource = readFileSync("src/app/character-load-actions.js", "utf8");

assert.match(schemaSource, /site_id VARCHAR\(64\) NULL/, "home carousel schema should include optional site_id");
assert.match(schemaSource, /idx_home_carousel_site_status_order/, "home carousel schema should index site filtering");
assert.match(dbSource, /addHomeCarouselColumnsIfMissing/, "runtime migrations should ensure carousel site column exists");
assert.match(migrationSource, /home_carousel_items", "site_id"/, "runtime migrations should add home_carousel_items.site_id");

assert.match(serverSource, /LEFT JOIN sites s ON s\.id = hci\.site_id/, "admin carousel listing should expose bound site labels");
assert.match(serverSource, /siteId: row\.site_id \|\| ""/, "carousel mapper should return siteId");
assert.match(serverSource, /siteName: row\.site_name \|\| ""/, "carousel mapper should return siteName");
assert.match(serverSource, /siteSlug: row\.site_slug \|\| ""/, "carousel mapper should return siteSlug");
assert.match(serverSource, /resolveSiteContextBySlug/, "published carousel listing should resolve site slug and effective mascot");
assert.match(serverSource, /COALESCE\(ms\.character_id, sites\.mascot_character_id, 'mascot_template'\)/, "published carousel query should resolve effective site mascot");
assert.match(serverSource, /rawCtaTarget === "mascot_template"[\s\S]*effectiveMascotCharacterId/, "published carousel should auto-switch template mascot targets to the current site mascot");
assert.match(serverSource, /\((?:hci\.)?site_id IS NULL OR (?:hci\.)?site_id = '' OR (?:hci\.)?site_id = \?\)/, "published carousel query should include global and matching-site banners");
assert.match(serverSource, /fields\.siteId/, "create and update payload should persist siteId");

assert.match(homeRoutesSource, /requestUrl\.searchParams\.get\("siteSlug"\)/, "home carousel route should read siteSlug query");
assert.match(clientServiceSource, /listHomeCarouselItems\(\{ siteSlug = "" \} = \{\}\)/, "client carousel service should accept siteSlug");
assert.match(clientServiceSource, /query\.set\("siteSlug", siteSlug\)/, "client carousel service should send siteSlug query");
assert.match(loadActionsSource, /listHomeCarouselItems\(\{ siteSlug:/, "discover carousel loading should request current site carousel");

console.log("home carousel site binding self-check passed");
