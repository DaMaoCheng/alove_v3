import assert from "node:assert/strict";
import {
  buildProductSearchIntent,
  buildRecentProductContext,
} from "../server/product-intent-service.js";
import {
  MAX_PRODUCT_CLARIFICATION_ATTEMPTS,
  PRODUCT_CLARIFICATION_SOURCE_MARKER,
  resolveProductSearchState,
} from "../server/product-search-decision-service.js";
import { buildProductContextLayer } from "../server/chat-prompt-layers.js";
import {
  applyGuestProductClarificationPromptPolicy,
  normalizeGuestReplyText,
} from "../server/guest-chat-output-policy.js";

assert.equal(MAX_PRODUCT_CLARIFICATION_ATTEMPTS, 2);

const vague = buildProductSearchIntent("Do you have any kits?", "", {
  recentProductContext: { clarificationCount: 0 },
});
assert.equal(vague.searchState, "needs_clarification");
assert.equal(resolveProductSearchState(vague, []).status, "needs_clarification");

const oneClarification = buildRecentProductContext([
  { sender_type: "user", content_type: "text", text_content: "Do you have any kits?" },
  { sender_type: "character", content_type: "text", source_ref: `ai:${PRODUCT_CLARIFICATION_SOURCE_MARKER}`, text_content: "Which team?" },
  { sender_type: "user", content_type: "text", text_content: "Any kits" },
]);
assert.equal(oneClarification.clarificationCount, 1);
const stillVague = buildProductSearchIntent("Any kits", "", { recentProductContext: oneClarification });
assert.equal(stillVague.searchState, "needs_clarification");

const twoClarifications = buildRecentProductContext([
  ...[
    { sender_type: "user", content_type: "text", text_content: "Do you have any kits?" },
    { sender_type: "character", content_type: "text", source_ref: `ai:${PRODUCT_CLARIFICATION_SOURCE_MARKER}`, text_content: "Which team?" },
    { sender_type: "user", content_type: "text", text_content: "Any kits" },
    { sender_type: "character", content_type: "text", source_ref: `ai:${PRODUCT_CLARIFICATION_SOURCE_MARKER}`, text_content: "Which style?" },
  ],
]);
assert.equal(twoClarifications.clarificationCount, 2);
const exhausted = buildProductSearchIntent("Any kits", "", { recentProductContext: twoClarifications });
assert.equal(exhausted.searchState, "clarification_exhausted");
assert.equal(resolveProductSearchState(exhausted, []).status, "clarification_exhausted");

const completeAfterClarification = buildProductSearchIntent("England shirt", "", {
  recentProductContext: twoClarifications,
});
assert.equal(completeAfterClarification.searchState, "ready_to_search", "a complete answer must stop clarification immediately");

const prompt = buildProductContextLayer({ id: "mascot_template", categoryId: "mascot" }, {
  searchOutcome: "clarification_exhausted",
  searchIntent: exhausted,
  products: [],
}, "Any kits");
assert.match(prompt.content, /after two clarification attempts/i);
assert.match(prompt.content, /Do not ask another product question/i);

const guestPrompt = applyGuestProductClarificationPromptPolicy({ systemPrompt: "base", layers: [] }, {
  productRequested: true,
  product: null,
  searchIntent: exhausted,
});
assert.match(guestPrompt.systemPrompt, /guest_product_clarification_exhausted:TONE/);
assert.match(
  normalizeGuestReplyText({
    text: "[guest_product_clarification_exhausted:direct]",
    productRequested: true,
    productSearchIntent: exhausted,
    userText: "Any kits",
    languageCode: "en",
  }),
  /Search page/i,
);

console.log("product clarification flow self-check passed");
