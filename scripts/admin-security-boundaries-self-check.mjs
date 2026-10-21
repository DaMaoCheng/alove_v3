import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SERVER_CONFIG } from "../server/config.js";

const adminRoutesSource = [
  "server/admin-routes.js",
  "server/admin-account-routes.js",
  "server/admin-analytics-routes.js",
  "server/admin-carousel-routes.js",
  "server/admin-character-routes.js",
  "server/admin-client-event-routes.js",
  "server/admin-feedback-routes.js",
  "server/admin-knowledge-routes.js",
  "server/admin-log-routes.js",
  "server/admin-mascot-routes.js",
  "server/admin-promotion-routes.js",
  "server/admin-site-routes.js",
].map(readSource).join("\n");
const routeUtilsSource = readSource("server/route-utils.js");
const configSource = readSource("server/config.js");

assert.match(
  adminRoutesSource,
  /path === "\/api\/client-errors\/report"[\s\S]*?requireAuth\(req,\s*readAuthToken\)/,
  "client error reporting should require an authenticated user before writing logs"
);
assert.match(
  adminRoutesSource,
  /recordAppErrorLog\(\{[\s\S]*?userId:\s*user\.id/,
  "client error logs should attach the authenticated user id"
);

for (const scopeName of [
  "PROMOTIONS_WRITE",
  "CHARACTERS_WRITE",
  "FEEDBACK_WRITE",
  "KNOWLEDGE_WRITE",
  "MASCOT_WRITE",
  "SITES_WRITE",
  "ACCOUNTS_WRITE",
  "CAROUSEL_WRITE",
]) {
  assert.match(
    routeUtilsSource,
    new RegExp(`${scopeName}:\\s*"admin:[a-z]+s?:write"`),
    `${scopeName} should be declared as a concrete admin write scope`
  );
  assert.match(
    adminRoutesSource,
    new RegExp(`requireAdmin\\(req,\\s*ADMIN_SCOPES\\.${scopeName}\\)`),
    `${scopeName} should be enforced by at least one admin write route`
  );
}

assert.match(
  routeUtilsSource,
  /adminHasScope\(user,\s*scope\)/,
  "requireAdmin should delegate scope checks instead of only checking account_type"
);
assert.match(
  routeUtilsSource,
  /SERVER_CONFIG\.security\.superAdminEmails/,
  "admin write scopes should be constrained by configured super admin emails"
);
assert.match(
  configSource,
  /AIOVE_SUPER_ADMIN_EMAILS/,
  "super admin allowlist should be configurable by environment"
);
assert.ok(
  SERVER_CONFIG.security.superAdminEmails.includes("admin@aiove.local"),
  "local default admin should keep super admin write permissions"
);

console.log("admin security boundaries self-check passed");

function readSource(pathname) {
  return readFileSync(new URL(`../${pathname}`, import.meta.url), "utf8");
}
