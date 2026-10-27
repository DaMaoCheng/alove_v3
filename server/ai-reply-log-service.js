import { LANGUAGE_REVIEW_PROTOCOL_FAILURES } from "./chat-reply-review-outcome.js";
import { getDbPool } from "./db.js";
import { createId } from "./security.js";
import { validateProductSourceErrorCode } from "./product-source-error-service.js";
import { SERVER_CONFIG } from "./config.js";
import { REVIEW_STATUSES, REVIEW_FAILURE_CODES, RECOVERY_KINDS, REVIEW_OUTPUT_FIELDS, LANGUAGE_REPAIR_SKIP_REASONS, REVIEW_PROTOCOL_FAILURES } from "./chat-reply-review-outcome.js";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const DEFAULT_PAGE = 1;
export const PROVIDER_RATE_LIMIT_KINDS = Object.freeze(['model_overloaded', 'requests_exhausted', 'tokens_exhausted',
  'failed_requests', 'unsupported_features', 'rate_limited', 'unknown_429']);

function formatRateLimitDetails(error) {
  const diagnostic = error?.providerRateLimit;
  if (Number(error?.statusCode) !== 429 || !PROVIDER_RATE_LIMIT_KINDS.includes(diagnostic?.kind)) return '';
  const parts = [`cause=${diagnostic.kind}`];
  for (const [field, label] of [['retryAfterSeconds', 'retry_after_s'], ['remainingRequests', 'requests_remaining'], ['remainingTokens', 'tokens_remaining']]) {
    if (Number.isSafeInteger(diagnostic[field]) && diagnostic[field] >= 0) parts.push(`${label}=${diagnostic[field]}`);
  }
  return '; ' + parts.join('; ');
}

function formatImageProviderDetails(error) {
  const raw = error?.imageProviderDiagnostic;
  if (!raw || typeof raw !== 'object') return '';
  const text = (value, pattern) => typeof value === 'string' && pattern.test(value)
    && !/sk[-_]|bearer|api.?key|authorization|password|secret|token/i.test(value) ? value : '';
  const details = {
    model: text(raw.model, /^[a-z0-9_.:-]{1,100}$/i),
    contentType: text(raw.contentType, /^[a-z0-9.+-]{1,40}\/[a-z0-9.+-]{1,40}$/i),
    blurred: typeof raw.blurred === 'boolean' ? raw.blurred : null,
    violation: typeof raw.violation === 'boolean' ? raw.violation : null,
    requestId: text(raw.requestId, /^[a-z0-9_:-]{1,100}$/i),
  };
  return `; image=${JSON.stringify(details)}`;
}

function formatProtocolDetails(error) {
  if (error?.code === "AI_JSON_PARSE_ERROR") return '; phase=output_protocol; protocol=parse';
  if (error?.code === "AI_JSON_INVALID_OUTPUT") return `; phase=output_protocol; protocol=${error.aiJsonProtocolKind === 'evidence' ? 'evidence' : 'shape'}`;
  return error?.code === "AI_REPLY_PROTOCOL_ERROR"
    && ["unexpected_stream", "invalid_json", "empty_answer", "invalid_stream", "incomplete_stream", "stream_limit"].includes(error?.protocolKind)
    ? `; protocol=${error.protocolKind}` : "";
}

const safeIdentifier = (value) => /^[a-z0-9_:-]{1,80}$/i.test(String(value || "")) ? String(value) : "";

// Only structured diagnostics are persisted: never upstream response bodies,
// prompts, credentials or URLs containing query strings/userinfo.
export function buildProviderAttemptLogEvent({
  type, modelConfig = {}, error = {}, attempt = 0, retrying = false,
  nextProvider = "", previousProviders = [], startedAt = Date.now(),
} = {}) {
  const provider = resolveProviderLogLabel(modelConfig.id, modelConfig.baseUrl);
  const recovered = type === "fallback_success";
  const http = Number(error.statusCode || 0);
  const reason = recovered ? "provider_fallback_success"
    : error.aiFailureReason || (error.code === "AI_REPLY_TIMEOUT" ? "timeout"
      : error.code === "AI_REPLY_NETWORK_ERROR" ? "network"
        : error.code === "AI_REPLY_PROTOCOL_ERROR" ? "protocol"
        : http ? `http_${http}` : "request_failed");
  // Restrict diagnostics to identifiers so arbitrary upstream errors cannot leak secrets.
  const safeReason = /^[a-z0-9_]{1,64}$/i.test(reason) ? reason : "request_failed";
  const baseUrl = normalizeSafeBaseUrl(modelConfig.baseUrl);
  const action = retrying ? "retry_same_provider" : nextProvider ? `switch_to=${nextProvider}` : "stop";
  return {
    startedAt,
    status: recovered || retrying || nextProvider ? "fallback" : "error",
    reply: {
      aiProvider: provider, aiModel: modelConfig.model, aiBaseUrl: baseUrl,
      sourceType: "ai", sourceRef: `${provider}-${recovered ? "fallback-success" : "attempt-failure"}`,
      degraded: true, degradationReason: safeReason,
    },
    errorMessage: recovered
      ? `fallback_success; previous=${previousProviders.join(",")}; selected=${provider}`
      : `attempt=${attempt}; reason=${safeReason}; HTTP=${http || "n/a"}; action=${action}${formatRateLimitDetails(error)}${formatProtocolDetails(error)}`,
  };
}

export async function recordAiReplyLog(payload = {}) {
  if (normalizeStatus(payload.status) === "success") {
    return;
  }

  await writeAiReplyLog(payload);
}

export function buildCommerceDecisionLogEvent({ searchIntent = {}, knowledgeContext = {}, productContext = null, factualContext = null, stageDurations = {}, requestId = "", sessionId = "", characterId = "", userId = "" } = {}) {
  const safeTopic = ["authenticity", "delivery", "returns", "support", "material", "sizing", "price", "stock", "other"].includes(searchIntent.commerceTopic) ? searchIntent.commerceTopic : "";
  const route = ["product_search", "product_question", "store_policy", "chat", "unclear"].includes(searchIntent.commerceRoute) ? searchIntent.commerceRoute : "legacy";
  const sourceErrorCode = validateProductSourceErrorCode(searchIntent.sourceErrorCode);
  const details = {
    route, topic: safeTopic,
    confidence: Math.max(0, Math.min(1, Number(searchIntent.commerceConfidence) || 0)),
    live: Boolean(searchIntent.shouldLoadProductContext),
    cardAllowed: searchIntent.cardAllowed !== false,
    classificationFailure: ["timeout", "provider", "parse", "missing_fields"].includes(searchIntent.commerceClassificationFailure) ? searchIntent.commerceClassificationFailure : "",
    classificationFailures: (Array.isArray(searchIntent.commerceClassificationFailures) ? searchIntent.commerceClassificationFailures : []).slice(0, 3)
      .filter(item => ['venice', 'openai', 'deepseek', 'other'].includes(item?.provider)
        && ['protocol_shape', 'protocol_evidence', 'parse', 'timeout', 'provider', 'http_429'].includes(item?.kind))
      .map(({ provider, kind }) => ({ provider, kind })),
    blockedBy: searchIntent.commerceClassificationUnavailable === true ? "classification"
      : searchIntent.primarySearchBlocked === true ? "primary_action"
      : searchIntent.teamConstraintUnverified === true ? "team_evidence"
        : searchIntent.replyBoundary?.salesAllowed === false ? "sales_boundary"
          : searchIntent.scopeUnverified === true ? "scope_unverified"
            : searchIntent.productScopePending === true ? "scope_pending" : "",
    sourceErrorCode,
    outcome: searchIntent.commerceClassificationUnavailable === true ? "classification_unavailable"
      : ["matched", "alternative", "candidate", "no_match", "needs_clarification", "clarification_exhausted", "source_error"].includes(productContext?.searchOutcome) ? productContext.searchOutcome : (sourceErrorCode ? "source_error" : productContext?.products?.length ? "matched" : "skipped"),
    productCount: Math.min(10, productContext?.products?.length || 0),
    scopeReason: ["confidence_unverified", "request_unverified", "selection_without_scope", "selection_index_unverified", "item_evidence_unverified", "non_multiple_shape_unverified", "relation_unverified", "selection_evidence_unverified"].includes(searchIntent.productScopeReason) ? searchIntent.productScopeReason : searchIntent.productScopeReason ? "scope_unverified" : "",
    knowledgeStrategy: ["customer_service_topic", "customer_service_no_reference", "directory_then_expanded", "expanded_all", "no_keyword_trigger", "empty_query", "not_requested",
      "no_business_reference", "business_directory_limit", "business_selection_unavailable", "business_no_relevant_section", "business_no_verified_answer", "business_verified_reference",
      "general_no_reference", "general_directory_limit", "general_selection_unavailable", "general_no_relevant_section", "general_no_verified_answer", "general_relevant_reference"].includes(knowledgeContext.strategy) ? knowledgeContext.strategy : "",
    knowledgeIds: (knowledgeContext.items || []).slice(0, 3).map((item) => safeIdentifier(item.id).slice(0, 64)).filter(Boolean),
  };
  if (typeof searchIntent.businessKnowledgeRequired === 'boolean') details.knowledgeRequired = searchIntent.businessKnowledgeRequired;
  const timings = {};
  for (const [field, label] of [['productMs', 'productMs'], ['knowledgeMs', 'knowledgeMs']]) {
    const value = stageDurations?.[field];
    if (Number.isSafeInteger(value) && value >= 0 && value <= 1200000) timings[label] = value;
  }
  if (Object.keys(timings).length) details.timings = timings;
  const selectionFailure = knowledgeContext.selectionFailure;
  if (["sizing", "product_selection", "commerce_question"].includes(searchIntent.replyTopicHint)) details.replyTopicHint = searchIntent.replyTopicHint;
  if (["directory", "evidence"].includes(selectionFailure?.stage)
    && ["timeout", "parse", "provider", "missing_fields", "not_configured", "protocol_shape", "protocol_evidence"].includes(selectionFailure?.kind)) {
    details.knowledgeFailure = { stage: selectionFailure.stage, kind: selectionFailure.kind };
  }
  const selectionDiagnostics = knowledgeContext.selectionDiagnostics;
  if (['directory', 'evidence'].includes(selectionDiagnostics?.stage)
    && ['empty', 'filtered', 'verified'].includes(selectionDiagnostics?.outcome)) {
    const counts = {};
    for (const key of ['selected', 'accepted', 'shape', 'unknown_id', 'not_relevant', 'low_confidence', 'invalid_quote']) {
      const value = selectionDiagnostics.counts?.[key];
      if (Number.isInteger(value) && value >= 0) counts[key] = Math.min(96, value);
    }
    details.knowledgeSelection = { stage: selectionDiagnostics.stage, outcome: selectionDiagnostics.outcome, counts };
  }
  if (factualContext && typeof factualContext === "object" && !Array.isArray(factualContext)) {
    const status = ["not_required", "disabled", "matched", "no_result", "error", "blocked"].includes(factualContext.status) ? factualContext.status : "error";
    const reason = String(factualContext.reason || "").toLowerCase();
    const safeReason = ["not_requested", "empty_input", "business_or_order_scope", "private_input", "search_disabled", "search_not_completed", "public_references", "no_public_references", "search_error", "timeout", "network_error"].includes(reason) || /^http_\d{3}$/.test(reason) ? reason : "unknown";
    details.factual = { required: factualContext.required === true, status, searched: factualContext.searched === true, reason: safeReason,
      refs: Math.min(5, Array.isArray(factualContext.items) ? factualContext.items.length : 0) };
    if (["none", "jev", "lexical_fallback", "catalogue_scope"].includes(factualContext.decisionSource)) details.factual.source = factualContext.decisionSource;
    if (Number.isFinite(factualContext.webSearchScore) && factualContext.webSearchScore >= 0 && factualContext.webSearchScore <= 1) details.factual.webScore = factualContext.webSearchScore;
  }
  while (JSON.stringify(details).length > 500 && details.knowledgeIds.length) details.knowledgeIds.pop();
  while (JSON.stringify(details).length > 500 && details.classificationFailures.length) details.classificationFailures.pop();
  // Keep the current knowledge failure and factual outcome in valid JSON. The
  // full provider attempt trace has separate logs; optional scope detail may go.
  for (const field of ["knowledgeIds", "classificationFailures", "scopeReason", "classificationFailure", "sourceErrorCode", "blockedBy", "confidence", "productCount", "cardAllowed"]) {
    if (JSON.stringify(details).length > 500) delete details[field];
  }
  if (JSON.stringify(details).length > 500 && details.knowledgeSelection) delete details.knowledgeSelection.counts;
  if (JSON.stringify(details).length > 500) delete details.knowledgeSelection;
  if (JSON.stringify(details).length > 500) delete details.timings;
  if (JSON.stringify(details).length > 500) delete details.knowledgeRequired;
  return { requestId: safeIdentifier(requestId), sessionId: safeIdentifier(sessionId), characterId: safeIdentifier(characterId), userId: safeIdentifier(userId),
    status: sourceErrorCode ? "error" : "success", provider: "commerce", sourceType: "commerce", sourceRef: "commerce-decision",
    degraded: Boolean(sourceErrorCode), degradationReason: sourceErrorCode,
    errorMessage: JSON.stringify(details),
  };
}

export async function recordCommerceDecisionLog(payload = {}) {
  if (!SERVER_CONFIG.runtime.providerLogWriteEnabled) return;
  await writeAiReplyLog(buildCommerceDecisionLogEvent(payload));
}

export function buildProviderCallLogEvent({
  requestId = "",
  sessionId = "",
  characterId = "",
  userId = "",
  provider = "",
  model = "",
  baseUrl = "",
  sourceRef = "provider-call",
  status = "success",
  startedAt = 0,
  durationMs = 0,
  error = null,
} = {}) {
  const succeeded = normalizeString(status).toLowerCase() === "success";
  return {
    requestId,
    sessionId, characterId, userId,
    provider: resolveProviderLogLabel(provider, baseUrl),
    model,
    baseUrl: normalizeSafeBaseUrl(baseUrl),
    status: succeeded ? "provider_success" : "provider_error",
    sourceType: "provider_call",
    sourceRef,
    degraded: !succeeded,
    degradationReason: succeeded ? "" : resolveProviderFailureReason(error),
    durationMs: durationMs || (startedAt ? Date.now() - startedAt : 0),
    errorMessage: succeeded ? "" : formatProviderFailureMessage(error),
  };
}

export async function recordProviderCallLog(payload = {}) {
  if (!SERVER_CONFIG.runtime.providerLogWriteEnabled) return;
  await writeAiReplyLog(buildProviderCallLogEvent(payload));
}

export function buildReplyReviewLogEvent({ logContext = {}, reviewStatus, failedContracts = [], guardApplied = false,
  fallbackKind = "none", missingFields = [], candidateHasFactualTemplate = false, outputHasFactualTemplate = false, outputChars = 0, languageDiagnostics = null, reviewProtocol = null } = {}) {
  const status = REVIEW_STATUSES.has(reviewStatus) ? reviewStatus : "unavailable";
  const kind = fallbackKind === "none" || RECOVERY_KINDS.has(fallbackKind) ? fallbackKind : "review";
  const details = { reviewStatus: status, failedContracts: [...new Set(failedContracts.filter((name) => REVIEW_FAILURE_CODES.has(name)))],
    guardApplied: guardApplied === true, fallbackKind: kind, candidateHasFactualTemplate: candidateHasFactualTemplate === true,
    outputHasFactualTemplate: outputHasFactualTemplate === true };
  const missing = [...new Set((Array.isArray(missingFields) ? missingFields : []).filter(field => REVIEW_OUTPUT_FIELDS.has(field)))].slice(0, 6);
  if (missing.length) details.missingFields = missing;
  const protocol = {};
  for (const stage of ['initial', 'corrected']) {
    const failures = Array.isArray(reviewProtocol?.[stage]) ? reviewProtocol[stage].filter(reason => REVIEW_PROTOCOL_FAILURES.has(reason)).slice(0, 3) : [];
    if (failures.length) protocol[stage] = failures;
  }
  if (Object.keys(protocol).length) details.protocol = protocol;
  if (languageDiagnostics && typeof languageDiagnostics === "object") {
    const issueTypes = new Set(["spelling", "morphology", "grammar", "punctuation", "coherence", "wrong_language", "unverifiable"]);
    const types = (items) => [...new Set((Array.isArray(items) ? items : []).filter((item) => issueTypes.has(item)))].slice(0, 4);
    details.languageReview = {
      status: REVIEW_STATUSES.has(languageDiagnostics.languageReviewStatus) ? languageDiagnostics.languageReviewStatus : "not_run",
      issues: types(languageDiagnostics.languageIssueTypes),
      repair: ["not_attempted", "failed", "timeout", "accepted", "rejected"].includes(languageDiagnostics.repairState) ? languageDiagnostics.repairState : "not_attempted",
      initialIssues: types(languageDiagnostics.initialLanguageIssueTypes),
    };
    const languageProtocolFailures = LANGUAGE_REVIEW_PROTOCOL_FAILURES;
    const finiteConfidence = score => Number.isFinite(score) && score >= 0 && score <= 1;
    if (finiteConfidence(languageDiagnostics.languageConfidence)) details.languageReview.confidence = languageDiagnostics.languageConfidence;
    if (languageProtocolFailures.has(languageDiagnostics.languageProtocolFailure)) details.languageReview.protocol = languageDiagnostics.languageProtocolFailure;
    if (languageDiagnostics.repairKind === "regeneration") {
      details.regeneration = { attempts: 1, state: details.languageReview.repair,
        initialStatus: REVIEW_STATUSES.has(languageDiagnostics.initialReviewStatus) ? languageDiagnostics.initialReviewStatus : "unavailable" };
      if (["conversation", "clarification", "product_clarification"].includes(languageDiagnostics.repairPurpose)) details.regeneration.purpose = languageDiagnostics.repairPurpose;
      if (finiteConfidence(languageDiagnostics.initialLanguageConfidence)) details.regeneration.initialConfidence = languageDiagnostics.initialLanguageConfidence;
      if (languageProtocolFailures.has(languageDiagnostics.initialLanguageProtocolFailure)) details.regeneration.initialProtocol = languageDiagnostics.initialLanguageProtocolFailure;
    }
    if (LANGUAGE_REPAIR_SKIP_REASONS.has(languageDiagnostics.repairSkipReason)) details.languageReview.skip = languageDiagnostics.repairSkipReason;
    if (REVIEW_STATUSES.has(languageDiagnostics.primaryReviewStatus)) details.languageReview.primary = languageDiagnostics.primaryReviewStatus;
    if (["none", "minor", "major"].includes(languageDiagnostics.languageSeverity)) details.languageReview.severity = languageDiagnostics.languageSeverity;
    const repairFailures = new Set(["invalid_assessment", "ineligible", "unavailable", "input_limit", "invalid_json", "no_candidate", "invalid_shape", "control_tags", "local_quality_block", "local_quality_unresolved", "no_change", "provider_timeout", "provider_error", "image_state_changed"]);
    if (repairFailures.has(languageDiagnostics.repairFailureCode)) details.languageReview.reason = languageDiagnostics.repairFailureCode;
    if (["grounded", "image"].includes(languageDiagnostics.repairKind)) details.replyRepair = { kind: languageDiagnostics.repairKind,
      initialFailures: [...new Set((Array.isArray(languageDiagnostics.initialFailedContracts) ? languageDiagnostics.initialFailedContracts : [])
        .filter(name => REVIEW_FAILURE_CODES.has(name)))].slice(0, languageDiagnostics.repairKind === "image" ? 2 : 6), state: details.languageReview.repair,
      ...(languageDiagnostics.repairKind === "image" ? { attempts: languageDiagnostics.imageRecoveryAttempts === 1 ? 1 : 0,
        ...(repairFailures.has(languageDiagnostics.repairFailureCode) ? { reason: languageDiagnostics.repairFailureCode } : {}) } : {}) };
    // Preserve the finite recovery cause before optional verbosity; never persist issue spans.
    if ((details.regeneration || details.replyRepair?.kind === "image") && JSON.stringify(details).length > 500) {
      delete details.candidateHasFactualTemplate;
      delete details.outputHasFactualTemplate;
      delete details.languageReview.initialIssues;
      delete details.languageReview.issues;
    }
    // Preserve valid JSON in the existing VARCHAR(500); never persist issue spans.
    while (JSON.stringify(details).length > 500 && details.languageReview.initialIssues?.length) details.languageReview.initialIssues.pop();
    while (JSON.stringify(details).length > 500 && details.languageReview.issues?.length) details.languageReview.issues.pop();
    if (JSON.stringify(details).length > 500) delete details.languageReview.initialIssues;
    if (JSON.stringify(details).length > 500) delete details.languageReview.issues;
    if (JSON.stringify(details).length > 500) delete details.languageReview.reason;
    if (JSON.stringify(details).length > 500) delete details.languageReview.severity;
    if (JSON.stringify(details).length > 500) delete details.missingFields;
    if (JSON.stringify(details).length > 500) delete details.languageReview;
    if (JSON.stringify(details).length > 500) delete details.replyRepair;
  }
  if (JSON.stringify(details).length > 500) delete details.missingFields;
  if (JSON.stringify(details).length > 500) delete details.replyRepair;
  if (JSON.stringify(details).length > 500) delete details.languageReview;
  if (JSON.stringify(details).length > 500) delete details.protocol;
  while (JSON.stringify(details).length > 500 && details.failedContracts.length > 1) details.failedContracts.pop();
  return { requestId: safeIdentifier(logContext.requestId), sessionId: safeIdentifier(logContext.sessionId),
    characterId: safeIdentifier(logContext.characterId), userId: safeIdentifier(logContext.userId), provider: "review",
    sourceType: "reply_review", sourceRef: "reply-boundary-policy", status: guardApplied ? "fallback" : "success",
    degraded: guardApplied === true, degradationReason: guardApplied ? `review_${status}` : "",
    outputChars: normalizePositiveInt(outputChars), errorMessage: JSON.stringify(details) };
}

export async function recordReplyReviewLog(payload = {}) {
  if (!SERVER_CONFIG.runtime.providerLogWriteEnabled) return;
  const event = buildReplyReviewLogEvent(payload);
  // A diagnostic without the originating input/session would repeat the old ambiguity.
  if (!event.requestId || !event.sessionId) return;
  await writeAiReplyLog(event);
}

// One finite result per image entry attempt; no prompts, user text, URLs or raw errors.
export function buildImageDecisionLogEvent({ session = {}, guest = {}, character = {}, userMessage = {}, userId = "", jevDecision = null, imageDecision = null, result = null, decision = null, skipImageGeneration = false, failed = false } = {}) {
  const intents = new Set(["none", "library_photo", "explicit_generation", "try_on", "group_photo", "image_inspection", "disallowed"]);
  const intent = value => intents.has(value) ? value : "none";
  const score = value => Number.isFinite(value) && value >= 0 && value <= 1 ? Math.round(value * 1000) / 1000 : null;
  const trigger = result?.trigger || decision?.trigger || imageDecision || {};
  const message = result?.message || (result?.contentType ? result : null);
  const reason = skipImageGeneration ? "product_image_card" : ["quota_exhausted", "active_generation", "disallowed_request", "image_task_created", "appearance_uncertain"].includes(result?.reason || decision?.reason) ? result?.reason || decision.reason : "";
  const failure = ["timeout", "invalid_json", "provider_error", "not_configured"].includes(trigger.classificationFailure) ? trigger.classificationFailure : "";
  const classification = ["accepted", "model_no_intent", "low_confidence", "grounding_rejected"].includes(trigger.classificationOutcome) ? trigger.classificationOutcome : "";
  const requestScope = ["image_only", "mixed", "unknown"].includes(trigger.requestScope) ? trigger.requestScope : "";
  const details = { jev: { ok: jevDecision?.ok === true, intent: intent(jevDecision?.imageIntent), confidence: score(jevDecision?.confidence) },
    image: { intent: intent(trigger.intentType), allowed: trigger.allowed === true, confidence: score(trigger.confidence),
      source: ["jev", "classifier"].includes(trigger.detectionSource) ? trigger.detectionSource : "deterministic", ...(failure ? { failure } : {}), ...(classification ? { classification, proposedIntent: intent(trigger.classificationIntent) } : {}), ...(requestScope ? { requestScope } : {}) },
    outcome: failed ? "error" : skipImageGeneration ? "skipped" : message?.contentType === "mascot_library_image" ? "library_prepared" : message ? "generation_prepared" : reason ? "blocked" : trigger.hasIntent ? "not_created" : "not_requested",
    reason, messageId: safeIdentifier(message?.id) };
  return { requestId: safeIdentifier(userMessage?.id), sessionId: safeIdentifier(session.id || guest.chat_session_id),
    characterId: safeIdentifier(character.id || session.character_id), userId: safeIdentifier(userId || session.internal_uid), provider: "image",
    sourceType: "image_decision", sourceRef: "image-turn-result", status: failed ? "error" : "success",
    errorMessage: JSON.stringify(details) };
}

export async function recordImageDecisionLog(payload = {}) {
  if (!SERVER_CONFIG.runtime.providerLogWriteEnabled) return;
  const event = buildImageDecisionLogEvent(payload);
  if (event.requestId && event.sessionId) await writeAiReplyLog(event);
}

export function resolveProviderLogLabel(provider = "", baseUrl = "") {
  const normalizedProvider = normalizeString(provider).toLowerCase();
  let hostname = "";
  try { hostname = new URL(baseUrl).hostname.toLowerCase(); } catch {}
  if (hostname.endsWith("clclapi.com")) return "clcl";
  if (hostname.endsWith("venice.ai")) return "venice";
  if (hostname.endsWith("openai.com")) return "openai";
  if (hostname.endsWith("deepseek.com")) return "deepseek";
  if (hostname.endsWith("elevenlabs.io")) return "elevenlabs";
  if (hostname.endsWith("search.brave.com")) return "brave";
  return normalizedProvider || "unknown";
}

async function writeAiReplyLog(payload = {}) {

  try {
    await getDbPool().execute(
      `INSERT INTO ai_reply_logs (
         request_id, internal_uid, session_id, character_id, provider, model, base_url,
         status, source_type, source_ref, degraded, degradation_reason, duration_ms,
         prompt_layer_count, prompt_message_count, system_prompt_chars, input_chars,
         output_chars, error_message
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        normalizeString(payload.requestId) || createId("ai_log"),
        normalizeString(payload.userId) || null,
        normalizeString(payload.sessionId) || null,
        normalizeString(payload.characterId) || null,
        resolveProviderLogLabel(payload.provider, payload.baseUrl),
        normalizeString(payload.model) || null,
        normalizeSafeBaseUrl(payload.baseUrl) || null,
        normalizeStatus(payload.status),
        normalizeString(payload.sourceType) || null,
        normalizeString(payload.sourceRef) || null,
        payload.degraded ? 1 : 0,
        normalizeString(payload.degradationReason) || null,
        normalizePositiveInt(payload.durationMs),
        normalizePositiveInt(payload.promptLayerCount) || 0,
        normalizePositiveInt(payload.promptMessageCount) || 0,
        normalizePositiveInt(payload.systemPromptChars) || 0,
        normalizePositiveInt(payload.inputChars) || 0,
        normalizePositiveInt(payload.outputChars) || 0,
        normalizeString(payload.errorMessage).slice(0, 500) || null,
      ]
    );
  } catch (error) {
    console.warn("[aiove] AI reply log write failed:", error.message);
  }
}

export async function listAdminErrorLogs({
  level = "all",
  limit = DEFAULT_LIMIT,
  page = DEFAULT_PAGE,
  type = "all",
  source = "all",
  startDate = "",
  endDate = "",
} = {}) {
  const normalizedLevel = normalizeLevel(level);
  const normalizedLimit = Math.min(Math.max(Number(limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  const normalizedPage = Math.max(Number(page) || DEFAULT_PAGE, 1);
  const offset = (normalizedPage - 1) * normalizedLimit;
  const filters = buildAdminLogFilters({ level: normalizedLevel, type, source, startDate, endDate });
  const unionSql = adminErrorLogUnionSql();

  const [countRows] = await getDbPool().execute(
    `SELECT COUNT(*) AS total FROM (${unionSql}) merged ${filters.whereClause}`,
    filters.params
  );
  const total = Number(countRows[0]?.total || 0);
  const pages = Math.max(1, Math.ceil(total / normalizedLimit));
  const safePage = Math.min(normalizedPage, pages);
  const safeOffset = (safePage - 1) * normalizedLimit;

  const [rows] = await getDbPool().execute(
    `SELECT * FROM (${unionSql}) merged ${filters.whereClause} ORDER BY created_at DESC, sort_id DESC LIMIT ${normalizedLimit} OFFSET ${safeOffset}`,
    filters.params
  );
  const [facetRows] = await getDbPool().execute(
    `SELECT log_type, source_label FROM (${unionSql}) merged ${filters.facetWhereClause} ORDER BY source_label ASC LIMIT 500`,
    filters.facetParams
  );

  return {
    ok: true,
    items: rows.map(mapUnifiedLogRow),
    page: safePage,
    pages,
    total,
    limit: normalizedLimit,
    filters: buildLogFilterOptions(facetRows),
  };
}

export function buildPromptLogMeta(promptContext = {}) {
  const messages = Array.isArray(promptContext.messages) ? promptContext.messages : [];
  return {
    promptLayerCount: Array.isArray(promptContext.layers) ? promptContext.layers.length : 0,
    promptMessageCount: messages.length,
    systemPromptChars: normalizeString(promptContext.systemPrompt).length,
    inputChars: messages.reduce((sum, message) => sum + normalizeString(message?.content).length, 0),
  };
}

function adminErrorLogUnionSql() {
  return `
    SELECT
      CAST(id AS CHAR) AS id,
      id AS sort_id,
      'ai_reply' AS log_type,
      CASE WHEN status IN ('error', 'quality_block', 'provider_error') THEN 'ERROR' WHEN status IN ('fallback', 'quality_warn') THEN 'WARN' ELSE 'INFO' END AS level,
      status AS status,
      status AS type,
      COALESCE(NULLIF(provider, ''), NULLIF(source_ref, ''), 'AI') AS source_label,
      request_id AS request_id,
      internal_uid AS user_id,
      session_id AS session_id,
      character_id AS character_id,
      provider AS provider,
      model AS model,
      base_url AS base_url,
      source_type AS source_type,
      source_ref AS source_ref,
      degraded AS degraded,
      degradation_reason AS degradation_reason,
      duration_ms AS duration_ms,
      prompt_layer_count AS prompt_layer_count,
      prompt_message_count AS prompt_message_count,
      system_prompt_chars AS system_prompt_chars,
      input_chars AS input_chars,
      output_chars AS output_chars,
      error_message AS error_message,
      NULL AS action,
      NULL AS status_code,
      NULL AS safe_message,
      NULL AS page,
      NULL AS endpoint,
      NULL AS method,
      created_at AS created_at
    FROM ai_reply_logs
    WHERE status IN ('provider_success', 'provider_error', 'fallback', 'error', 'quality_warn', 'quality_block')
       OR (status = 'success' AND source_type = 'commerce' AND source_ref = 'commerce-decision')
    UNION ALL
    SELECT
      id AS id,
      0 AS sort_id,
      'app' AS log_type,
      CASE WHEN status_code = 429 THEN 'WARN' WHEN level IN ('critical', 'error') THEN 'ERROR' WHEN level = 'warning' THEN 'WARN' ELSE 'INFO' END AS level,
      level AS status,
      error_type AS type,
      COALESCE(NULLIF(source, ''), 'server') AS source_label,
      request_id AS request_id,
      internal_uid AS user_id,
      NULL AS session_id,
      NULL AS character_id,
      NULL AS provider,
      NULL AS model,
      NULL AS base_url,
      source AS source_type,
      source AS source_ref,
      0 AS degraded,
      NULL AS degradation_reason,
      NULL AS duration_ms,
      0 AS prompt_layer_count,
      0 AS prompt_message_count,
      0 AS system_prompt_chars,
      0 AS input_chars,
      0 AS output_chars,
      COALESCE(raw_message, safe_message) AS error_message,
      action AS action,
      status_code AS status_code,
      safe_message AS safe_message,
      page AS page,
      endpoint AS endpoint,
      request_method AS method,
      created_at AS created_at
    FROM app_error_logs
    WHERE level IN ('warning', 'error', 'critical')
      AND (status_code IS NULL OR status_code = 429 OR status_code >= 500)
  `;
}

function buildAdminLogFilters({ level, type, source, startDate, endDate }) {
  const conditions = [];
  const params = [];
  const facetConditions = [];
  const facetParams = [];
  const add = (condition, value) => {
    conditions.push(condition);
    params.push(value);
    facetConditions.push(condition);
    facetParams.push(value);
  };

  if (level === "error") add("level = ?", "ERROR");
  if (level === "warn") add("level = ?", "WARN");

  const normalizedType = normalizeTypeFilter(type);
  if (normalizedType) add("log_type = ?", normalizedType);

  const normalizedStart = normalizeDateStart(startDate);
  if (normalizedStart) add("created_at >= ?", normalizedStart);

  const normalizedEnd = normalizeDateEnd(endDate);
  if (normalizedEnd) add("created_at < ?", normalizedEnd);

  const normalizedSource = normalizeFilterValue(source);
  if (normalizedSource) {
    conditions.push("source_label = ?");
    params.push(normalizedSource);
  }

  return {
    whereClause: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "",
    params,
    facetWhereClause: facetConditions.length ? `WHERE ${facetConditions.join(" AND ")}` : "",
    facetParams,
  };
}

function mapUnifiedLogRow(row) {
  return {
    id: row.id,
    logType: row.log_type,
    level: row.level || "INFO",
    status: row.status || "",
    type: row.type || "",
    source: row.source_label || "",
    sourceRef: row.source_ref || "",
    sourceType: row.source_type || "",
    requestId: row.request_id || "",
    userId: row.user_id || "",
    sessionId: row.session_id || "",
    characterId: row.character_id || "",
    provider: row.provider || "",
    model: row.model || "",
    baseUrl: row.base_url || "",
    degraded: Boolean(row.degraded),
    degradationReason: row.degradation_reason || "",
    durationMs: Number(row.duration_ms || 0),
    promptLayerCount: Number(row.prompt_layer_count || 0),
    promptMessageCount: Number(row.prompt_message_count || 0),
    systemPromptChars: Number(row.system_prompt_chars || 0),
    inputChars: Number(row.input_chars || 0),
    outputChars: Number(row.output_chars || 0),
    errorMessage: row.error_message || row.safe_message || "",
    safeMessage: row.safe_message || "",
    action: row.action || "",
    statusCode: row.status_code ? Number(row.status_code) : null,
    page: row.page || "",
    endpoint: row.endpoint || "",
    method: row.method || "",
    createdAt: row.created_at,
  };
}

function buildLogFilterOptions(rows = []) {
  const sources = Array.from(new Set(rows.map((row) => normalizeString(row.source_label)).filter(Boolean))).sort((left, right) => left.localeCompare(right));
  return {
    types: [["all", "全部类型"], ["app", "应用异常"], ["ai_reply", "AI 调用"]],
    sources: [["all", "全部来源"], ...sources.map((item) => [item, item])],
  };
}

function mapStatusToLevel(status) {
  if (status === "error" || status === "quality_block" || status === "provider_error") return "ERROR";
  if (status === "fallback" || status === "quality_warn") return "WARN";
  return "INFO";
}

function normalizeLevel(level) {
  const normalized = normalizeString(level).toLowerCase();
  return ["all", "error", "warn"].includes(normalized) ? normalized : "all";
}

function normalizeTypeFilter(type) {
  const normalized = normalizeString(type).toLowerCase();
  if (normalized === "app") return "app";
  if (normalized === "ai" || normalized === "ai_reply") return "ai_reply";
  return "";
}

function normalizeFilterValue(value) {
  const normalized = normalizeString(value);
  return !normalized || normalized === "all" ? "" : normalized.slice(0, 128);
}

function normalizeDateStart(value) {
  const normalized = normalizeDateOnly(value);
  return normalized ? `${normalized} 00:00:00` : "";
}

function normalizeDateEnd(value) {
  const normalized = normalizeDateOnly(value);
  if (!normalized) return "";
  const date = new Date(`${normalized}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return "";
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10) + " 00:00:00";
}

function normalizeDateOnly(value) {
  const normalized = normalizeString(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : "";
}

function normalizeStatus(status) {
  const normalized = normalizeString(status).toLowerCase();
  return ["success", "provider_success", "provider_error", "fallback", "error", "quality_warn", "quality_block"].includes(normalized) ? normalized : "fallback";
}

function normalizeSafeBaseUrl(value = "") {
  try {
    const url = new URL(String(value || "").trim());
    return `${url.origin}${url.pathname}`.slice(0, 255);
  } catch {
    return "";
  }
}

function resolveProviderFailureReason(error = null) {
  const statusCode = Number(error?.statusCode || error?.status || 0);
  if (error?.code === "IMAGE_PROVIDER_BLURRED") return "image_blurred";
  if (error?.code === "AI_REPLY_TIMEOUT" || error?.name === "AbortError") return "timeout";
  if (error?.code === "AI_REPLY_NETWORK_ERROR") return "network";
  if (error?.code === "AI_REPLY_PROTOCOL_ERROR") return "protocol";
  if (error?.code === "AI_JSON_PARSE_ERROR") return "json_parse";
  if (error?.code === "AI_JSON_INVALID_OUTPUT") return error.aiJsonProtocolKind === 'evidence' ? 'json_evidence' : 'json_shape';
  if (statusCode) return `http_${statusCode}`;
  return "request_failed";
}

function formatProviderFailureMessage(error = null) {
  const statusCode = Number(error?.statusCode || error?.status || 0);
  const reason = resolveProviderFailureReason(error);
  const retryCount = Math.max(0, Number(error?.retryCount || 0));
  return `provider_call_failed; reason=${reason}; HTTP=${statusCode || "n/a"}${retryCount ? `; retries=${retryCount}` : ""}${formatRateLimitDetails(error)}${formatProtocolDetails(error)}${formatImageProviderDetails(error)}`;
}

function normalizePositiveInt(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  return Math.round(number);
}

function normalizeString(value) {
  return String(value == null ? "" : value).trim();
}
