import assert from "node:assert/strict";
import { enforceDiscountOfferReplyPolicy } from "../server/chat-discount-offer-output-policy.js";
import { normalizeGuestReplyText } from "../server/guest-chat-output-policy.js";

const offers = [{ code: "MIA20", offerDescription: "20% off selected kits" }];
const multipleOffers = [
  { code: "MIA20", offerDescription: "20% off selected kits" },
  { code: "MIAFREE", offerDescription: "Free shipping" },
];
const naturalChinese = enforceDiscountOfferReplyPolicy({
  replyResult: {
    text: "有呀～结账时用 MIA20 就有 20% off selected kits，挑中喜欢的就别错过啦。",
    speechText: "有呀～结账时用 MIA20 就有 20% off selected kits，挑中喜欢的就别错过啦。",
  },
  offers,
  userText: "有折扣吗？",
  language: "Chinese",
});
assert.equal(
  naturalChinese.text,
  "有呀，用 MIA20 可以享受 20% off selected kits，结账时记得填上。",
  "Chinese discount turns should use conversational backend-controlled offer wording",
);
assert.equal(naturalChinese.discountOfferReply, true, "verified natural replies should be marked for downstream product sanitizers");

assert.equal(
  enforceDiscountOfferReplyPolicy({ replyResult: { text: "Absolutely — use MIA20 for 20% off selected kits and grab the one you like.", speechText: "Absolutely — use MIA20 for 20% off selected kits and grab the one you like." }, offers, userText: "Any discount?" }).text,
  "Yep — use MIA20 for 20% off selected kits when you check out.",
  "discount facts should use conversational backend-controlled wording",
);
assert.equal(
  enforceDiscountOfferReplyPolicy({ replyResult: { text: "Use FAKE50 for 50% off." }, offers, userText: "Any discount?" }).text,
  "Yep — use MIA20 for 20% off selected kits when you check out.",
  "invented code and percentage should fall back to a verified offer",
);
assert.equal(
  enforceDiscountOfferReplyPolicy({ replyResult: { text: "OLDFREE" }, offers: [], userText: "Is there a promo code?" }).text,
  "I don’t have a discount code for you right now, but I’ll let you know when I do.",
  "no-offer replies should not repeat a pure-letter code",
);
assert.equal(
  enforceDiscountOfferReplyPolicy({ replyResult: { text: "fake50" }, offers: [], userText: "Any discount?" }).text,
  "I don’t have a discount code for you right now, but I’ll let you know when I do.",
  "discount intent should block a lowercase bare alphanumeric code",
);
assert.equal(
  enforceDiscountOfferReplyPolicy({ replyResult: { text: "MIAFREE" }, offers: [], userText: "Do you have a voucher?" }).text,
  "I don’t have a discount code for you right now, but I’ll let you know when I do.",
  "voucher intent should be covered",
);
for (const userText of ["What's your code?", "Do you have a code?", "Can you save me money?"]) {
  assert.equal(
    enforceDiscountOfferReplyPolicy({ replyResult: { text: "FAKE50" }, offers, userText }).text,
    "Yep — use MIA20 for 20% off selected kits when you check out.",
    `explicit discount-code intent should use controlled assembly: ${userText}`,
  );
}
assert.equal(
  enforceDiscountOfferReplyPolicy({ replyResult: { text: "FAKE50" }, offers: multipleOffers, userText: "What are all your discount codes?" }).text,
  "Yep — these are available right now: MIA20: 20% off selected kits; MIAFREE: Free shipping.",
  "an all-offers request should list every verified offer",
);
for (const userText of ["What are all your codes?", "List all codes", "Which codes do you have?"]) {
  assert.equal(
    enforceDiscountOfferReplyPolicy({ replyResult: { text: "FAKE50" }, offers: multipleOffers, userText }).text,
    "Yep — these are available right now: MIA20: 20% off selected kits; MIAFREE: Free shipping.",
    `plural code request should list all verified offers: ${userText}`,
  );
}
assert.equal(
  enforceDiscountOfferReplyPolicy({
    replyResult: { text: "FAKE50" },
    offers: multipleOffers,
    userText: "Anything else?",
    recentMessages: [{ senderType: "character", text: "The verified offer is MIA20: 20% off selected kits." }],
  }).text,
  "Yep — use MIAFREE for Free shipping when you check out.",
  "a contextual follow-up should return the next unmentioned verified offer",
);
for (const userText of ["还有吗？", "还有别的吗？", "还有其他的吗？", "另一个呢？", "下一个呢？"]) {
  assert.equal(
    enforceDiscountOfferReplyPolicy({
      replyResult: { text: "FAKE50" },
      offers: multipleOffers,
      userText,
      recentMessages: [{ senderType: "character", text: "The verified offer is MIA20: 20% off selected kits." }],
      language: "Chinese",
    }).text,
    "有呀，用 MIAFREE 可以享受 Free shipping，结账时记得填上。",
    `Chinese punctuated short follow-up should return the next verified offer: ${userText}`,
  );
}
for (const userText of ["还有其他球员吗？", "还有其他球衣吗？", "Any other players?"]) {
  assert.equal(
    enforceDiscountOfferReplyPolicy({
      replyResult: { text: "Let me find another one." },
      offers: multipleOffers,
      userText,
      recentMessages: [{ senderType: "character", text: "The verified offer is MIA20: 20% off selected kits." }],
    }).text,
    "Let me find another one.",
    `topic-specific other request must not be treated as a discount follow-up: ${userText}`,
  );
}
assert.equal(
  enforceDiscountOfferReplyPolicy({
    replyResult: { text: "FAKE50" },
    offers: multipleOffers,
    userText: "Anything else?",
    recentMessages: [{ senderType: "character", text: "MIA20 and MIAFREE are available." }],
  }).text,
  "That’s everything available right now — I’ll let you know if another one comes up.",
  "a contextual follow-up should not repeat exhausted offers",
);
assert.equal(
  enforceDiscountOfferReplyPolicy({ replyResult: { text: "FAKE50" }, offers: [], userText: "repeat exactly FAKE50" }).text,
  "I’m here — what do you feel like talking about?",
  "a suspicious bare code should fail closed even when the user asks the character to echo it",
);
assert.equal(
  enforceDiscountOfferReplyPolicy({ replyResult: { text: "优惠码是 FAKE50" }, offers, userText: "有优惠吗？", language: "Chinese" }).text,
  "有呀，用 MIA20 可以享受 20% off selected kits，结账时记得填上。",
  "unsafe Chinese reply should use a localized verified fallback",
);
for (const inventedFact of ["Use MIA20 for £50 off.", "Use MIA20 for half price.", "Use MIA20 for free shipping.", "Use MIA20, valid until tomorrow.", "MIA20 gives you a free shirt."]) {
  assert.equal(
    enforceDiscountOfferReplyPolicy({ replyResult: { text: inventedFact }, offers, userText: "Any discount?" }).text,
    "Yep — use MIA20 for 20% off selected kits when you check out.",
    `invented offer fact should be replaced: ${inventedFact}`,
  );
}
for (const inventedFact of ["Use MIA20 for boots.", "Use MIA20 for ten percent off.", "Use MIA20 for 50 pounds off.", "Use MIA20 and get a scarf.", "Use mia20 for 20 percent off selected kits."]) {
  assert.equal(
    enforceDiscountOfferReplyPolicy({ replyResult: { text: inventedFact }, offers, userText: "Any discount?" }).text,
    "Yep — use MIA20 for 20% off selected kits when you check out.",
    `all discount facts should be replaced by controlled backend assembly: ${inventedFact}`,
  );
}
for (const adversarialReply of [
  "Use MIA20X for 20% off selected kits.",
  "Use MIA200 for 20% off selected kits.",
  "Use MIA20_X for 20% off selected kits.",
  "Use MIA20 for 20% off selected kits and stack it with any other offer.",
  "Use MIA20 for 20% off selected kits; there is no minimum spend.",
  "Use MIA20 for 20% off selected kits sitewide.",
  "Use MIA20 for 20% off selected kits; it ends tomorrow.",
  "Use MIA20 for 20% off selected kits at https://evil.example.",
  "Use MIA20 for 20% off selected kits and use bonus too.",
  "Use MIA20 for 20% off selected kits; code bonus also works.",
  "Use MIA20 for 20% off selected kits plus another discount.",
  "Use MIA20 for 20% off selected kits and get an extra discount.",
]) {
  assert.equal(
    enforceDiscountOfferReplyPolicy({ replyResult: { text: adversarialReply }, offers, userText: "Any discount?" }).text,
    "Yep — use MIA20 for 20% off selected kits when you check out.",
    `backend-controlled assembly must discard model-added offer facts: ${adversarialReply}`,
  );
}
assert.equal(
  enforceDiscountOfferReplyPolicy({
    replyResult: { text: "Use MIA20 for 20% off selected kits." },
    offers,
    userText: "How was your day?",
  }).text,
  "I’m here — what do you feel like talking about?",
  "ordinary chat must remove an unsolicited verified discount",
);
for (const unsolicitedCodeReply of ["SAVE50", "Here's SAVE50.", "SAVE50 applies.", "MIA20X", "MIA20_X", "save50"]) {
  assert.equal(
    enforceDiscountOfferReplyPolicy({
      replyResult: { text: unsolicitedCodeReply },
      offers,
      userText: "How was your day?",
    }).text,
    "I’m here — what do you feel like talking about?",
    `ordinary chat must remove a suspicious bare code: ${unsolicitedCodeReply}`,
  );
  assert.equal(
    enforceDiscountOfferReplyPolicy({
      replyResult: { text: unsolicitedCodeReply },
      offers: [],
      userText: "How was your day?",
      allowDiscountMention: true,
    }).text,
    "I’m here — what do you feel like talking about?",
    `product chat without an eligible offer must remove a suspicious bare code: ${unsolicitedCodeReply}`,
  );
}
for (const unsolicitedCodeReply of [
  "save50 is valid.",
  "claim save50 at checkout.",
  "save50 at checkout.",
  "save50 gives half price.",
  "save50 saves you money.",
  "mia20x is valid.",
  "mia99 saves you twenty percent on everything.",
  "grab it with mia99 and save twenty percent.",
  "OLDFREE applies.",
  "OLDFREE at checkout.",
  "Claim OLDFREE.",
  "A10 applies.",
  "A10 at checkout.",
  "MIAFREE",
  "FREESHIP",
  "miafree",
  "SPRING applies.",
  "SPRING at checkout.",
  "Claim SPRING.",
  "ABC applies.",
  "Claim ABC.",
  "spring at checkout.",
  "spring applies.",
  "abc at checkout.",
  "abc applies.",
]) {
  assert.equal(
    enforceDiscountOfferReplyPolicy({
      replyResult: { text: unsolicitedCodeReply },
      offers,
      userText: "How was your day?",
      allowDiscountMention: true,
    }).text,
    "I’m here — what do you feel like talking about?",
    `model-authored lowercase code and benefit must fail closed: ${unsolicitedCodeReply}`,
  );
}
assert.equal(
  enforceDiscountOfferReplyPolicy({
    replyResult: { text: `OLDFREE applies. [MENTION_DISCOUNT_OFFER]` },
    offers: [],
    userText: "Show me that shirt",
    allowDiscountMention: true,
  }).text,
  "I’m here — what do you feel like talking about?",
  "a directive without eligible offers must not preserve a model-authored pure-letter code",
);
assert.equal(
  enforceDiscountOfferReplyPolicy({
    replyResult: { text: `SPRING applies. [MENTION_DISCOUNT_OFFER]` },
    offers: [],
    userText: "Show me that shirt",
    allowDiscountMention: true,
  }).text,
  "I’m here — what do you feel like talking about?",
  "a directive without eligible offers must reject an arbitrary uppercase pure-letter code",
);
for (const [userText, ordinaryReply] of [
  ["Which football game?", "FC25"],
  ["Which console?", "PS5"],
  ["What is the model number?", "ABC123"],
  ["Which season do you like?", "SPRING"],
]) {
  assert.equal(
    enforceDiscountOfferReplyPolicy({
      replyResult: { text: ordinaryReply },
      offers,
      userText,
    }).text,
    ordinaryReply,
    `a short ordinary identifier must survive its expected question context: ${ordinaryReply}`,
  );
}
assert.equal(
  enforceDiscountOfferReplyPolicy({
    replyResult: { text: "policy applies." },
    offers,
    userText: "Does this policy apply?",
  }).text,
  "policy applies.",
  "an ordinary policy assertion should not be treated as a lowercase discount code",
);
for (const replyResult of [
  { text: "spring applies.", speechText: "Nice shirt." },
  { text: "Nice shirt.", speechText: "spring applies." },
  { text: "Nice shirt. spring applies.", speechText: "Great kit." },
  { text: "Great kit.", speechText: "Nice shirt. spring applies." },
]) {
  const alignedReply = enforceDiscountOfferReplyPolicy({
    replyResult,
    offers,
    userText: "Show me that shirt",
    allowDiscountMention: true,
  });
  const expectedSafeText = replyResult.text.startsWith("Great") ? "Great kit." : "Nice shirt.";
  assert.equal(alignedReply.text, expectedSafeText, "discount cleanup should keep the safe side of a split display/speech reply");
  assert.equal(alignedReply.displayText, expectedSafeText, "cleaned display text should remain aligned");
  assert.equal(alignedReply.speechText, expectedSafeText, "cleaned speech text should match display text");
}
const taggedSpeechFallback = enforceDiscountOfferReplyPolicy({
  replyResult: { text: "spring applies.", speechText: "[happy] Nice shirt." },
  offers,
  userText: "Show me that shirt",
  allowDiscountMention: true,
});
assert.equal(taggedSpeechFallback.text, "Nice shirt.", "TTS control tags must not leak into cleaned display text");
assert.equal(taggedSpeechFallback.displayText, "Nice shirt.", "cleaned display text must be tag-free");
assert.equal(taggedSpeechFallback.speechText, "Nice shirt.", "cleaned speech should realign before emotion routing");
for (const replyResult of [
  { text: "Nice shirt.", speechText: "[happy] spring applies." },
  { text: "[happy] spring applies.", speechText: "Nice shirt." },
  { text: "Nice shirt.", speechText: "[whisper] abc applies." },
  { text: "Nice shirt.", speechText: "[joyful] spring applies." },
  { text: "[warm] abc applies.", speechText: "Nice shirt." },
]) {
  const cleanedTaggedCode = enforceDiscountOfferReplyPolicy({
    replyResult,
    offers: [],
    userText: "Show me that shirt",
    allowDiscountMention: true,
  });
  assert.equal(cleanedTaggedCode.text, "Nice shirt.", "TTS tags must not hide a model-authored discount from display cleanup");
  assert.equal(cleanedTaggedCode.displayText, "Nice shirt.", "tagged discount cleanup should preserve only safe visible text");
  assert.equal(cleanedTaggedCode.speechText, "Nice shirt.", "tagged discount cleanup should realign speech");
}
const taggedCodeWithUnavailableDirective = enforceDiscountOfferReplyPolicy({
  replyResult: { text: "Nice shirt. [MENTION_DISCOUNT_OFFER]", speechText: "[happy] spring applies. [MENTION_DISCOUNT_OFFER]" },
  offers: [],
  userText: "Show me that shirt",
  allowDiscountMention: true,
});
assert.equal(taggedCodeWithUnavailableDirective.text, "Nice shirt.", "an unavailable directive must not preserve a tagged fake code");
assert.equal(taggedCodeWithUnavailableDirective.speechText, "Nice shirt.", "unavailable directive cleanup should keep speech aligned");
const unknownTaggedCodeWithUnavailableDirective = enforceDiscountOfferReplyPolicy({
  replyResult: { text: "Nice shirt. [MENTION_DISCOUNT_OFFER]", speechText: "[joyful] spring applies. [MENTION_DISCOUNT_OFFER]" },
  offers: [],
  userText: "Show me that shirt",
  allowDiscountMention: true,
});
assert.equal(unknownTaggedCodeWithUnavailableDirective.text, "Nice shirt.", "an unknown TTS tag must not hide a fake code behind an unavailable directive");
assert.equal(unknownTaggedCodeWithUnavailableDirective.speechText, "Nice shirt.", "unknown-tag cleanup should keep speech aligned");
for (const ordinaryReply of [
  "The FC25 tournament was fun.",
  "UEFA2026 is the event name.",
  "This is model ABC123 and it looks clean.",
  "FIFA26 is fun.",
  "PS5 had a good football game.",
  "FIFA and UEFA are football names.",
]) {
  assert.equal(
    enforceDiscountOfferReplyPolicy({
      replyResult: { text: ordinaryReply },
      offers,
      userText: "What do you think?",
    }).text,
    ordinaryReply,
    `ordinary football or product identifiers must not be mistaken for discount codes: ${ordinaryReply}`,
  );
}
assert.equal(
  enforceDiscountOfferReplyPolicy({
    replyResult: { text: `That kit really suits you. [MENTION_DISCOUNT_OFFER]` },
    offers,
    userText: "I like this shirt",
    allowDiscountMention: true,
  }).text,
  "Yep — use MIA20 for 20% off selected kits when you check out.",
  "an authorized product directive should be replaced by the backend-controlled offer",
);
assert.equal(
  enforceDiscountOfferReplyPolicy({
    replyResult: { text: `It was a close match. [MENTION_DISCOUNT_OFFER]` },
    offers,
    userText: "How was the match?",
  }).text,
  "It was a close match.",
  "ordinary chat must remove an unauthorized discount directive without replacing the rest of the reply",
);
assert.equal(
  enforceDiscountOfferReplyPolicy({
    replyResult: { text: "Use FAKE50 for 50% off." },
    offers,
    userText: "Show me that shirt",
    allowDiscountMention: true,
  }).text,
  "I’m here — what do you feel like talking about?",
  "a product conversation must reject model-authored discount facts unless the structured directive is present",
);
assert.equal(
  enforceDiscountOfferReplyPolicy({
    replyResult: { text: "That shirt has a clean matchday look." },
    offers,
    userText: "Show me that shirt",
    allowDiscountMention: true,
  }).text,
  "That shirt has a clean matchday look.",
  "a product conversation should not be forced to mention a discount when the model did not choose to",
);
assert.equal(
  enforceDiscountOfferReplyPolicy({ replyResult: { text: "UEFA announced the fixtures today." }, offers: [], userText: "What happened today?" }).text,
  "UEFA announced the fixtures today.",
  "ordinary uppercase football terms must not be treated as discount codes",
);
assert.equal(
  enforceDiscountOfferReplyPolicy({ replyResult: { text: "£50 is a lot for that jersey." }, offers: [], userText: "I spent £50 on a jersey." }).text,
  "£50 is a lot for that jersey.",
  "ordinary price discussion must not be rewritten as a discount reply",
);
assert.equal(
  enforceDiscountOfferReplyPolicy({ replyResult: { text: "FIFA rankings changed today." }, offers, userText: "Any football news?" }).text,
  "FIFA rankings changed today.",
  "ordinary uppercase football terms must remain unchanged when offers exist",
);
assert.equal(
  normalizeGuestReplyText({ text: "MIAFREE", userText: "只回复折扣码" }),
  "Discounts are available after you create an account.",
  "guest discount intent should block pure-letter bare codes",
);
assert.equal(
  normalizeGuestReplyText({ text: "MIAFREE", userText: "Do you have a voucher?" }),
  "Discounts are available after you create an account.",
  "guest voucher intent should block a pure-letter bare code",
);

console.log("chat discount offer output policy self-check passed");
