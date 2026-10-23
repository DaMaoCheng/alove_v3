export const LANGUAGE_REVIEW_PROTOCOL_FAILURES = new Set(["field_types", "missing_fields", "supported_type", "confidence", "issue_count", "retained_type", "issue_type", "issue_field", "issue_severity", "issue_span", "span_mismatch"]);
// Language certainty is independent of business/permission review confidence.
export const LANGUAGE_REVIEW_MIN_CONFIDENCE = 0.54;
export function languageReviewConfident(score) {
  return Number.isFinite(score) && score >= LANGUAGE_REVIEW_MIN_CONFIDENCE && score <= 1;
}
// Legacy language-only review shares the same threshold. Any boundary or
// non-language contract keeps the existing business confidence requirement.
export function replyReviewConfident(result, contracts = []) {
  if (contracts.length === 1 && contracts[0] === "language" && result?.boundarySupported === undefined)
    return languageReviewConfident(result?.confidence);
  return Number.isFinite(result?.confidence) && result.confidence >= .8 && result.confidence <= 1;
}
// Each review stage/provider owns this budget; transport fallbacks do not
// split one shrinking deadline. A correction remains strictly single-shot.
export const REPLY_REVIEW_TIMEOUT_MS = 20000;
export const LANGUAGE_REVIEW_TIMEOUT_MS = 20000;
export const REPLY_REPAIR_TIMEOUT_MS = 15000;
export const GROUNDED_COMMERCE_REPAIR_TIMEOUT_MS = 30000;

// A caller must explicitly opt into the commerce correction scope. Generic
// language/image recovery retains its original ceiling.
export function resolveReplyRepairBudget(timeoutMs, scope = '') {
  const ceiling = scope === 'grounded_commerce' ? GROUNDED_COMMERCE_REPAIR_TIMEOUT_MS : REPLY_REPAIR_TIMEOUT_MS;
  return Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.min(ceiling, timeoutMs) : ceiling;
}

// Review transport/shape failures are not semantic rejections of a contract.
export const REVIEW_STATUSES = new Set(["valid", "missing_fields", "invalid_fields", "invalid_json", "timeout", "network_error", "http_error", "unavailable", "not_run"]);
export const REVIEW_PROTOCOL_FAILURES = new Set(['missing_fields', 'field_types', 'confidence',
  'claim_count', 'claim_units', 'claim_fields', 'claim_references', 'claim_consistency', 'invalid_json']);

// Shape only: a correctly typed rejection is terminal, never a fallback trigger.
export function reviewFieldProtocolFailure(result, contracts = [], { independentLanguageReview = false, classificationUnavailable = false } = {}) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return 'field_types';
  const fields = ['allowed', ...reviewContractFields(contracts),
    ...(independentLanguageReview ? ['boundarySupported'] : []), ...(classificationUnavailable ? ['checkoutProblem'] : [])];
  if (result.confidence === undefined || fields.some(field => result[field] === undefined)) return 'missing_fields';
  if (fields.some(field => typeof result[field] !== 'boolean')) return 'field_types';
  return Number.isFinite(result.confidence) && result.confidence >= 0 && result.confidence <= 1 ? '' : 'confidence';
}

export const REVIEW_CONTRACTS = Object.freeze(Object.fromEntries([
  ["language", "languageQualityRequired", "languageQualitySupported", "retainedLanguageQualitySupported"],
  ["factual", "factualRequired", "factualSupported", "retainedFactualSupported"],
  ["evidence", "evidenceRequired", "evidenceSupported", "retainedEvidenceSupported"],
  ["guidance", "guidanceRequired", "guidanceSupported", "retainedGuidanceSupported"],
  ["business_facts", "businessFactsRequired", "businessFactsSupported", "retainedBusinessFactsSupported"],
  ["product_scope", "productScopeRequired", "productScopeSupported", "retainedProductScopeSupported"],
  ["candidate_confirmation", "candidateConfirmationRequired", "candidateConfirmationSupported", "retainedCandidateConfirmationSupported"],
  ["image_status", "imageStatusContext", "imageStatusSupported", "retainedImageStatusSupported"],
  ["guest_benefit", "guestBenefitContext", "guestBenefitSupported", "retainedGuestBenefitSupported"],
  ["factual_limitation", "factualLimitationReviewRequired", "factualLimitationRelevant", "retainedFactualLimitationRelevant"],
].map(([name, option, field, retainedField]) => [name, Object.freeze({ option, field, retainedField })])));
export const REVIEW_FAILURE_CODES = new Set(["boundary", ...Object.keys(REVIEW_CONTRACTS), "confidence"]);
export const RECOVERY_FAILURE_CODES = new Set([...REVIEW_FAILURE_CODES, "proactive"]);
export const REVIEW_OUTPUT_FIELDS = new Set(["allowed", "confidence", "boundarySupported", "checkoutProblem", "imageStatusRelevant", "imageReferenceMatched",
  ...Object.values(REVIEW_CONTRACTS).map(contract => contract.field)]);
export const LANGUAGE_REPAIR_SKIP_REASONS = new Set(["primary_rejected", "already_attempted", "not_enabled", "review_unavailable", "active_contract", "active_action", "checkout_unknown", "boundary_unapproved", "low_confidence", "mixed_contracts", "invalid_language_review", "unrepairable"]);
export const RECOVERY_KINDS = new Set(["language", "review", "factual", "boundary", "classification"]);

export function reviewContractFields(contracts, { retained = false } = {}) {
  return contracts.map(name => REVIEW_CONTRACTS[name]?.[retained ? "retainedField" : "field"]).filter(Boolean);
}

export function reviewOutcomeStatus(result, contracts = []) {
  if (result?.reviewStatus && REVIEW_STATUSES.has(result.reviewStatus)) return result.reviewStatus;
  if (!result || typeof result !== "object" || Array.isArray(result)) return "unavailable";
  const fields = ["allowed", ...reviewContractFields(contracts)];
  if (fields.some((field) => result[field] === undefined)) return "missing_fields";
  return fields.every((field) => typeof result[field] === "boolean")
    && Number.isFinite(result.confidence) && result.confidence >= 0 && result.confidence <= 1 ? "valid" : "invalid_fields";
}

export function reviewErrorStatus(error) {
  if (error?.code === "AI_JSON_PARSE_ERROR") return "invalid_json";
  if (error?.code === "AI_REPLY_TIMEOUT" || error?.aiFailureReason === "timeout") return "timeout";
  if (error?.code === "AI_REPLY_NETWORK_ERROR") return "network_error";
  if (Number.isInteger(error?.statusCode) && error.statusCode >= 400) return "http_error";
  return "unavailable";
}

export function failedReviewContracts(result, contracts = []) {
  // Synthesized fail-closed flags after a transport/shape error are not verdicts.
  if (reviewOutcomeStatus(result, contracts) !== "valid") return [];
  const failures = contracts.filter((name) => result?.[REVIEW_CONTRACTS[name]?.field] === false);
  if (!replyReviewConfident(result, contracts)) failures.push("confidence");
  if (result?.boundarySupported === false || result?.allowed === false && !failures.length) failures.push("boundary");
  return failures;
}

export function activeReviewContracts(options = {}) {
  return Object.entries(REVIEW_CONTRACTS).filter(([, contract]) => Boolean(options[contract.option])).map(([name]) => name);
}
