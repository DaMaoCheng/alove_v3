import assert from "node:assert/strict";
import { buildChatReplyPrompt } from "../server/chat-prompt-service.js";
import { buildProactivePrompt } from "../server/proactive-message-context-service.js";

const prompt = buildChatReplyPrompt({
  character: {
    id: "style_check_character",
    name: "Style Check",
    profile_json: JSON.stringify({ language: "English" }),
    persona_prompt: "Warm football fan.",
    speaking_style: "Direct and friendly.",
  },
  recentMessages: [
    { senderType: "user", text: "I lost a match today and feel bad." },
  ],
  userText: "not sure what to do",
});

assert.match(
  prompt.systemPrompt,
  /when it fits the context/i,
  "chat prompt should make emotional and question phrasing context-dependent"
);
assert.match(
  prompt.systemPrompt,
  /everyday conversation/i,
  "chat prompt should prefer everyday conversation over polished copy"
);
assert.match(
  prompt.systemPrompt,
  /Small informal wording is fine/i,
  "chat prompt should allow natural informal wording instead of over-polished grammar"
);
assert.match(
  prompt.systemPrompt,
  /current intent and any supported emotional cues from the latest message and recent chat/i,
  "chat prompt should consider supported emotional cues in current context"
);
assert.match(
  prompt.systemPrompt,
  /do not assume distress or add reassurance to an ordinary practical question/i,
  "chat prompt should avoid imposing an emotional response on practical requests"
);
assert.match(
  prompt.systemPrompt,
  /do not celebrate, hype, tease, sell, or joke past the feeling/i,
  "chat prompt should avoid positive or salesy mismatch when the user is upset"
);
assert.match(
  prompt.systemPrompt,
  /stacked adjectives, slogan-like phrasing/i,
  "chat prompt should avoid slogan-like glued clauses"
);
assert.match(
  prompt.systemPrompt,
  /questions, rhetorical questions/i,
  "chat prompt should allow questions and rhetorical questions"
);
assert.match(
  prompt.systemPrompt,
  /emotion words or exclamation marks/i,
  "chat prompt should allow emotion words and exclamation marks"
);
assert.match(
  prompt.systemPrompt,
  /Ask about the user's situation/i,
  "chat prompt should allow proactive context questions"
);
assert.match(
  prompt.systemPrompt,
  /Never use a forced either-or question in a casual or proactive follow-up/i,
  "chat prompt should avoid assuming two user intentions in casual follow-ups"
);
assert.match(
  prompt.systemPrompt,
  /This rule overrides the preference to use questions or rhetorical questions/i,
  "forced either-or prevention should take priority over the general question preference"
);
assert.match(
  prompt.systemPrompt,
  /Use an either-or question only when choosing between options is necessary/i,
  "chat prompt should preserve necessary clarification choices"
);
assert.equal(
  prompt.layers.find((layer) => layer.id === "global_reply_policy")?.title,
  "Global Reply Policy",
  "chat prompt should keep global reply policy separate from character layers"
);
assert.match(
  prompt.systemPrompt,
  /react emotionally to what the user shares/i,
  "chat prompt should allow emotional reactions to user context"
);
assert.match(
  prompt.systemPrompt,
  /roughly 12 to 55 words/i,
  "chat prompt should include a soft default word range for normal role replies"
);

const proactivePrompt = buildProactivePrompt({
  character: { id: "style_check_character", name: "Style Check" },
  recentMessages: [],
  userContext: null,
  reason: "self_check",
});

assert.equal(
  proactivePrompt.layers.find((layer) => layer.id === "global_reply_policy")?.title,
  "Global Reply Policy",
  "proactive messages should reuse the global reply policy"
);

console.log("chat response style self-check passed");
