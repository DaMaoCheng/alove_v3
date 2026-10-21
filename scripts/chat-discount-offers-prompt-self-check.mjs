import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildChatReplyPrompt } from "../server/chat-prompt-service.js";

const character = {
  id: "char-1",
  name: "Mia",
  category: "creator",
  profile: {},
  tags: [],
};

const prompt = buildChatReplyPrompt({
  character,
  userText: "Do you have a discount?",
  discountOffersContext: {
    offers: [
      { id: "internal-1", code: "MIA20", offerDescription: "20% off selected kits", ownershipType: "creator", displayLabel: "Mia exclusive offer", endsAt: "2026-08-01T00:00:00.000Z" },
      { id: "internal-2", code: "MIA20", offerDescription: "duplicate", ownershipType: "creator" },
    ],
  },
});

assert.doesNotMatch(prompt.systemPrompt, /MIA20/, "verified discount code must not be exposed to model-authored prose");
assert.doesNotMatch(prompt.systemPrompt, /20% off selected kits/, "verified offer facts must not be exposed to model-authored prose");
assert.doesNotMatch(prompt.systemPrompt, /Mia exclusive offer|Label:/, "automatic ownership labels must not enter the model prompt");
assert.doesNotMatch(prompt.systemPrompt, /2026-08-01T00:00:00.000Z/, "verified expiry must remain backend-only");
assert.match(prompt.systemPrompt, /\[MENTION_DISCOUNT_OFFER\]/, "model should receive only the structured mention directive");
assert.doesNotMatch(prompt.systemPrompt, /internal-1|internal-2|creator_uid/, "internal offer identifiers must not enter the prompt");

const guestPrompt = buildChatReplyPrompt({ character, userText: "Do you have a discount?" });
assert.doesNotMatch(guestPrompt.systemPrompt, /MIA20|discountOffersContext/, "without backend eligibility context no concrete code may enter the prompt");
assert.doesNotMatch(guestPrompt.systemPrompt, /Discount Offers Context|no verified discount offer/i, "unqueried guest and proactive prompts should not pretend eligibility was checked");
const noOfferPrompt = buildChatReplyPrompt({ character, userText: "Do you have a discount?", discountOffersContext: { offers: [] } });
assert.match(noOfferPrompt.systemPrompt, /no verified discount offer/i, "formal evaluated no-offer prompt should explicitly prohibit unverified codes");

const orchestratorSource = readFileSync("server/chat-reply-orchestrator-service.js", "utf8");
const textReplySource = readFileSync("server/chat-text-message-service.js", "utf8");
const voiceReplySource = readFileSync("server/chat-voice-message-service.js", "utf8");
const callTurnSource = readFileSync("server/call-turn-service.js", "utf8");
const guestReplySource = readFileSync("server/guest-reply-service.js", "utf8");
const proactiveSource = readFileSync("server/proactive-message-context-service.js", "utf8");
assert.match(orchestratorSource, /resolveCharacterDiscountOffers\(db,/, "formal reply orchestrator should resolve backend offer eligibility");
assert.match(orchestratorSource, /enforceDiscountOfferReplyPolicy\(/, "formal reply orchestrator should enforce the output allowlist before persistence and TTS");
assert.match(
  orchestratorSource,
  /selectedProduct && !isAiTransportFallback\(replyResult\) \? normalizeProductFollowupReply/,
  "normal product follow-ups should be sanitized while a verified transport-timeout reply remains intact",
);
assert.match(
  orchestratorSource,
  /protectedLiterals: replyResult\.discountOfferReply === true[\s\S]*verifiedDiscountOffers[\s\S]*offer\.code, offer\.offerDescription/,
  "only backend-verified discount literals should be protected during product sanitization",
);
assert.match(textReplySource, /buildCharacterReplyGenerationForDb\(db,/, "formal text replies should reuse the common orchestrator");
assert.match(voiceReplySource, /buildCharacterReplyGenerationForDb\(db,/, "formal voice replies should reuse the common orchestrator");
assert.match(callTurnSource, /createUserReply\(/, "formal realtime call turns should reuse formal text reply generation");
assert.doesNotMatch(guestReplySource, /discountOffersContext/, "guest reply generation should not inject formal discount offers");
assert.doesNotMatch(proactiveSource, /discountOffersContext/, "proactive messages should not inject discount offers without a user request");

console.log("chat discount offers prompt self-check passed");
