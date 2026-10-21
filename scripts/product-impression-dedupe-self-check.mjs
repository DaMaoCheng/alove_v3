import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const serverSource = readFileSync("server/product-analytics-service.js", "utf8");
const chatProductImpressionsSource = readFileSync("src/features/chat/chat-product-impressions.js", "utf8");
const dbSource = readFileSync("server/db.js", "utf8");
const schemaSource = readFileSync("database/schema.sql", "utf8");

assert.match(serverSource, /shouldSkipDuplicateImpression/, "server analytics should check duplicate impressions");
assert.match(serverSource, /PRODUCT_ANALYTICS_EVENTS\.BUBBLE_IMPRESSION/, "duplicate guard should only apply to impressions");
assert.match(serverSource, /AND user_id = \?[\s\S]*AND message_id = \?/, "duplicate guard should key by user and message");
assert.match(serverSource, /duplicate: true/, "duplicate impressions should be reported as skipped duplicates");

assert.match(chatProductImpressionsSource, /reportedProductImpressionMessageIds = new Set\(\)/, "chat product impressions should keep page-session impression ids");
assert.match(chatProductImpressionsSource, /reportedProductImpressionMessageIds\.has\(payload\.messageId\)/, "chat product impressions should skip already reported product message impressions");
assert.match(chatProductImpressionsSource, /reportedProductImpressionMessageIds\.add\(payload\.messageId\)/, "chat product impressions should mark product message impressions before posting");

assert.match(dbSource, /cleanupDuplicateProductImpressions/, "database startup should clean duplicate historical impressions");
assert.match(dbSource, /ROW_NUMBER\(\) OVER[\s\S]*PARTITION BY user_id, message_id/, "duplicate cleanup should keep one impression per user and message");
assert.match(dbSource, /idx_product_analytics_event_user_message/, "database should add an index for event user message lookups");
assert.match(schemaSource, /idx_product_analytics_event_user_message/, "schema should include the event user message index");

console.log("product impression dedupe self-check passed");
