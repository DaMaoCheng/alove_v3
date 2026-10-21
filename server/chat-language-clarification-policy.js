import { SUPPORTED_CHARACTER_LANGUAGES, normalizeCharacterLanguage } from "../shared/language-library.js";
import { isAiTransportFallback } from "./ai-reply-fallback-service.js";

export const LANGUAGE_CLARIFICATION_SCHEMA = { type: "object", additionalProperties: false,
  properties: { purposeSupported: { type: "boolean" }, supported: { type: "boolean" }, targetCode: { type: "string", enum: ["", ...SUPPORTED_CHARACTER_LANGUAGES.map(language => language.code)] }, evidence: { type: "string" } },
  required: ["purposeSupported", "supported", "targetCode", "evidence"] };

export const LANGUAGE_CLARIFICATION_REVIEW_CONTRACT = "Only for this server-qualified text-review turn, return languageClarification:{purposeSupported:boolean,supported:boolean,targetCode:string,evidence:string}. First judge purposeSupported ONLY from the CURRENT USER: their sole current purpose must be that the configured response language is not understandable or is personally rejected for this conversation, without specifying a preferred target language or asking a concurrent substantive question. Interpret non-native fragments or omitted subjects semantically. Rejecting only some other language, a quotation, hypothetical/third-person statement, ordinary foreign-language input or a negated instruction unrelated to the configured language is insufficient. The target must still be a language the current user's own words positively demonstrate they can understand; naming, rejecting or quoting a language does not by itself identify a usable target. An explicit requested target follows the existing language preference and must NOT use this exception. evidence must be a short exact CURRENT user substring proving the personal current-language barrier, not an assistant/history substring. Unrelated retrieved general references never establish the USER purpose or a question they did not ask. Judge this USER purpose independently of the candidate's correctness: a bad, wrong-language or extra-answer candidate may have purposeSupported=true but supported=false; do not erase a proven purpose because the candidate failed. If USER purpose or usable target is uncertain, purposeSupported=false,supported=false,targetCode:\"\",evidence:\"\". Next judge supported for the candidate: it may be true ONLY if purposeSupported=true and BOTH complete proposed outputs only ask which language the user prefers, optionally with a brief acknowledgement. The question is required and an acknowledgement is optional. No extra answer, lasting-switch claim, product, policy, image, tool, contact or external action is permitted. Candidate supported also requires all original meaning/permission contracts, and final release still needs the independent whole-output language check. purposeSupported only guides one fresh text candidate; it never approves this output, changes a stored preference or grants an action.";

export const LANGUAGE_CLARIFICATION_QUALITY_CONTRACT = "A separate primary review proposed the supplied current-turn languageClarification, not a stored preference or permission. Independently recheck its relevance: the CURRENT user solely indicates that the configured response language is not understandable or is rejected for this conversation, gives no explicit preferred target or concurrent substantive request, and their current words positively evidence the proposed target is usable. Interpret non-native fragments and omitted subjects semantically. Both complete outputs must only ask which language the user prefers, optionally with a brief acknowledgement; the question is required, the acknowledgement is optional. Reject a permanent-switch claim, extra answer or unrelated clarification. Rejecting only some other language, quotation, hypothetical/third-person statement, ordinary foreign input or a negated instruction unrelated to the configured language is insufficient; rejection alone does not identify a usable target. If these conditions or same meaning in BOTH outputs fail or are uncertain, languageQualitySupported=false with a major coherence/unverifiable issue, even if grammar is good. Otherwise assess both complete outputs in activeLanguage, which is the proposed target for this one question only. Never infer a language change for the next turn or approve tools/actions. Do not rewrite.";

// This only offers a text-review question. It grants no language preference or
// action permission, and cannot replace the contracts on a mixed-purpose turn.
export function canReviewLanguageClarification({ replyResult = {}, searchIntent = {}, productContext = null,
  knowledgeContext = null, factualContext = null, userText = "", orderActionCandidate = null,
  feedbackActionCandidate = null, chatImageContext = null, guestBenefitContext = null,
  checkoutContext = null, imageStatusContext = null, boundaryReviewRequired = false,
  dedicatedLanguageReview = false } = {}) {
  return boundaryReviewRequired && dedicatedLanguageReview && replyResult.sourceType === "ai"
    && !isAiTransportFallback(replyResult) && searchIntent.commerceRoute === "chat"
    && typeof userText === "string" && userText.trim().length > 0 && userText.length <= 4000
    && String(replyResult.text || "").length <= 400 && !replyResult.partialAnswerRetained
    && String(replyResult.speechText || replyResult.text || "").length <= 400
    && !searchIntent.explicitProductTrigger && !searchIntent.customerServiceKnowledgeRequest
    && !searchIntent.shouldLoadProductContext && !searchIntent.needsLiveProductData && !searchIntent.cardAllowed
    && !searchIntent.scopeUnverified && !searchIntent.productScopePending && !searchIntent.nonShoppingReason
    && !searchIntent.businessInquiry && !searchIntent.humanHandoff && !searchIntent.promotionInquiry
    && !searchIntent.discountExplanationRequired && !searchIntent.checkoutIssue
    && searchIntent.knowledgeScope !== "business"
    && !["pending", "selected"].includes(searchIntent.productRequestState?.status)
    && (!searchIntent.productCandidateState || searchIntent.productCandidateState.status === "cleared")
    && !productContext?.products?.length && !productContext?.candidateContext && !productContext?.sizingProduct
    && productContext?.cardAllowed !== true
    && (!knowledgeContext?.items?.length || searchIntent.knowledgeScope === "general"
      && knowledgeContext.customerServiceIntent === false && knowledgeContext.source !== "brave_web"
      && knowledgeContext.items.every(item => item?.category !== "customer_service"))
    && knowledgeContext?.customerServiceIntent !== true && knowledgeContext?.source !== "brave_web"
    && factualContext?.required === false && factualContext.status === "not_required"
    && factualContext.searched !== true && !factualContext.items?.length
    && !orderActionCandidate && !feedbackActionCandidate && !chatImageContext && !imageStatusContext
    && !guestBenefitContext && !checkoutContext && !replyResult.discountOfferReply
    && !replyResult.verifiedDiscountOffers?.length;
}

const reviewedClarifications = new WeakSet();
const clarificationRecoveries = new WeakMap();

export function reviewedLanguageClarificationPurpose(result, { eligible = false, primaryReviewValid = false, userText = "" } = {}) {
  const value = result?.languageClarification;
  if (!eligible || !primaryReviewValid || typeof result?.allowed !== "boolean" || typeof result?.boundarySupported !== "boolean"
    || !Number.isFinite(result?.confidence) || result.confidence < .8 || result.confidence > 1
    || !value || Array.isArray(value) || value.purposeSupported !== true || typeof value.supported !== "boolean"
    || !SUPPORTED_CHARACTER_LANGUAGES.some(language => language.code === value.targetCode)
    || typeof value.evidence !== "string" || !value.evidence.trim() || value.evidence.length > 240
    || !userText.includes(value.evidence)) return null;
  const proof = { targetCode: value.targetCode, evidence: value.evidence };
  reviewedClarifications.add(proof);
  return proof;
}

export function reviewedLanguageClarification(result, { eligible = false, primaryAccepted = false, userText = "" } = {}) {
  if (!primaryAccepted || result?.allowed !== true || result?.boundarySupported !== true
    || result?.languageClarification?.supported !== true) return null;
  return reviewedLanguageClarificationPurpose(result, { eligible, primaryReviewValid: true, userText });
}

// The primary verdict guides one new candidate, never approves its output.
// Model JSON, copied packets and arbitrary voice metadata cannot create this
// request-local recovery purpose or carry it to a subsequent turn.
export function withLanguageClarificationRecovery(recovery, proof) {
  if (!proof || !reviewedClarifications.has(proof)) return recovery;
  const packet = { ...recovery };
  clarificationRecoveries.set(packet, proof);
  return packet;
}

export function languageClarificationRecoveryProof(recovery, userText = null) {
  const proof = recovery && typeof recovery === "object" && clarificationRecoveries.get(recovery);
  return proof && (userText === null || typeof userText === "string" && userText.includes(proof.evidence)) ? proof : null;
}

// Provenance never enters model JSON or stored preferences; only the whole-approved
// reply object can carry this one-message override to final voice persistence.
const reviewedVoiceLanguages = new WeakMap();

export function resolveReviewedReplyVoiceLanguage(reply, preference = {}) {
  const target = reply && typeof reply === "object" && reviewedVoiceLanguages.get(reply);
  return target ? { languageCode: target.code, languageLabel: target.label }
    : { languageCode: preference.languageCode, languageLabel: preference.languageLabel };
}

export function withClarificationVoiceLanguage(reply, clarification = null) {
  const target = clarification && normalizeCharacterLanguage(clarification.targetCode);
  if (!target) return reply;
  const reviewedReply = { ...reply, voiceMeta: { ...reply.voiceMeta, languageCode: target.code, languageLabel: target.label } };
  reviewedVoiceLanguages.set(reviewedReply, target);
  return reviewedReply;
}
