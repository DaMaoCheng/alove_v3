import assert from "node:assert/strict";
import { parseStructuredReply } from "../server/ai-reply-contract-service.js";
import { inspectAiReplyQuality } from "../server/ai-reply-quality-service.js";

const danglingArticle = inspectAiReplyQuality({
  text: "Go for the Barcelona home shirt, the long sleeves give it a.",
  userText: "Pick a home shirt",
});
assert.equal(danglingArticle.severity, "warn", "dangling English article endings should be flagged");
assert.ok(danglingArticle.reasons.includes("incomplete_ending"), "dangling article should be classified as incomplete ending");

const danglingConnector = inspectAiReplyQuality({
  text: "That kit works for cold match nights because.",
  userText: "Do you like this kit?",
});
assert.equal(danglingConnector.severity, "warn", "dangling connector endings should be flagged");
assert.ok(danglingConnector.reasons.includes("incomplete_ending"), "dangling connector should be classified as incomplete ending");

const completeConversational = inspectAiReplyQuality({
  text: "That kit works for cold match nights, bro.",
  userText: "Do you like this kit?",
});
assert.equal(completeConversational.severity, "pass", "complete conversational replies should still pass");
assert.deepEqual(completeConversational.reasons, [], "complete conversational replies should not be flagged");

const serviceTail = inspectAiReplyQuality({
  text: "Yeah, that's the Manchester City badge. Clean and sharp. If you want, I can describe it properly or compare the style to a football fashion look.",
  userText: "look this pic",
});
assert.equal(serviceTail.severity, "warn", "service-offer tails should be cleaned");
assert.ok(serviceTail.reasons.includes("template_tone"), "service tail should be classified as template tone");
assert.equal(serviceTail.finalText, "Yeah, that's the Manchester City badge. Clean and sharp.");

const chineseServiceTail = inspectAiReplyQuality({
  text: "这就是曼城队徽，蓝白配色很醒目。如果你需要，我可以继续帮你对比球衣风格。",
  userText: "看看这张图",
});
assert.equal(chineseServiceTail.severity, "warn", "Chinese service-offer tails should be cleaned");
assert.equal(chineseServiceTail.finalText, "这就是曼城队徽，蓝白配色很醒目。");

const onlyServiceTail = inspectAiReplyQuality({
  text: "If you want, I can describe it properly or compare the style to a football fashion look.",
  userText: "look this pic",
});
assert.equal(onlyServiceTail.shouldReplace, true, "pure service-offer replies should be replaced");
assert.equal(/if you want/i.test(onlyServiceTail.finalText), false, "fallback should not keep the service-offer tail");

const truncatedReply = parseStructuredReply("x".repeat(2001));
assert.equal(truncatedReply.truncated, true, "display text truncation must remain observable so it can be retried instead of shown as a half reply");

for (const text of ["C’est comme ça.", "Tu en as.", 'Il dit "bonjour".']) {
  assert(!inspectAiReplyQuality({ text, language: "fr" }).reasons.includes("incomplete_ending"), "Complete French and balanced quotes must not match English suffixes");
}
for (const text of ['He said "hello" and.', 'He started "']) {
  assert(inspectAiReplyQuality({ text, language: "en" }).reasons.includes("incomplete_ending"), "Balanced earlier quotes must not conceal a real unfinished English ending");
}
const { generateChatReplyWithRequest } = await import("../server/ai-reply-service.js");
let generationCalls = 0;
const generated = await generateChatReplyWithRequest({
  promptContext: { systemPrompt: "Speak French.", messages: [{ role: "user", content: "Tu en as ?" }] },
  userText: "Tu en as ?", logContext: { languageCode: "fr", languageLabel: "French" },
  requestReplyText: async () => { generationCalls++; return JSON.stringify({ displayText: "Tu en as.", speechText: "Tu en as." }); },
  recordReplyLogFn: async () => {},
});
assert.equal(generated.text, "Tu en as.");
assert.equal(generationCalls, 1, "The actual generator must propagate French before deciding to retry");

console.log("ai reply incomplete ending self-check passed");
