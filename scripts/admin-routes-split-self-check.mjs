import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const entrySource = readSource("server/admin-routes.js");
const routeModules = [
  "admin-account-routes",
  "admin-analytics-routes",
  "admin-carousel-routes",
  "admin-character-routes",
  "admin-client-event-routes",
  "admin-knowledge-routes",
  "admin-log-routes",
  "admin-mascot-routes",
  "admin-promotion-routes",
  "admin-site-routes",
];

for (const moduleName of routeModules) {
  assert.match(
    entrySource,
    new RegExp(`from "\\./${moduleName}\\.js"`),
    `admin route entry should import ${moduleName}`
  );
}

assert.doesNotMatch(entrySource, /createAdminAccount|createAdminSite|createKnowledgeBaseFromAi|createPromotionCampaign|createAdminMascot|createAdminHomeCarouselItem/, "admin route entry should not keep business service calls");
assert.match(entrySource, /const adminRouteHandlers = \[/, "admin route entry should dispatch through route handlers");

const allRouteSources = routeModules.map((moduleName) => readSource(`server/${moduleName}.js`)).join("\n");
for (const routePath of [
  "/api/admin/accounts",
  "/api/admin/sites",
  "/api/admin/knowledge-bases",
  "/api/admin/mascot",
  "/api/admin/promotion-campaigns",
  "/api/admin/carousel",
  "/api/client-errors/report",
]) {
  assert.match(allRouteSources, new RegExp(escapeRegExp(routePath)), `${routePath} should be handled by a split admin route module`);
}

console.log("admin routes split self-check passed");

function readSource(pathname) {
  return readFileSync(new URL(`../${pathname}`, import.meta.url), "utf8");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
