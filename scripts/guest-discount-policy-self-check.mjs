import assert from "node:assert/strict";
import { normalizeGuestReplyText, sanitizeGuestReplyText } from "../server/guest-chat-output-policy.js";
import { enforceDiscountOfferReplyPolicy } from "../server/chat-discount-offer-output-policy.js";

const notice = "Discounts are available after you create an account.";
const userText = "Can your business team explain bulk discount terms?";
const productSearchIntent = {
  commerceRoute: "store_policy", knowledgeScope: "business", answerRequired: true,
  discountExplanationRequired: true, discountExplanationEvidence: "bulk discount terms",
};
let checks = 0;
const safeReplies = [
  "Bulk discounts need confirmation by the business team. Please provide the quantity; I cannot promise a discount or coupon code.",
  "Coupon code eligibility requires confirmation; no code can be promised here.",
  "I can't promise 5% off. The business team needs to confirm the terms.",
  "I cannot guarantee a discount of 5.5% off.",
  "A 5% discount is not guaranteed.",
  "Loyalty rewards and member-only benefits depend on the applicable account policy; I cannot promise eligibility.",
  "Los descuentos por volumen requieren confirmación del equipo comercial; no puedo garantizar un descuento.",
  "No podemos garantizar 5% de descuento.",
  "批量优惠需要商务团队确认，我无法保证5%的折扣，也不能承诺优惠码。",
  "At the moment I can only see 2XXL in that listing.",
  "You can get information about the policy from the business team.",
  "Your discount is not guaranteed; terms require confirmation.",
];
for (const text of safeReplies) {
  assert.equal(sanitizeGuestReplyText(text, { userText, productSearchIntent }), text); checks++;
  assert.equal(normalizeGuestReplyText({ text, userText, productSearchIntent }), text); checks++;
}

// Numeric quantities are not coupon offers, even when classification wrongly
// flags a logistics/specification request as a discount-policy explanation.
const logisticsUser = "Explain the shipping policy";
const wronglyFlaggedPolicy = { ...productSearchIntent, discountExplanationEvidence: logisticsUser };
for (const text of [
  "Fast shipping may reduce delivery time by 20–30%.",
  "El envío exprés puede reducir el tiempo de transporte un 40–60%.",
  "The fabric is 100% polyester; delivery estimates are not guaranteed.",
  "Save 20% of the usual delivery time with this transport option.",
  "运输时间可能缩短20–30%，具体以承运商为准。",
]) {
  assert.equal(sanitizeGuestReplyText(text, { userText: logisticsUser, productSearchIntent: wronglyFlaggedPolicy }), text); checks++;
  const result = enforceDiscountOfferReplyPolicy({ replyResult: { text, speechText: text }, userText: logisticsUser, searchIntent: wronglyFlaggedPolicy });
  assert.equal(result.text, text); checks++;
  assert.equal(result.speechText, text); checks++;
}
const shippingParagraph = "Fast delivery may shorten transit time by 20–30%.";
const mixedPolicy = `${shippingParagraph}\n\nUse SAVE20 for 20% off.`;
assert.equal(sanitizeGuestReplyText(mixedPolicy, { userText, productSearchIntent }), `${shippingParagraph}\n\n${notice}`); checks++;

const unsafeReplies = [
  "Use promo code SAVE20 today.", "SAVE20", "fake50", "WELCOME", "Coupon code WELCOME", "DISCOUNT CODE WELCOME",
  "优惠码 WELCOME", "Tu código es XMAS10.", "I cannot give you SAVE20.", "WELCOME123456",
  "This shirt is 20% off today.", "You get 10% off.", "Save 20% today.", "Save 20% on your order.", "I can give you a member-only benefit.",
  "Your discount is approved.", "I will grant you a reward.", "You are eligible for this benefit.",
  "你可以享受优惠。", "Te doy un descuento.",
  "I cannot confirm stock and you get 20% off.",
  "I can't promise 5% off, but you get 10% off.",
  "I cannot guarantee a discount. Use SAVE20 instead.",
];
for (const text of unsafeReplies) {
  assert.equal(sanitizeGuestReplyText(text, { userText, productSearchIntent }), notice, text); checks++;
  assert.equal(normalizeGuestReplyText({ text, userText, productSearchIntent, imageTaskCreated: true }), notice, text); checks++;
}
for (const intent of [
  null,
  { ...productSearchIntent, discountExplanationRequired: false },
  { ...productSearchIntent, discountExplanationEvidence: "" },
  { ...productSearchIntent, discountExplanationEvidence: "unrelated evidence" },
]) {
  assert.equal(normalizeGuestReplyText({ text: safeReplies[0], userText, productSearchIntent: intent }), notice); checks++;
}
assert.equal(normalizeGuestReplyText({ text: safeReplies[0], userText, productSearchIntent: { ...productSearchIntent, answerRequired: false } }), safeReplies[0]); checks++;
assert.equal(normalizeGuestReplyText({ text: "I can get you a member-only benefit.", userText: "Give me a coupon" }), notice); checks++;
assert.equal(sanitizeGuestReplyText("The sleeve colour is blue."), "The sleeve colour is blue."); checks++;
const product = { id: "shirt", name: "Blue Shirt", url: "https://example.com/shirt" };
assert.equal(normalizeGuestReplyText({ text: safeReplies[0], userText, productSearchIntent, product }), safeReplies[0]); checks++;
assert.equal(normalizeGuestReplyText({ text: "Use SAVE20", userText, productSearchIntent, product }), notice); checks++;
for (const offers of [[], [{ code: "REAL20", offerDescription: "20% off selected shirts" }]]) {
  for (const text of safeReplies) {
    const reply = enforceDiscountOfferReplyPolicy({ replyResult: { text, speechText: text }, userText, searchIntent: productSearchIntent, offers });
    assert.equal(reply.text, text); checks++;
    assert.equal(reply.speechText, text); checks++;
    assert.notEqual(reply.discountOfferReply, true); checks++;
  }
  for (const text of [...unsafeReplies, "REAL20"]) {
    const reply = enforceDiscountOfferReplyPolicy({ replyResult: { text, speechText: text }, userText, searchIntent: productSearchIntent, offers });
    assert.notEqual(reply.text, text, text); checks++;
    assert.doesNotMatch(reply.text, /SAVE20|fake50|WELCOME|XMAS10|REAL20|20%|10%|给你|可以享受|Te doy/); checks++;
    assert.notEqual(reply.discountOfferReply, true); checks++;
  }
}
const speechOnlyLeak = enforceDiscountOfferReplyPolicy({ replyResult: { text: safeReplies[0], speechText: "Use FAKE20" }, userText, searchIntent: productSearchIntent });
assert.doesNotMatch(speechOnlyLeak.speechText, /FAKE20/); checks++;
console.log(`guest discount policy self-check passed (${checks} checks)`);
