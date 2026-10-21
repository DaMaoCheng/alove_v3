import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const files = {
  service: "server/promotion-campaign-service.js",
  query: "server/promotion-campaign-query-service.js",
  write: "server/promotion-campaign-write-service.js",
  normalizers: "server/promotion-campaign-normalizers.js",
  mapper: "server/promotion-campaign-mapper.js",
  stats: "server/promotion-campaign-stats-service.js",
  lifecycle: "server/promotion-campaign-lifecycle-service.js",
  server: "server/server.js",
};

for (const path of Object.values(files)) {
  assert.ok(existsSync(path), `promotion campaign split file should exist: ${path}`);
}

const source = Object.fromEntries(
  Object.entries(files).map(([key, path]) => [key, readFileSync(path, "utf8")]),
);

assert.match(source.service, /export\s+\{\s*getPromotionCampaignById\s*\}\s+from\s+"\.\/promotion-campaign-query-service\.js";/, "service should re-export single campaign query entry point");
assert.match(source.service, /export\s+async\s+function\s+listPromotionCampaigns/, "service should keep listPromotionCampaigns as public stats orchestration entry");
assert.match(source.service, /listPromotionCampaignRows/, "service list entry should delegate row loading to query module");
assert.match(source.service, /export\s+\{\s*createPromotionCampaign,\s*updatePromotionCampaign\s*\}\s+from\s+"\.\/promotion-campaign-write-service\.js";/, "service should re-export write entry points");
assert.match(source.service, /loadPromotionCampaignStats/, "service should orchestrate stats loading for list results");
assert.match(source.service, /mapPromotionCampaignRow/, "service should map list rows through mapper");
assert.doesNotMatch(source.service, /crypto\.randomUUID|getDbPool\(|normalizePromotionCampaignPayload|function\s+normalizeProductSnapshot|function\s+parseKeywords/, "service should not keep write, DB, or normalization details");

for (const name of ["listPromotionCampaignRows", "getPromotionCampaignRowById", "getPromotionCampaignById", "assertPromotionCampaignSiteExists"]) {
  assert.match(source.query, new RegExp(`export\\s+async\\s+function\\s+${name}`), `query module should export ${name}`);
}
assert.match(source.query, /PROMOTION_CAMPAIGN_SELECT/, "query module should own shared campaign select SQL");
assert.doesNotMatch(source.query, /crypto\.randomUUID|normalizePromotionCampaignPayload/, "query module should not own write or normalization logic");

for (const name of ["createPromotionCampaign", "updatePromotionCampaign"]) {
  assert.match(source.write, new RegExp(`export\\s+async\\s+function\\s+${name}`), `write module should export ${name}`);
}
assert.match(source.write, /normalizePromotionCampaignPayload/, "write module should delegate payload normalization");
assert.match(source.write, /getPromotionCampaignById/, "write module should reload saved campaigns through query module");
assert.match(source.write, /crypto\.randomUUID/, "write module should own create id generation");

for (const name of ["normalizePromotionCampaignPayload", "normalizeProductSnapshot", "normalizeKeywords", "normalizeRoleTarget", "normalizeCampaignStatus", "normalizePriority", "normalizeDateTime"]) {
  assert.match(source.normalizers, new RegExp(`export\\s+(?:async\\s+)?function\\s+${name}`), `normalizers module should export ${name}`);
}
assert.doesNotMatch(source.normalizers, /getDbPool\(|execute\(/, "normalizers module should not query the database directly");
assert.match(source.normalizers, /status === "active" && endsAt && endsAt\.getTime\(\) <= now\.getTime\(\)/, "normalizers should reject expired active campaign writes");

assert.match(source.lifecycle, /export async function archiveExpiredPromotionCampaigns/, "lifecycle module should expose deterministic expiration reconciliation");
assert.match(source.lifecycle, /campaign_status = 'active'[\s\S]+ends_at <= \?/, "lifecycle reconciliation should archive only expired active campaigns");
assert.match(source.lifecycle, /setInterval/, "lifecycle module should schedule periodic reconciliation");
assert.match(source.query, /await archiveExpiredPromotionCampaigns\(\)/, "admin list reads should reconcile expiration without waiting for the next timer");
assert.match(source.server, /startPromotionCampaignLifecycleScheduler\(\)/, "server startup should start campaign lifecycle reconciliation");
assert.match(source.server, /stopPromotionCampaignLifecycleSchedulerAndWait\(\)/, "server shutdown should wait for campaign lifecycle reconciliation");

for (const name of ["mapPromotionCampaignRow", "parseKeywords", "parseProductSnapshot", "toIso"]) {
  assert.match(source.mapper, new RegExp(`(?:export\\s+function\\s+${name}|export\\s+\\{[^}]*\\b${name}\\b[^}]*\\})`), `mapper module should export ${name}`);
}
assert.doesNotMatch(source.mapper, /getDbPool\(|execute\(/, "mapper module should not query the database");

for (const name of ["loadPromotionCampaignStats", "emptyCampaignStats", "toCount", "ratio"]) {
  assert.match(source.stats, new RegExp(`export\\s+(?:async\\s+)?function\\s+${name}`), `stats module should export ${name}`);
}
assert.match(source.stats, /product_bubble_impression/, "stats module should own analytics aggregation");
assert.doesNotMatch(source.stats, /crypto\.randomUUID|normalizePromotionCampaignPayload/, "stats module should not own write or normalization logic");

console.log("promotion campaign backend split self-check passed");
