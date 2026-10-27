import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SUPPORTED_CHARACTER_LANGUAGES } from "../shared/language-library.js";
import {
  appendFeedbackFollowupCopy,
  isTrackingReference,
  resolveChatFeedbackAction,
  resolveChatFeedbackActionCandidate,
} from "../server/chat-feedback-action-service.js";

const mascot = { id: "mascot_fkk", categoryId: "mascot", profile: { language: "English" } };
const creator = { id: "creator_test", categoryId: "creator", profile: { language: "Chinese" } };
const plainCharacter = { id: "fan_test", categoryId: "fan", profile: { language: "English" } };
const hungarianMascot = { id: "mascot_hu", categoryId: "mascot", profile_json: JSON.stringify({ language: "Hungarian" }) };

assert.deepEqual(
  resolveChatFeedbackAction({
    character: mascot,
    productContext: {
      sourceRef: "site-product-no-match",
      searchOutcome: "no_match",
      products: [],
      searchIntent: { requestedTeam: "Manchester United", requestedVariant: "away", searchState: "ready_to_search" },
    },
    knowledgeContext: { items: [] },
    replyResult: { sourceType: "ai" },
  }),
  null,
  "a catalogue no-match alone must not turn a product search into a contact or business request"
);

for (const sourceRef of ["site-product-no-match", "guest-site-product-no-match"]) {
  for (const language of SUPPORTED_CHARACTER_LANGUAGES) {
    const character = { ...mascot, profile: { languageCode: language.code } };
    const searchIntent = { commerceRoute: "product_search", commerceTopic: "other", commerceConfidence: .99,
      replyBoundary: { salesAllowed: true, contactAllowed: true }, humanHandoff: null, businessInquiry: null };
    const options = { character, userText: "Show me the requested short-sleeved shirt.", searchIntent,
      productContext: { sourceRef, searchOutcome: "no_match", products: [], searchIntent },
      knowledgeContext: { items: [], strategy: "not_requested" }, replyResult: { sourceType: "ai" } };
    const candidate = resolveChatFeedbackActionCandidate(options);
    const finalAction = resolveChatFeedbackAction({ ...options, feedbackActionCandidate: candidate });
    assert.equal(candidate, null, `${sourceRef}/${language.code}: an empty search must not reserve a form`);
    assert.equal(finalAction, null, `${sourceRef}/${language.code}: persistence must not infer a contact request`);
    assert.equal(appendFeedbackFollowupCopy("No exact item found.", { ...options, feedbackAction: finalAction }),
      "No exact item found.", `${sourceRef}/${language.code}: retain the no-match reply without business/form copy`);
  }
  const productContext = { sourceRef, searchOutcome: "no_match", products: [] };
  const base = { character: mascot, productContext, replyResult: { sourceType: "ai" } };
  const userText = "Find that shirt and connect me with support.";
  const humanIntent = { commerceRoute: "product_search", commerceConfidence: .99,
    replyBoundary: { contactAllowed: true }, humanHandoff: { explicitRequest: true, evidence: "connect me with support" } };
  assert.equal(resolveChatFeedbackActionCandidate({ ...base, userText, searchIntent: humanIntent })?.reason,
    "human_request", `${sourceRef}: explicit mixed human help survives a catalogue miss`);
  const businessText = "Find that shirt and negotiate a wholesale quotation.";
  const businessIntent = { commerceRoute: "product_search", commerceConfidence: .99,
    replyBoundary: { contactAllowed: true }, businessInquiry: { kind: "wholesale", evidence: "negotiate a wholesale quotation" },
    humanHandoff: { explicitRequest: false, businessReviewRequired: true, reviewReason: "quotation", evidence: "negotiate a wholesale quotation" } };
  assert.equal(resolveChatFeedbackActionCandidate({ ...base, userText: businessText, searchIntent: businessIntent })?.reason,
    "business_review", `${sourceRef}: genuine mixed business negotiation keeps its form`);
  assert.equal(resolveChatFeedbackActionCandidate({ ...base, userText: "Find the shirt and help me exchange my previous order.",
    searchIntent: { commerceRoute: "product_search", replyBoundary: { contactAllowed: true } },
    knowledgeContext: { customerServiceTopic: "returns", items: [{ title: "Returns policy" }] } })?.kind,
    "feedback", `${sourceRef}: a coexisting return request still receives support`);
  assert.equal(resolveChatFeedbackActionCandidate({ ...base, userText, searchIntent: { ...humanIntent,
    replyBoundary: { contactAllowed: false } } }), null, `${sourceRef}: contact refusal still takes precedence`);
}
assert.deepEqual(
  resolveChatFeedbackAction({
    character: mascot,
    productContext: {
      sourceRef: "guest-site-product-no-match",
      searchOutcome: "needs_clarification",
      products: [],
      searchIntent: { requestedTeam: "Manchester United", requestedAudience: "kids", requestedAgeRange: "18-24 months", searchState: "needs_clarification" },
    },
    replyResult: { sourceType: "ai" },
  }),
  null,
  "an under-specified product search must keep its clarification reply without a terminal feedback action"
);
assert.deepEqual(
  resolveChatFeedbackAction({
    character: creator,
    knowledgeContext: { customerServiceIntent: true, customerServiceTopic: "support", items: [] },
    replyResult: { sourceType: "ai" },
  }),
  { kind: "feedback", label: "点击这里" },
  "an explicit support knowledge-base miss should use the character language"
);
assert.equal(
  resolveChatFeedbackAction({
    character: creator,
    knowledgeContext: { customerServiceIntent: true, items: [] },
    replyResult: { sourceType: "ai" },
  }),
  null,
  "an unknown empty business reference alone is not evidence of a contact need"
);
assert.equal(
  resolveChatFeedbackAction({
    character: mascot,
    productContext: { sourceRef: "site-product-no-match", products: [{ name: "Known kit" }] },
    replyResult: { sourceType: "ai" },
  }),
  null,
  "a product candidate must suppress the action"
);
assert.deepEqual(
  resolveChatFeedbackActionCandidate({
    character: hungarianMascot,
    userText: "Fuvarlevélszám CR436184236DE rendelés iránt érdeklődnék",
  }),
  { kind: "feedback", label: "Kattints ide" },
  "a tracking reference must deterministically reserve the one localized feedback action"
);
assert.deepEqual(
  resolveChatFeedbackAction({
    character: hungarianMascot,
    userText: "Fuvarlevélszám CR436184236DE rendelés iránt érdeklődnék",
    replyResult: { sourceType: "ai" },
  }),
  { kind: "feedback", label: "Kattints ide" },
  "the final action must use the same tracking candidate as the prompt path"
);
const trackingCandidate = resolveChatFeedbackActionCandidate({
  character: hungarianMascot,
  userText: "A csomagkövetési számom: TRK-20260820-1842. Meg tudod nézni?",
});
assert.deepEqual(
  resolveChatFeedbackAction({
    character: hungarianMascot,
    replyResult: { sourceType: "system", sourceRef: "quality-guard" },
    feedbackActionCandidate: trackingCandidate,
  }),
  trackingCandidate,
  "a confirmed server-side candidate must survive a controlled non-transport fallback reply"
);
assert.equal(
  resolveChatFeedbackAction({
    character: hungarianMascot,
    replyResult: { sourceType: "system", sourceRef: "quality-guard" },
  }),
  null,
  "a controlled reply without a confirmed candidate must not create an action"
);
assert.equal(
  isTrackingReference("A csomagkövetési számom: TRK-20260820-1842. Meg tudod nézni?"),
  true,
  "Hungarian tracking wording and hyphenated carrier identifiers must reserve the feedback action"
);
assert.deepEqual(
  resolveChatFeedbackActionCandidate({
    character: hungarianMascot,
    userText: "A csomagkövetési számom: TRK-20260820-1842. Meg tudod nézni?",
  }),
  { kind: "feedback", label: "Kattints ide" },
  "the same real tracking phrasing must receive exactly one localized action candidate"
);
assert.deepEqual(
  resolveChatFeedbackActionCandidate({
    character: hungarianMascot,
    productContext: { products: [{ id: "known-kit" }] },
    userText: "A csomagkövetési számom: TRK-20260820-1842. Meg tudod nézni?",
  }),
  { kind: "feedback", label: "Kattints ide" },
  "a tracking reference must retain its real handoff even when the same turn still has product context"
);
assert.equal(
  resolveChatFeedbackActionCandidate({
    character: hungarianMascot,
    knowledgeContext: { customerServiceIntent: true, items: [{ title: "Verified delivery policy" }] },
    userText: "Mikor érkezik meg a rendelésem?",
  }),
  null,
  "ordinary delivery questions with verified knowledge must not create a feedback action"
);
assert.deepEqual(
  resolveChatFeedbackAction({
    character: mascot,
    knowledgeContext: { customerServiceIntent: true, customerServiceTopic: "returns", items: [{ title: "Returns policy" }] },
    replyResult: { sourceType: "ai" },
    userText: "I want to exchange this jersey for another size",
  }),
  { kind: "feedback", label: "Click here" },
  "return and exchange requests must reserve the direct feedback action even when a policy reference exists"
);
assert.equal(
  resolveChatFeedbackActionCandidate({ character: hungarianMascot, userText: "Szia, hogy vagy?" }),
  null,
  "ordinary storefront chat must not create a feedback action"
);
const formCopy = "Use the feedback button below to open the form, then submit your question or business request for the team to review.";
const plainFeedback = { kind: "feedback", label: "Click here" };
assert.equal(
  appendFeedbackFollowupCopy("I couldn't confirm that.", { character: mascot, feedbackAction: plainFeedback }),
  `I couldn't confirm that.\n\n${formCopy}`,
  "feedback must describe the real form submission without promising chat-email forwarding"
);
for (const existingText of [
  "You can leave a contact email here in the chat or use the feedback action below.",
  "I can't access your email from here.",
  "I can't submit feedback for you.",
  "I can't send an email from here.",
  "I can't use the feedback button for you.",
  "Do not leave your email in this chat.",
  "I can't submit feedback for you, but you can use the feedback button below.",
  "Don't hesitate to leave your email here.",
  "I can't submit feedback for you, though you can use the feedback button below.",
  "I cannot submit feedback myself, so please use the feedback button below.",
]) {
  assert.equal(
    appendFeedbackFollowupCopy(existingText, { character: mascot, feedbackAction: plainFeedback }),
    `${existingText}\n\n${formCopy}`,
    `ordinary or obsolete generated text must not suppress the real submission guidance: ${existingText}`
  );
}
for (const action of [
  plainFeedback,
  { ...plainFeedback, reason: "human_request" },
  { ...plainFeedback, reason: "business_review" },
  { ...plainFeedback, reason: "checkout_review" },
  { kind: "jersey_customization", label: "Click here" },
]) {
  const options = { character: mascot, feedbackAction: action };
  const once = appendFeedbackFollowupCopy("Keep the supported answer.", options);
  assert.equal(once, `Keep the supported answer.\n\n${formCopy}`, `all feedback reasons use the same real submission flow: ${action.reason || action.kind}`);
  assert.equal(appendFeedbackFollowupCopy(once, options), once, "repeated append must not duplicate the exact standardized suffix");
  assert.equal(appendFeedbackFollowupCopy("", options), formCopy, "empty answer must receive only the real form guidance");
  assert.equal(appendFeedbackFollowupCopy(formCopy, options), formCopy, "a suffix already constituting the answer must not be repeated");
  assert.equal(appendFeedbackFollowupCopy("Preserve answer", { ...options, searchIntent: { replyBoundary: { contactAllowed: false } } }), "Preserve answer", "explicit contact refusal prevents even a reserved action from appending copy");
}
assert.equal(appendFeedbackFollowupCopy("No action", { character: mascot }), "No action", "ordinary no-action replies remain untouched");
assert.equal(SUPPORTED_CHARACTER_LANGUAGES.length, 43, "exercise every supported language");
const localizedCopies = new Set();
for (const language of SUPPORTED_CHARACTER_LANGUAGES) {
  const character = { ...mascot, profile: { languageCode: language.code } };
  const formSuffix = appendFeedbackFollowupCopy("", { character, feedbackAction: { ...plainFeedback, reason: "human_request" } });
  assert.ok(formSuffix, `form submission guidance exists for ${language.code}`);
  localizedCopies.add(formSuffix);
  if (language.code !== "en") assert.notEqual(formSuffix, formCopy, `${language.code} must use its local form guidance`);
  for (const action of [plainFeedback, { ...plainFeedback, reason: "business_review" }, { ...plainFeedback, reason: "checkout_review" }, { kind: "jersey_customization", label: "Click here" }]) {
    const options = { character, feedbackAction: action };
    const composed = appendFeedbackFollowupCopy("Original body", options);
    assert.equal(composed, `Original body\n\n${formSuffix}`, `actual feedback flow must stay localized for ${language.code}/${action.reason || action.kind}`);
    assert.equal(appendFeedbackFollowupCopy(composed, options), composed, `localized exact suffix remains idempotent for ${language.code}`);
  }
}
assert.equal(localizedCopies.size, 43, "all supported languages have distinct localized form guidance");
assert.deepEqual(
  resolveChatFeedbackAction({
    character: mascot,
    productContext: null,
    replyResult: { sourceType: "ai" },
    userText: "Can I customize a football jersey?",
  }),
  { kind: "jersey_customization", label: "Click here" },
  "a jersey customization question should create the contact handoff action"
);
assert.match(
  appendFeedbackFollowupCopy("", {
    character: mascot,
    feedbackAction: { kind: "jersey_customization", label: "Click here" },
  }),
  /^Use the feedback button below to open the form, then submit/i,
  "customization handoff must use the actual form submission suffix"
);
assert.equal(
  resolveChatFeedbackAction({
    character: mascot,
    knowledgeContext: { customerServiceIntent: true, items: [{ title: "Shipping" }] },
    replyResult: { sourceType: "ai" },
  }),
  null,
  "a knowledge reference must suppress the action"
);
assert.equal(
  resolveChatFeedbackAction({
    character: plainCharacter,
    productContext: { sourceRef: "site-product-no-match", products: [] },
    replyResult: { sourceType: "ai" },
  }),
  null,
  "non-storefront characters must not invite feedback through chat"
);
assert.equal(
  resolveChatFeedbackAction({
    character: mascot,
    productContext: { sourceRef: "site-product-no-match", products: [] },
    replyResult: { sourceType: "system", sourceRef: "ai-request-fallback", degraded: true },
  }),
  null,
  "AI transport fallbacks must not create a feedback action"
);

// Explicit per-turn language wins over the original character default, without
// changing the character or deriving a preference from the user's wording.
for (const { code } of SUPPORTED_CHARACTER_LANGUAGES) {
  const expected = appendFeedbackFollowupCopy("Body", { character: { profile: { languageCode: code } }, feedbackAction: plainFeedback });
  const options = { character: mascot, languageCode: code, feedbackAction: plainFeedback };
  const actual = appendFeedbackFollowupCopy("Body", options);
  assert.equal(actual, expected, `active ${code} must override original English character`);
  assert.equal(appendFeedbackFollowupCopy(actual, options), actual, `${code} append must stay idempotent`);
  assert.equal(appendFeedbackFollowupCopy("Body", { ...options, feedbackAction: null }), "Body");
  assert.equal(appendFeedbackFollowupCopy("Body", { ...options, searchIntent: { replyBoundary: { contactAllowed: false } } }), "Body");
}
assert.equal(appendFeedbackFollowupCopy("Body", { character: hungarianMascot, languageCode: "not-a-language", feedbackAction: plainFeedback }),
  appendFeedbackFollowupCopy("Body", { character: hungarianMascot, feedbackAction: plainFeedback }));
assert.equal(mascot.profile.language, "English", "per-turn override must not mutate the role default");

const notificationPanel = readFileSync("src/features/notifications/notification-panel.js", "utf8");
const renderer = readFileSync("src/features/chat/chat-message-renderer.js", "utf8");
const chatPage = readFileSync("src/features/chat/chat-page.js", "utf8");
const orchestrator = readFileSync("server/chat-reply-orchestrator-service.js", "utf8");
const guestReplies = readFileSync("server/guest-reply-service.js", "utf8");

assert.match(notificationPanel, /export function openFeedbackDialog\(/, "feedback must expose the existing modal opener");
assert.match(notificationPanel, /document\.body\.classList\.add\("feedback-open"\)/, "modal opener must preserve the existing blurred backdrop state");
assert.match(renderer, /message\.contentType === "feedback_action"/, "chat renderer must render the dedicated action type");
assert.match(renderer, /data-open-feedback/, "action message must expose one modal trigger");
assert.match(renderer, /feedback-action-avatar-spacer/, "action message must reserve the avatar column so it aligns with character bubbles");
assert.match(chatPage, /openFeedbackDialog\(\{ guestMode, pageLanguage \}\)/, "chat action must reuse the shared feedback modal opener with guest mode and the active site language");
assert.match(orchestrator, /contentType: "feedback_action"/, "member replies must persist the action after text");
assert.match(orchestrator, /replyTriggerMessageId/, "member action messages must be scoped to the triggering user turn");
assert.match(orchestrator, /canInsertFeedbackAction/, "member action messages must not be duplicated for one trigger");
assert.match(guestReplies, /contentType: "feedback_action"/, "guest replies must persist the same action type");
assert.match(guestReplies, /appendFeedbackFollowupCopy\(reply\.text/, "guest replies must use the same contact handoff copy as member replies");
assert.match(guestReplies, /userText: prepared\.text/, "guest replies must retain raw jersey-customization wording when deciding the feedback action");
assert.match(guestReplies, /resolveChatFeedbackActionCandidate\(/, "guest prompts and persistence must share one feedback-action candidate");
assert.match(guestReplies, /guest-feedback-follow-up-action:\$\{prepared\.message\.id\}/, "guest action messages must be scoped to the triggering user turn");

console.log("chat feedback action self-check passed");
