import assert from "node:assert/strict";
import { closeDbPool, initializeDatabase } from "../server/db.js";
import { retrieveKnowledgeSections } from "../server/knowledge-retrieval-service.js";
import { buildChatReplyPrompt } from "../server/chat-prompt-service.js";

const POLICIES = [
  {
    id: "kb_site_tms_shipping_policy",
    siteId: "site_76b7e019-e2a2-45ab-aa57-082a67c35b28",
    query: "Mikor érkezik meg a csomagom?",
    promptMarker: "TMS delivers only to addresses within Hungary.",
  },
  {
    id: "kb_site_tkf_shipping_policy",
    siteId: "site_51a1059d-86dd-4702-8e6f-3d050731b6ea",
    query: "Kargom ne zaman gelir?",
    promptMarker: "TKF delivers only to addresses within Türkiye.",
  },
  {
    id: "kb_site_mtt_shipping_policy",
    siteId: "site_faced451-b700-4f68-bac0-579b0d97079c",
    query: "Quel est le délai de livraison de ma commande ?",
    promptMarker: "MTT currently delivers orders only within Morocco.",
  },
];

await initializeDatabase();
try {
  for (const policy of POLICIES) {
    const character = { id: `shipping_policy_check_${policy.id}`, site_id: policy.siteId, category_id: "mascot", name: "Shipping check" };
    const result = await retrieveKnowledgeSections({ query: policy.query, character, limit: 4 });
    const resultIds = [...new Set(result.items.map((item) => item.knowledgeBaseId))];
    assert.equal(result.customerServiceTopic, "delivery", `${policy.id} query must use delivery routing`);
    assert.deepEqual(resultIds, [policy.id], `${policy.id} must be the only policy returned for its own site`);

    const prompt = buildChatReplyPrompt({ character, userText: policy.query, knowledgeContext: result });
    assert.match(prompt.systemPrompt, new RegExp(escapeRegExp(policy.promptMarker)), `${policy.id} content must enter the chat prompt`);
    for (const other of POLICIES) {
      if (other.id !== policy.id) assert(!resultIds.includes(other.id), `${policy.id} must not expose ${other.id}`);
    }
    assert(!resultIds.includes("kb_site_fkk_shipping_policy"), `${policy.id} must not expose FKK shipping policy`);
  }
  console.log("site shipping policy knowledge self-check passed");
} finally {
  await closeDbPool();
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
