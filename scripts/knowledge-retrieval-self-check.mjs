import assert from "node:assert/strict";
import { closeDbPool, initializeDatabase } from "../server/db.js";
import { KNOWLEDGE_RETRIEVAL_CONFIG } from "../server/knowledge-retrieval-config.js";
import { retrieveKnowledgeSections } from "../server/knowledge-retrieval-service.js";

await initializeDatabase();
try {
  assert.equal(KNOWLEDGE_RETRIEVAL_CONFIG.finalReferenceLimit, 6, "final reference limit should be fixed at 6");

  const size = await retrieveKnowledgeSections({ query: "球员版会不会偏紧，尺码怎么选" });
  assert(size.items.length > 0, "size query should return results");
  assert(size.items.length <= KNOWLEDGE_RETRIEVAL_CONFIG.finalReferenceLimit, "size query exceeds fixed limit");
  assert(size.items.some((item) => item.knowledgeBaseId === "kb_customer_service"), "size query should hit customer service KB");

  const authenticity = await retrieveKnowledgeSections({ query: "the jersey is authentic or fake?" });
  assert.equal(authenticity.customerServiceIntent, true, "English authenticity questions should enter the customer-service route");
  assert.equal(authenticity.customerServiceTopic, "authenticity", "authenticity questions should select the authenticity topic");
  assert(authenticity.items.some((item) => item.knowledgeBaseId === "kb_customer_service"), "authenticity questions should retrieve customer-service references");
  assert.match(authenticity.items[0]?.title || "", /敏感场景|authentic|counterfeit|仿品|正品|假冒/i, "the most specific authenticity reference should rank first");
  assert(authenticity.items.every((item) => !item.reasons.some((reason) => /title:(?:the|is|or)/.test(reason))), "English stop words must not create knowledge matches");

  const hungarianDelivery = await retrieveKnowledgeSections({ query: "Mennyi idő mire megérkezik a rendelésem?" });
  assert.equal(hungarianDelivery.customerServiceIntent, true, "Hungarian delivery timing questions should enter the customer-service route");
  assert.equal(hungarianDelivery.customerServiceTopic, "delivery", "Hungarian delivery timing questions should select the delivery topic");

  const stopWordsOnly = await retrieveKnowledgeSections({ query: "the is or" });
  assert.equal(stopWordsOnly.items.length, 0, "English stop words alone must not trigger unrelated knowledge");

  const worldCup = await retrieveKnowledgeSections({ query: "2026 世界杯 48 队赛制怎么晋级" });
  assert(worldCup.items.length > 0, "world cup query should return results");
  assert(worldCup.items.length <= KNOWLEDGE_RETRIEVAL_CONFIG.finalReferenceLimit, "world cup query exceeds fixed limit");
  assert(worldCup.items.some((item) => item.knowledgeBaseId === "kb_football"), "world cup query should hit football KB");

  const tactics = await retrieveKnowledgeSections({ query: "什么是内收边后卫和 xG PPDA" });
  assert(tactics.items.some((item) => /战术|数据|内收|xg|ppda/i.test(`${item.title} ${item.summary} ${item.content}`)), "tactics query should hit tactics/data content");

  const ids = new Set(tactics.items.map((item) => item.id));
  assert.equal(ids.size, tactics.items.length, "retrieval should not repeat the same section");

  console.log("knowledge retrieval self-check passed");
} finally {
  await closeDbPool();
}
