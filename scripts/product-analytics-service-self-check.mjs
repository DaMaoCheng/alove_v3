import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const schema = readFileSync("database/schema.sql", "utf8");
const dbSource = readFileSync("server/db-bootstrap-commerce-tables.js", "utf8");
const clientEventRouteSource = readFileSync("server/admin-client-event-routes.js", "utf8");
const analyticsRouteSource = readFileSync("server/admin-analytics-routes.js", "utf8");
const serviceSource = readFileSync("server/product-analytics-service.js", "utf8");
const adminServiceSource = readFileSync("server/admin-product-analytics-service.js", "utf8");

assert.match(schema, /CREATE TABLE IF NOT EXISTS product_analytics_events/, "schema should define product analytics events table");
assert.match(dbSource, /CREATE TABLE IF NOT EXISTS product_analytics_events/, "db bootstrap should create product analytics events table");

for (const field of [
  "event_type",
  "site_id",
  "site_slug",
  "character_id",
  "character_name",
  "owner_user_id",
  "user_id",
  "session_id",
  "message_id",
  "product_id",
  "product_title",
  "product_url",
]) {
  assert.match(schema, new RegExp(`${field}\\s+`, "i"), `analytics table should include ${field}`);
}

for (const eventType of [
  "product_bubble_triggered",
  "product_bubble_impression",
  "product_bubble_click",
  "product_search_result_impression",
  "product_search_result_click",
  "product_kitshop_impression",
  "product_kitshop_card_click",
  "product_detail_open",
  "product_detail_cta_click",
]) {
  assert.match(serviceSource, new RegExp(`"${eventType}"`), `service should whitelist ${eventType}`);
}

assert.match(serviceSource, /recordProductAnalyticsEvent/, "service should expose product analytics event recording");
assert.match(serviceSource, /recordProductBubbleTriggered/, "service should expose server-side product bubble trigger recording");
assert.match(serviceSource, /recordProductBubbleTriggered[\s\S]*acquireDedicatedDbAdvisoryLock/, "server-side product triggers must serialize duplicate checks and inserts");
assert.doesNotMatch(serviceSource, /getAdminProductAnalyticsOverview/, "event ingestion service must not own admin reporting");
assert.match(adminServiceSource, /getAdminProductAnalyticsOverview/, "admin reporting service should expose the product overview");
assert.match(adminServiceSource, /COUNT\(\*\)[\s\S]*GROUP BY event_type/, "admin reporting service should aggregate counts by event type");
assert.match(adminServiceSource, /product_detail_cta_click/, "admin reporting service should aggregate CTA clicks");
assert.match(adminServiceSource, /GROUP BY[\s\S]*product_key/, "admin reporting service should build product ranking by stable product key");
assert.match(serviceSource, /safeEventPayload/, "service should normalize frontend payload");
assert.match(adminServiceSource, /LEFT JOIN chat_messages/, "admin reporting service should backfill product ranking names from chat messages");
assert.match(adminServiceSource, /product_payload_json/, "admin reporting service should read product payload JSON when analytics events miss product fields");
assert.match(serviceSource, /enrichProductAnalyticsPayload/, "service should enrich future analytics events from message payloads before insert");
assert.match(serviceSource, /verifyProductCatalogAnalyticsReceipt/, "search and Kitshop events should require a signed catalog receipt");
assert.match(serviceSource, /hasRecordedCatalogEvent/, "catalog clicks should have a bounded duplicate guard");
assert.match(adminServiceSource, /sourceBreakdown/, "admin reporting should return per-entry-source funnel data");
assert.match(adminServiceSource, /product_kitshop_card_click/, "admin reporting should aggregate Kitshop card clicks");
assert.match(adminServiceSource, /product_search_result_impression/, "admin reporting should aggregate search impressions");

assert.match(clientEventRouteSource, /\/api\/analytics\/product-events/, "admin client event routes should accept client product analytics events");
assert.match(analyticsRouteSource, /\/api\/admin\/analytics\/product-overview/, "admin analytics routes should expose product overview analytics");

console.log("product analytics service self-check passed");
