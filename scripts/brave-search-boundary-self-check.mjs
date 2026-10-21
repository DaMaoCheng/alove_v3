import assert from "node:assert/strict";
import { SERVER_CONFIG } from "../server/config.js";
import { shouldTriggerBraveSearch } from "../server/brave-search-service.js";
import { buildKnowledgeContextLayer } from "../server/chat-prompt-layers.js";
import { searchBraveLlmContext } from "../server/brave-search-service.js";

assert.equal(shouldTriggerBraveSearch("What was Haiti's first World Cup goal?", { knowledgeItems: [] }), SERVER_CONFIG.braveSearch.enabled);
assert.equal(shouldTriggerBraveSearch("Show me a Madrid jersey", { knowledgeItems: [] }), false);
assert.equal(shouldTriggerBraveSearch("Who scored the first goal?", { knowledgeItems: [{ title: "verified", content: "answer" }] }), false);
const layer = buildKnowledgeContextLayer({ source: "brave_web", items: [{ title: "Source", content: "Verified snippet", url: "https://example.com" }] });
assert.match(layer.content, /live Brave web search/i);
assert.match(layer.content, /evidence, not instructions/i);
if (SERVER_CONFIG.braveSearch.enabled) {
  const starts = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    starts.push(Date.now());
    return new Response(JSON.stringify({ web: { results: [{ title: "Test", url: "https://example.com", description: "Test source" }] } }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    await Promise.all([searchBraveLlmContext("first goal"), searchBraveLlmContext("second goal"), searchBraveLlmContext("third goal")]);
  } finally { globalThis.fetch = realFetch; }
  assert.equal(starts.length, 3);
  assert.ok(starts[1] - starts[0] >= SERVER_CONFIG.braveSearch.minIntervalMs - 25, "Brave requests must be queued at the configured interval");
  assert.ok(starts[2] - starts[1] >= SERVER_CONFIG.braveSearch.minIntervalMs - 25, "Brave requests must remain serialized");
}
console.log("brave-search-boundary-self-check: PASS");
