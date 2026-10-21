import assert from "node:assert/strict";
import { SUPPORTED_CHARACTER_LANGUAGES } from "../shared/language-library.js";
import { buildGuestBenefitContext, getGuestBenefitReviewContext, approveGuestBenefitContext, isGuestBenefitReplyReviewed, buildGuestBenefitFallback, appendGuestBenefitGuide } from "../server/guest-benefit-guidance-service.js";
import { normalizeGuestReplyText, sanitizeGuestReplyText, applyGuestPromptPolicy } from "../server/guest-chat-output-policy.js";
import { resolveChatFeedbackActionCandidate, resolveChatFeedbackAction } from "../server/chat-feedback-action-service.js";
import { getChatImageStatusFallbackCopy } from "../server/chat-image-status-context-service.js";

globalThis.fetch = async () => { throw new Error("External calls disabled in benefit/feedback self-check"); };
let checks = 0;
const check = (value, label) => { assert.ok(value, label); checks++; };
const userText = "I already registered and want a coupon for my first purchase. What are the delivery terms?";
const searchIntent = { commerceConfidence: .95, answerRequired: true, commerceRoute: "store_policy", commerceTopic: "price", knowledgeScope: "business", promotionInquiry: { kind: "benefit_request", evidence: "want a coupon" }, replyBoundary: { salesAllowed: true, contactAllowed: true } };
const body = "The verified delivery terms are listed above. I cannot confirm coupon eligibility here.";
const context = buildGuestBenefitContext({ searchIntent, userText, isGuest: true, languageCode: "en" });
check(Boolean(context) && getGuestBenefitReviewContext(context).issuanceAllowed === false, "current guest evidence creates a non-issuing permission context");
check(sanitizeGuestReplyText(body, { userText, productSearchIntent: searchIntent, guestBenefitContext: context }) !== body, "unreviewed context alone does not unlock coupon vocabulary");
check(approveGuestBenefitContext(context, { text: body, allowed: true, confidence: .9, guidanceSupported: true }), "one successful joint review approves only its exact body");
check(sanitizeGuestReplyText(body, { userText, productSearchIntent: searchIntent, guestBenefitContext: context }) === body, "reviewed safe access explanation is not replaced by a registration promise");
check(normalizeGuestReplyText({ text: body, userText, productSearchIntent: searchIntent, guestBenefitContext: context, productRequested: true }) === body, "mixed delivery answer survives all guest normalization passes");
const combined = appendGuestBenefitGuide(body, context);
check(combined.startsWith(body) && combined.endsWith(buildGuestBenefitFallback(context)), "controlled permission copy is appended without swallowing substantive answers");
check(appendGuestBenefitGuide(buildGuestBenefitFallback(context), context) === buildGuestBenefitFallback(context), "controlled failure copy is not duplicated");
check(appendGuestBenefitGuide("Unreviewed promise", context) === buildGuestBenefitFallback(context), "append refuses unreviewed arbitrary bodies");
check(!getGuestBenefitReviewContext({ ...context }) && !isGuestBenefitReplyReviewed({ ...context }, body), "serialized or forged context is not review proof");
check(!isGuestBenefitReplyReviewed(context, `${body} You get a benefit.`), "a later appended claim invalidates exact-text approval");
for (const options of [
  { isGuest: false }, { isGuest: "true" }, { searchIntent: { ...searchIntent, commerceConfidence: Infinity } },
  { searchIntent: { ...searchIntent, commerceConfidence: .7 } }, { searchIntent: { ...searchIntent, commerceConfidence: 1.1 } },
  { searchIntent: { ...searchIntent, promotionInquiry: { kind: "policy", evidence: "want a coupon" } } },
  { searchIntent: { ...searchIntent, promotionInquiry: { kind: "benefit_request", evidence: "earlier unrelated request" } } },
]) check(buildGuestBenefitContext({ searchIntent, userText, isGuest: true, ...options }) === null, "invalid evidence/confidence or authenticated status cannot open the guest explanation path");
for (const verdict of [
  { allowed: false }, { confidence: Infinity }, { guidanceSupported: false }, { evidenceRequired: true, evidenceSupported: false },
  { imageStatusRequired: true, imageStatusSupported: false }, { transportFallback: true },
]) {
  check(!approveGuestBenefitContext(context, { text: body, allowed: true, confidence: .95, guidanceSupported: true, ...verdict }), "any failed required audit dimension fails closed");
  check(!isGuestBenefitReplyReviewed(context, body), "failed reassessment revokes any previous approval");
}
for (const text of ["Use SAVE20", "You get 20% off.", "Te doy un descuento.", "你可以享受优惠。"] ) {
  approveGuestBenefitContext(context, { text, allowed: true, confidence: .95, guidanceSupported: true });
  check(sanitizeGuestReplyText(text, { userText, productSearchIntent: searchIntent, guestBenefitContext: context }) === buildGuestBenefitFallback(context), "deterministic token/grant guards remain even after a false-positive review");
}
for (const language of SUPPORTED_CHARACTER_LANGUAGES) {
  const ctx = buildGuestBenefitContext({ searchIntent, userText, isGuest: true, languageCode: language.code });
  const copy = buildGuestBenefitFallback(ctx);
  check(copy.length > 20 && (language.code === "en" || copy !== buildGuestBenefitFallback(context)), `${language.code} has controlled access copy without English fallback`);
  check(normalizeGuestReplyText({ text: copy, userText, productSearchIntent: searchIntent, guestBenefitContext: ctx, languageCode: language.code }) === copy, `${language.code} controlled fallback survives normalization without an audit of arbitrary text`);
}
const prompt = applyGuestPromptPolicy({ systemPrompt: "" }, { guestBenefitContext: context });
check(!prompt.systemPrompt.includes("discounts become available only after account registration") && prompt.systemPrompt.includes("other questions"), "guest prompt does not promise registration benefits or discard other questions");
const character = { id: "mascot_fixture", categoryId: "mascot", profile: { language: "es" } };
const emptyKnowledge = { customerServiceIntent: true, customerServiceTopic: "other", items: [] };
const identityIntent = { commerceRoute: "chat", commerceTopic: "other", knowledgeScope: "business", replyBoundary: { contactAllowed: true } };
const identityArgs = { character, userText: "Do you work for this jersey store?", knowledgeContext: emptyKnowledge, searchIntent: identityIntent };
check(resolveChatFeedbackActionCandidate(identityArgs) === null, "simple identity introduction is not a contact request merely because business knowledge is empty");
check(resolveChatFeedbackAction({ ...identityArgs, replyResult: { sourceType: "ai" } }) === null, "final fallback action resolution cannot re-add the identity feedback card");
const misroutedIdentityArgs = { ...identityArgs, searchIntent: { ...identityIntent, commerceRoute: "product_question", commerceConfidence: 1, answerRequired: true, needsLiveProductData: false } };
check(resolveChatFeedbackActionCandidate(misroutedIdentityArgs) === null, "product_question/business/other alone does not prove a product or service need");
check(resolveChatFeedbackAction({ ...misroutedIdentityArgs, replyResult: { sourceType: "ai" } }) === null, "final resolution also excludes the real identity misclassification combination");
const supportIdentityArgs = { ...identityArgs, knowledgeContext: { ...emptyKnowledge, customerServiceTopic: "support" }, searchIntent: { ...identityIntent, commerceTopic: "support", commerceConfidence: 1, humanHandoff: null } };
check(resolveChatFeedbackActionCandidate(supportIdentityArgs) === null, "explicit chat route outranks both support topic hints without verified handoff evidence");
check(resolveChatFeedbackAction({ ...supportIdentityArgs, replyResult: { sourceType: "ai" } }) === null, "final resolution cannot re-add support-topic feedback to a classified chat turn");
for (const route of ["store_policy", "product_question"]) {
  for (const topic of ["authenticity", "price", "stock", "material", "delivery", "returns", "support", "sizing", ...(route === "store_policy" ? ["other"] : [])]) {
    const action = resolveChatFeedbackActionCandidate({ ...identityArgs, searchIntent: { ...identityIntent, commerceRoute: route, commerceTopic: topic } });
    check(topic === "sizing" ? action === null : action?.kind === "feedback", `real ${route}/${topic}: sizing clarification alone needs no handoff; other missing knowledge retains service fallback`);
  }
}
for (const topic of ["authenticity", "delivery", "returns", "support"]) {
  check(resolveChatFeedbackActionCandidate({ ...identityArgs, searchIntent: {}, knowledgeContext: { ...emptyKnowledge, customerServiceTopic: topic } })?.kind === "feedback", `legacy explicit ${topic} without commerce route still permits feedback`);
  check(resolveChatFeedbackActionCandidate({ ...identityArgs, searchIntent: { commerceTopic: topic } })?.kind === "feedback", `legacy search ${topic} without commerce route still permits feedback`);
}
const businessIntent = { ...identityIntent, commerceConfidence: .95, businessInquiry: { kind: "dropshipping", evidence: "Do you support dropshipping?" } };
check(resolveChatFeedbackActionCandidate({ ...identityArgs, userText: businessIntent.businessInquiry.evidence, searchIntent: businessIntent })?.kind === "feedback", "verified current business question retains missing-knowledge fallback");
check(resolveChatFeedbackActionCandidate({ ...identityArgs, searchIntent: businessIntent }) === null, "old business evidence cannot turn an identity question into handoff");
const explicitHuman = { ...identityIntent, commerceConfidence: .95, humanHandoff: { explicitRequest: true, evidence: "a person" } };
check(resolveChatFeedbackActionCandidate({ ...identityArgs, userText: "Can I speak to a person?", searchIntent: explicitHuman })?.reason === "human_request", "explicit human request keeps its independent action");
check(resolveChatFeedbackActionCandidate({ ...identityArgs, userText: "Customize this jersey", searchIntent: identityIntent })?.kind === "jersey_customization", "customization independent action is preserved");
check(resolveChatFeedbackActionCandidate({ ...identityArgs, productContext: { sourceRef: "guest-site-product-no-match", searchOutcome: "no_match" } })?.kind === "feedback", "no-product-match independent fallback is preserved");
check(resolveChatFeedbackActionCandidate({ ...identityArgs, userText: "track my parcel", knowledgeContext: { ...emptyKnowledge, customerServiceTopic: "delivery" }, searchIntent: { ...identityIntent, commerceTopic: "delivery" }, orderActionCandidate: { kind: "ttmall_order_lookup", siteSlug: "fixture", status: "login_required" } }) === null, "real lookup entry suppresses redundant tracking handoff");
check(resolveChatFeedbackActionCandidate({ ...identityArgs, searchIntent: { ...explicitHuman, replyBoundary: { contactAllowed: false } }, userText: "Can I speak to a person?" }) === null, "contact refusal always wins");
for (const [kind, status] of [["generated", "queued"], ["generated", "generating"], ["generated", "ready"], ["generated", "failed"], ["generated", "unknown"], ["library", "ready"], ["unknown", "unknown"]]) {
  const chatImageContext = { imageStatus: { kind, status, currentTurn: true } };
  const imageArgs = { imageReason: "active_generation", imageTaskCreated: false, chatImageContext, languageCode: "es" };
  check(normalizeGuestReplyText({ ...imageArgs, text: "Old pending instruction" }) === getChatImageStatusFallbackCopy(chatImageContext, "es"), `${kind}/${status} server status supersedes the older active-generation fixed reply`);
  const mixed = "Las condiciones de entrega verificadas aparecen arriba.";
  check(normalizeGuestReplyText({ ...imageArgs, text: mixed, productSearchIntent: { answerRequired: true } }) === mixed, `${kind}/${status} does not swallow a concurrent complete answer before the joint audit`);
}
check(normalizeGuestReplyText({ text: "Legacy", imageReason: "active_generation" }) === "I’m still working on the current image — it’ll appear here when it’s ready.", "legacy image path without a refreshed status keeps its existing standalone copy");
check(normalizeGuestReplyText({ text: "The verified delivery terms are above.", imageReason: "active_generation", productSearchIntent: { answerRequired: true } }) === "The verified delivery terms are above.", "mixed legacy active-generation turns also preserve other questions for review");

for(const strategy of ["business_selection_unavailable","business_directory_limit"]){
 const knowledgeContext={...emptyKnowledge,strategy,customerServiceTopic:"support"};
 const technicalArgs={...identityArgs,knowledgeContext,searchIntent:{...identityIntent,commerceRoute:"store_policy",commerceTopic:"support"}};
 check(resolveChatFeedbackActionCandidate(technicalArgs)===null,"technical retrieval failure cannot imply missing store policy or automatic human form");
 check(resolveChatFeedbackAction({...technicalArgs,replyResult:{sourceType:"ai"}})===null,"final action cannot re-add technical-failure form");
 check(resolveChatFeedbackActionCandidate({...technicalArgs,searchIntent:explicitHuman,userText:"Can I speak to a person?"})?.reason==="human_request","retrieval failure preserves explicit human help");
 check(resolveChatFeedbackActionCandidate({...technicalArgs,knowledgeContext:{...knowledgeContext,customerServiceTopic:"returns"}})?.kind==="feedback","retrieval failure preserves real returns escalation");
 check(resolveChatFeedbackActionCandidate({...technicalArgs,searchIntent:{...explicitHuman,replyBoundary:{contactAllowed:false}},userText:"Can I speak to a person?"})===null,"contact refusal still dominates technical failure and human hint");
}

const generalTrackingIntent = { ...identityIntent, commerceTopic: "delivery", knowledgeScope: "general", answerRequired: true };
check(resolveChatFeedbackActionCandidate({ ...identityArgs, userText: 'What does this tracking status mean?', searchIntent: generalTrackingIntent }) === null, "generic tracking definition does not create unavailable-order contact form");
check(resolveChatFeedbackAction({ ...identityArgs, userText: 'Explain tracking status', searchIntent: generalTrackingIntent, replyResult: { sourceType: "ai" } }) === null, "final resolver cannot recreate definition contact form");
check(resolveChatFeedbackActionCandidate({ ...identityArgs, userText: 'Can I speak to a person about this tracking status?', searchIntent: { ...explicitHuman, ...generalTrackingIntent, commerceConfidence: .95, humanHandoff: explicitHuman.humanHandoff } })?.reason === "human_request", "explicit current human request remains available with a definition");
check(resolveChatFeedbackActionCandidate({ ...identityArgs, userText: 'track my parcel', searchIntent: { ...generalTrackingIntent, commerceRoute: 'store_policy', knowledgeScope: 'business' } })?.kind === 'feedback', "real unavailable tracking still offers existing help");

console.log(`Guest benefit/feedback self-check passed (${checks} assertions; pure functions, no DB/network/models)`);
