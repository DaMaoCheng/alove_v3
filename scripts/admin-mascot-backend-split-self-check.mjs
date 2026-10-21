import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const files = {
  service: "server/admin-mascot-service.js",
  query: "server/admin-mascot-query-service.js",
  write: "server/admin-mascot-write-service.js",
  mapper: "server/admin-mascot-mapper.js",
  shared: "server/admin-mascot-shared.js",
};

for (const path of Object.values(files)) {
  assert.ok(existsSync(path), `admin mascot backend split file should exist: ${path}`);
}

const source = Object.fromEntries(
  Object.entries(files).map(([key, path]) => [key, readFileSync(path, "utf8")]),
);

const serviceExports = Array.from(source.service.matchAll(/export\s+\{([^}]+)\}\s+from\s+"\.\/(admin-mascot-(?:query|write)-service\.js)"/g));
assert.equal(serviceExports.length, 2, "admin-mascot-service should re-export query and write modules only");
assert.doesNotMatch(source.service, /getDbPool|withTransaction|function\s+|async\s+function/, "admin-mascot-service should stay a thin public entry module");

assert.match(source.query, /export\s+async\s+function\s+listAdminMascotSettings/, "query module should export listAdminMascotSettings");
assert.match(source.query, /mapMascotSiteRow/, "query module should delegate site rows to mapper");
assert.match(source.query, /mapUnboundMascotRow/, "query module should delegate unbound rows to mapper");
assert.match(source.query, /defaultTemplateMascot/, "query module should use mapper default template");
assert.doesNotMatch(source.query, /withTransaction/, "query module should not own write transactions");

for (const name of [
  "saveAdminMascotTemplate",
  "createAdminMascot",
  "updateAdminMascot",
  "saveAdminSiteMascot",
  "disableAdminSiteMascot",
]) {
  assert.match(source.write, new RegExp(`export\\s+async\\s+function\\s+${name}`), `write module should export ${name}`);
}
assert.match(source.write, /withTransaction/, "write module should own write transactions");
assert.match(source.write, /listAdminMascotSettings/, "write module should reload settings through query module after writes");

for (const name of ["mapMascotSetting", "mapMascotSiteRow", "mapUnboundMascotRow", "defaultTemplateMascot"]) {
  assert.match(source.mapper, new RegExp(`export\\s+function\\s+${name}`), `mapper module should export ${name}`);
}
assert.doesNotMatch(source.mapper, /getDbPool|withTransaction|execute\(/, "mapper module should not query the database");

for (const name of [
  "normalizeMascotPayload",
  "getExistingSite",
  "getExistingUnboundMascot",
  "createSiteMascotId",
  "assertSiteCanCreateMascot",
  "ensureMascotCategory",
  "replaceKnowledgeBindings",
  "upsertMascotCharacter",
]) {
  assert.match(source.shared, new RegExp(`export\\s+(?:async\\s+)?function\\s+${name}`), `shared module should export ${name}`);
}
assert.match(source.shared, /buildPersonaPrompt/, "shared module should keep mascot prompt construction with write helpers");
assert.match(source.shared, /FRONT_DESK_PVC_VOICE_ID\s*=\s*"m98EUhgNJclFM2V0xXhQ"/, "shared module should define the verified front desk PVC voice id");
assert.match(source.shared, /FRONT_DESK_PVC_LABEL\s*=\s*"ALOVE Front Desk PVC"/, "shared module should define the verified front desk PVC label");
assert.match(source.shared, /voice_provider = VALUES\(voice_provider\)/, "shared upsert should preserve mascot voice provider on updates");
assert.doesNotMatch(source.shared, /elevenlabs_clone_pending|Pending cloned front desk voice|pending_voice_id/, "shared mascot defaults should no longer create pending cloned voices");

console.log("admin mascot backend split self-check passed");
