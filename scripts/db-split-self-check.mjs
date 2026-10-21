import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const facade = readSource("server/db.js");
const core = readSource("server/db-core.js");
const schemaUtils = readSource("server/db-schema-utils.js");
const columnMigrations = readSource("server/db-column-migrations.js");
const bootstrapTables = readSource("server/db-bootstrap-tables.js");
const bootstrapSeeds = readSource("server/db-bootstrap-seeds.js");
const bootstrapDomains = {
  core: {
    pathname: "server/db-bootstrap-core-tables.js",
    exports: [
      "createGeoRegionTablesIfMissing",
      "createSitesTableIfMissing",
      "createUserCharacterActivationsTableIfMissing",
    ],
  },
  commerce: {
    pathname: "server/db-bootstrap-commerce-tables.js",
    exports: [
      "createDiscountCodeTablesIfMissing",
      "createProductAnalyticsEventsTableIfMissing",
      "createPromotionCampaignTablesIfMissing",
      "createShopifyCartSessionsTableIfMissing",
      "createShopifyCustomerBindingsTableIfMissing",
      "createShopifyCustomerSyncAuditsTableIfMissing",
      "createShopifyDraftOrderAttemptsTableIfMissing",
      "createSiteHomeProductSectionsTableIfMissing",
      "createSiteKitshopSalesCacheTableIfMissing",
      "createSiteProductCacheTableIfMissing",
      "createTtmallAccountBindingsTableIfMissing",
      "createTtmallBindingCandidatesTableIfMissing",
      "createTtmallCartSessionsTableIfMissing",
      "createTtmallCheckoutAttemptsTableIfMissing",
    ],
  },
  chat: {
    pathname: "server/db-bootstrap-chat-tables.js",
    exports: [
      "createChatImageTablesIfMissing",
      "createChatQuickRepliesTableIfMissing",
      "createGuestChatTablesIfMissing",
      "createMascotGreetingImageTablesIfMissing",
      "createMascotSettingsTableIfMissing",
    ],
  },
  operations: {
    pathname: "server/db-bootstrap-operations-tables.js",
    exports: [
      "createAdminOperationLogsTableIfMissing",
      "createAiReplyLogsTableIfMissing",
      "createAppErrorLogsTableIfMissing",
      "createHomeCarouselItemsTableIfMissing",
      "createMascotAdDeliveriesTableIfMissing",
      "createProactiveMessageDeliveriesTableIfMissing",
      "createUserFeedbackTableIfMissing",
    ],
  },
  knowledge: {
    pathname: "server/db-bootstrap-knowledge-tables.js",
    exports: [
      "createKnowledgeBaseBindingsTableIfMissing",
      "createKnowledgeBaseTablesIfMissing",
    ],
  },
  external: {
    pathname: "server/db-bootstrap-external-embed-tables.js",
    exports: [
      "createSiteExternalEmbedsTableIfMissing",
    ],
  },
};

assert.match(facade, /from "\.\/db-core\.js"/, "db.js should delegate pool and transaction ownership to db-core");
assert.match(facade, /export \{ closeDbPool, getDbPool, withTransaction \} from "\.\/db-core\.js";/, "db.js should preserve the existing db public exports through the facade");
assert.match(facade, /from "\.\/db-schema-utils\.js"/, "db.js should delegate schema helpers to db-schema-utils");
assert.match(facade, /from "\.\/db-column-migrations\.js"/, "db.js should delegate column migrations");
assert.match(facade, /from "\.\/db-bootstrap-tables\.js"/, "db.js should delegate table creation");
assert.match(facade, /from "\.\/db-bootstrap-seeds\.js"/, "db.js should delegate seed and backfill work");
assert.doesNotMatch(facade, /mysql2\/promise/, "db.js should not own the mysql pool directly anymore");

assert.match(core, /export function getDbPool/, "db-core should own pool creation");
assert.match(core, /export async function withTransaction/, "db-core should own transaction orchestration");
assert.match(core, /closeDbAdvisoryLockPool\(\)/, "db-core should close the dedicated advisory lock pool with the business pool");

assert.match(schemaUtils, /export async function tableExists/, "db-schema-utils should own table existence checks");
assert.match(schemaUtils, /export async function addColumnIfMissing/, "db-schema-utils should own add-column helper");
assert.match(schemaUtils, /export async function addIndexIfMissing/, "db-schema-utils should own add-index helper");

assert.match(columnMigrations, /export async function ensureUserAccountTypeMigration/, "db-column-migrations should own legacy user account type migration");
assert.match(columnMigrations, /export async function addSiteColumnsIfMissing/, "db-column-migrations should own site column migrations");

assert.doesNotMatch(bootstrapTables, /CREATE TABLE|ALTER TABLE|getDbPool/, "db-bootstrap-tables should stay a compatibility facade without table implementation");
assert.doesNotMatch(bootstrapTables, /export async function/, "db-bootstrap-tables should re-export domain implementations instead of growing new table functions");

const expectedBootstrapExports = Object.values(bootstrapDomains)
  .flatMap((domain) => domain.exports)
  .sort();
const facadeModule = await import("../server/db-bootstrap-tables.js");
assert.deepEqual(
  Object.keys(facadeModule).sort(),
  expectedBootstrapExports,
  "db-bootstrap-tables should preserve the complete public export contract"
);

for (const [domainName, domain] of Object.entries(bootstrapDomains)) {
  const source = readSource(domain.pathname);
  const module = await import(`../${domain.pathname}`);
  assert.deepEqual(
    Object.keys(module).sort(),
    [...domain.exports].sort(),
    `${domainName} bootstrap should expose only its assigned table creators`
  );
  assert.match(source, /from "\.\/db-core\.js"/, `${domainName} bootstrap should use the shared database pool`);
  assert.match(source, /export async function/, `${domainName} bootstrap should own concrete table implementations`);
  assert.match(source, /CREATE TABLE/, `${domainName} bootstrap should contain its table definitions`);
  for (const helperName of ["addColumnIfMissing", "addIndexIfMissing"]) {
    if (!new RegExp(`\\b${helperName}\\(`).test(source)) continue;
    assert.match(
      source,
      new RegExp(`import \\{[^}]*\\b${helperName}\\b[^}]*\\} from "\\.\\/db-schema-utils\\.js"`),
      `${domainName} bootstrap should import every schema helper it calls`,
    );
  }
  assert.doesNotMatch(
    source,
    /from "\.\/db-bootstrap-(?:core|commerce|chat|operations|knowledge|external-embed)-tables\.js"/,
    `${domainName} bootstrap should not proxy another domain implementation`
  );
}

assert.match(bootstrapSeeds, /export async function seedDefaultChatQuickReplies/, "db-bootstrap-seeds should own quick reply seed data");
assert.match(bootstrapSeeds, /export async function seedDefaultMascotCharacters/, "db-bootstrap-seeds should own mascot seed data");

console.log("db split self-check passed");

function readSource(pathname) {
  return readFileSync(new URL(`../${pathname}`, import.meta.url), "utf8");
}
