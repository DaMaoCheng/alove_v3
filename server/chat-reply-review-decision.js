import { reviewOutcomeStatus, failedReviewContracts, reviewContractFields, replyReviewConfident } from "./chat-reply-review-outcome.js";
import { containsFactualUnavailableCopy } from "./chat-factual-policy.js";

// All decisions use only the contracts enabled for this turn. Extra model fields
// cannot introduce a new failure category or select a fallback.
export function evaluateReplyReview(result, contracts, { requireBoundary = false } = {}) {
  const reviewStatus = reviewOutcomeStatus(result, contracts);
  const reviewValid = reviewStatus === "valid";
  const failedContracts = failedReviewContracts(result, contracts);
  const confident = reviewValid && replyReviewConfident(result, contracts);
  return { reviewStatus, reviewValid, failedContracts, confident,
    accepted: confident && result.allowed === true && result.boundarySupported !== false
      && (!requireBoundary || result.boundarySupported === true)
      && reviewContractFields(contracts).every(field => result[field] === true),
    factualRejected: confident && failedContracts.includes("factual") && !failedContracts.includes("factual_limitation"),
    languageRejected: contracts.includes("language") && result?.languageQualitySupported === false };
}

const RETAINABLE_FAILURES = new Set(["image_status", "business_facts", "factual", "product_scope", "evidence"]);

export function verifiedReplyRemainder(text, result, { completeParagraphs = true } = {}) {
  const retained = typeof result?.retainedText === "string" ? result.retainedText.trim() : "";
  if (!retained || result?.retainedTextAllowed !== true || retained === text) return "";
  const start = text.indexOf(retained), end = start + retained.length;
  const separator = completeParagraphs ? "\n\n" : "\n";
  if (start < 0 || start > 0 && !text.slice(0, start).endsWith(separator)
    || end < text.length && !text.slice(end).startsWith(separator)) return "";
  return retained;
}

// Whole flags describe the whole response; retained flags describe only the
// exact unchanged remainder. Neither can substitute for the other.
export function approveReplyRemainder(text, result, contracts, { dedicatedLanguageReview = false } = {}) {
  // A displayed candidate requires both complete outputs to pass. Retaining a
  // paragraph cannot approve that confirmation, even with legacy extra votes.
  if (contracts.includes("candidate_confirmation")) return "";
  const decision = evaluateReplyReview(result, contracts);
  if (!decision.confident || decision.accepted || !decision.failedContracts.some(name => RETAINABLE_FAILURES.has(name))) return "";
  const retained = verifiedReplyRemainder(text, result);
  if (!retained || result.retainedBoundarySupported !== true) return "";
  const retainedContracts = contracts.filter(name => name !== "factual_limitation" || containsFactualUnavailableCopy(retained));
  const fields = reviewContractFields(retainedContracts, { retained: true });
  // Legacy evidence/fact/scope contracts already require language approval of
  // preserved paragraphs, even when whole-language checking was not requested.
  if (!dedicatedLanguageReview && contracts.some(name => ["factual", "product_scope", "evidence"].includes(name))) fields.push("retainedLanguageQualitySupported");
  return fields.every(field => result[field] === true) ? retained : "";
}
