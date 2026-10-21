import assert from "node:assert/strict";
import { buildChatReplyPrompt } from "../server/chat-prompt-service.js";
import { buildKnowledgeContextLayer } from "../server/chat-prompt-layers.js";

const character = {
  id: "mascot_alba_spanish_20260909",
  name: "Alba",
  categoryId: "mascot",
  profile: { language: "Spanish" },
};

const prompt = buildChatReplyPrompt({
  character,
  userText: "¿Cuál es la promoción y me puedes pasar el enlace?",
});
const policy = prompt.layers.find((layer) => layer.id === "global_reply_policy")?.content || "";
assert.match(policy, /Never invent or guess promotions/i);
assert.match(policy, /Only reproduce a URL when the system explicitly supplies it as a verified link/i);
assert.match(policy, /Never claim to have checked, contacted, sent, escalated, scheduled/i);
assert.match(policy, /do not have a verified answer here/i);

const knowledge = buildKnowledgeContextLayer({
  customerServiceIntent: true,
  items: [{ title: "Shipping", content: "Standard shipping takes 15-30 days." }],
});
assert.match(knowledge.content, /do not have a verified answer here/i);
assert.match(knowledge.content, /Use URLs only when they appear in the supplied reference/i);

console.log("chat-fact-boundary-self-check: PASS");
