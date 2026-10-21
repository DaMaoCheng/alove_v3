import { buildFallbackReplyResult } from "./ai-reply-fallback-service.js";
import { buildGuestProductReplyCopy } from "./guest-product-reply-copy.js";

// A processing failure is neither a catalogue no-match nor missing user details.
// Only server-validated classification failures can produce this fixed status.
export function buildCommerceClassificationFailureReply(searchIntent = {}, {
  userText = "", language = "en", voiceMeta = {},
} = {}) {
  const failure = searchIntent.commerceClassificationFailure;
  if (searchIntent.commerceClassificationUnavailable !== true
    || !["timeout", "provider", "parse", "missing_fields"].includes(failure)) return null;
  const reply = buildFallbackReplyResult(userText, { ...voiceMeta, fallbackLanguageCode: language },
    `commerce_classification_${failure}`, { sourceRef: "commerce-classification-unavailable" });
  // Timeout uses the existing translated server-timeout copy: a catalogue query
  // has not necessarily happened. Other failures use the generic search status.
  if (failure !== "timeout") {
    const text = buildGuestProductReplyCopy("unavailable", { languageCode: language, userText });
    reply.text = reply.displayText = reply.speechText = text;
  }
  return { ...reply, productScopeVerified: false, candidateEvidenceVerified: false,
    replyRecoveryState: { version: 1, kind: "classification", guardApplied: true, failedContracts: [],
      reviewStatus: failure === "timeout" ? "timeout" : failure === "parse" ? "invalid_json" : failure === "missing_fields" ? "missing_fields" : "unavailable" },
    candidateConfirmationVerified: false, replyBoundary: { salesAllowed: false, contactAllowed: false } };
}
