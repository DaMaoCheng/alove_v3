import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const dbSource = readFileSync("server/db.js", "utf8");
const tableSource = readFileSync("server/db-bootstrap-chat-tables.js", "utf8");
const seedSource = readFileSync("server/db-bootstrap-seeds.js", "utf8");
const schemaSource = readFileSync("database/schema.sql", "utf8");
const routeSource = readFileSync("server/chat-routes.js", "utf8");
const serviceSource = readFileSync("server/chat-quick-reply-service.js", "utf8");
const frontendServiceSource = readFileSync("src/services/chat-quick-reply-service.js", "utf8");
const chatPageSource = readFileSync("src/features/chat/chat-page.js", "utf8");
const quickRepliesSource = readFileSync("src/features/chat/chat-quick-replies.js", "utf8");
const apiConfigSource = readFileSync("src/config/api-config.js", "utf8");

assert.match(schemaSource, /CREATE TABLE IF NOT EXISTS chat_quick_replies/, "schema should define chat quick replies table");
assert.match(dbSource, /createChatQuickRepliesTableIfMissing/, "database migrations should create quick replies table");
assert.match(dbSource, /seedDefaultChatQuickReplies/, "database migrations should seed quick replies");
assert.match(tableSource, /createChatQuickRepliesTableIfMissing/, "table bootstrap should create quick replies table");
assert.match(seedSource, /seedDefaultChatQuickReplies/, "seed bootstrap should seed quick replies");
assert.match(tableSource, /quick_reply_type VARCHAR\(32\) NOT NULL/, "quick replies should have deterministic daily/product type");

const dailySeeds = [...seedSource.matchAll(/'daily',\s*'([^']+)'/g)].map((match) => match[1]);
const productSeeds = [...seedSource.matchAll(/'product',\s*'([^']+)'/g)].map((match) => match[1]);
const quickReplyInsertBlock = seedSource.match(/INSERT INTO chat_quick_replies[\s\S]*?ON DUPLICATE KEY UPDATE/)?.[0] || "";
assert.equal(dailySeeds.length, 20, "should seed 20 daily quick replies");
assert.equal(productSeeds.length, 20, "should seed 20 product quick replies");

for (const text of [...dailySeeds, ...productSeeds]) {
  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
  assert.ok(wordCount >= 3 && wordCount <= 6, `quick reply should be 3-6 words: ${text}`);
}

assert.match(serviceSource, /ORDER BY RAND\(\)/, "service should use database random ordering for true refresh variation");
assert.match(serviceSource, /shuffleQuickReplies/, "creator and mascot quick replies should randomize final button order");
assert.match(serviceSource, /quick_reply_type = \?/, "service should query by reply type");
assert.match(serviceSource, /productTrigger: PRODUCT_TRIGGER_QUICK/, "product quick replies should carry product trigger");
assert.match(serviceSource, /categoryId === "creator" \|\| categoryId === "mascot"/, "creator and mascot should get product quick replies");
assert.match(serviceSource, /const PRODUCT_QUICK_REPLY_LIMIT = 3/, "product-capable chats should show three product quick replies");
assert.doesNotMatch(
  serviceSource,
  /PRODUCT_QUICK_REPLY_LIMIT\);\s*const dailyReplies = await listQuickRepliesByType/s,
  "product-capable quick replies should not mix a non-product daily quick reply"
);
assert.match(seedSource, /ON DUPLICATE KEY UPDATE\s+id = id/, "default quick reply seeds should preserve existing managed rows");
assert.match(seedSource, /UPDATE chat_quick_replies[\s\S]*text = 'Show me best sellers'[\s\S]*text = 'Show me black jerseys'/, "old system color quick reply should be migrated through a targeted safe update");
assert.doesNotMatch(quickReplyInsertBlock, /Show me black jerseys/, "color quick reply should not be seeded while color metadata is unreliable");
assert.doesNotMatch(schemaSource, /Show me black jerseys/, "schema quick reply seed should not include unreliable color prompts");
assert.doesNotMatch(quickRepliesSource, /Show me black jerseys/, "frontend fallback quick replies should not include unreliable color prompts");
assert.match(seedSource, /Show me best sellers/, "product quick reply seeds should include a sales-oriented replacement");
assert.match(quickRepliesSource, /Show me best sellers/, "frontend fallback product quick replies should include a sales-oriented replacement");

assert.ok(routeSource.includes("quickRepliesMatch") && routeSource.includes("/quick-replies"), "chat route should expose character quick replies endpoint");
assert.match(routeSource, /listQuickRepliesForCharacter/, "chat route should call quick reply service");

assert.match(apiConfigSource, /quickReplies:/, "API config should expose quick replies URL builder");
assert.match(frontendServiceSource, /fetchChatQuickReplies/, "frontend should have quick reply fetch service");
assert.match(frontendServiceSource, /cacheBust/, "frontend quick reply requests should avoid cached random results");
assert.match(frontendServiceSource, /\?_=\$\{encodeURIComponent\(cacheBust\)\}/, "frontend quick reply cache bust should use a standard query parameter");
assert.match(chatPageSource, /quickReplies = \[\]/, "chat page should accept quick replies");
assert.match(quickRepliesSource, /FALLBACK_DAILY_QUICK_REPLIES/, "quick reply module should keep visible daily fallback replies when API data is empty");
assert.match(quickRepliesSource, /FALLBACK_PRODUCT_QUICK_REPLIES/, "quick reply module should keep visible product fallback replies for product-capable characters");
assert.match(quickRepliesSource, /buildFallbackQuickReplies/, "quick reply module should render fallback replies instead of an empty quick row");
assert.match(quickRepliesSource, /fallbackQuickRepliesByCharacterId = new Map\(\)/, "fallback quick replies should be stable during one page session");
assert.match(quickRepliesSource, /getFallbackQuickRepliesForCharacter/, "quick reply module should reuse fallback replies between rerenders");
assert.match(quickRepliesSource, /sampleQuickReplies/, "fallback quick replies should also randomize when API data is empty");
assert.match(quickRepliesSource, /canUseProductQuickReplies/, "fallback quick replies should respect creator and mascot product rules");
assert.match(quickRepliesSource, /character\.category\?\.id/, "fallback product rules should read mapped character.category.id");
assert.match(chatPageSource, /renderQuickReplies/, "chat page should render quick replies from API data through the quick reply module");
assert.match(quickRepliesSource, /suggest-emoji/, "quick reply capsules should render decorative emoji");
assert.match(quickRepliesSource, /QUICK_REPLY_EMOJIS/, "quick reply decorative emoji should vary by capsule position");
assert.match(quickRepliesSource, /emoji = QUICK_REPLY_EMOJIS\[index % QUICK_REPLY_EMOJIS\.length\]/, "quick reply emoji should be stable but not identical for all capsules");
assert.match(quickRepliesSource, /data-quick="\$\{escapeAttribute\(text\)\}"/, "quick reply submit text should not include decorative emoji");
assert.match(quickRepliesSource, /data-product-trigger/, "quick reply module should preserve product trigger on quick buttons");

console.log("chat quick replies self-check passed");
