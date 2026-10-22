import { MAX_AI_REPLY_REQUEST_ATTEMPTS, AI_REPLY_RETRY_DELAY_MS } from "./ai-reply-request-policy.js";
import { SERVER_CONFIG } from "./config.js";
import { buildPromptLogMeta, buildProviderAttemptLogEvent, recordAiReplyLog } from "./ai-reply-log-service.js";
import { inspectAiReplyQuality } from "./ai-reply-quality-service.js";
import { createId } from "./security.js";
import { normalizeReplyText, parseStructuredReply } from "./ai-reply-contract-service.js";
import { buildErrorReplyMeta, buildFallbackChatReply, buildFallbackReplyResult, buildVoiceFallbackMeta } from "./ai-reply-fallback-service.js";
import { isOpenAiReplyConfigured, isRetryableAiReplyTransportError, shouldFallbackAiReplyProvider, requestOpenAiReply } from "./ai-reply-provider-service.js";
import { applyContextualEmotionTags } from "./tts-emotion-routing-service.js";

const AI_REPLY_MIN_ATTEMPT_TIMEOUT_MS = 1000;

export { appendStructuredReplyInstructions, normalizeReplyVoiceMeta } from "./ai-reply-contract-service.js";
export { buildFallbackChatReply } from "./ai-reply-fallback-service.js";

export async function generateChatReply({ promptContext, userText, logContext = {}, regeneration = false, regenerationProvider = null, regenerationUseAlternateProvider = false, deferIdentityToBoundaryReview = false }) {
  return generateChatReplyWithRequest({
    promptContext,
    userText,
    logContext,
    requestReplyText: requestOpenAiReply,
    recordReplyLogFn: recordReplyLog,
    useConfiguredModelFallback: true,
    regeneration, regenerationProvider, regenerationUseAlternateProvider, deferIdentityToBoundaryReview,
  });
}

export async function generateChatReplyWithRequest({
  promptContext,
  userText,
  logContext = {},
  requestReplyText = requestOpenAiReply,
  recordReplyLogFn = recordReplyLog,
  useConfiguredModelFallback = requestReplyText === requestOpenAiReply,
  regeneration = false,
  regenerationProvider = null,
  regenerationUseAlternateProvider = false,
  deferIdentityToBoundaryReview = false,
} = {}) {
  const startedAt = Date.now();
  const requestId = createId("ai_req");
  const promptMeta = buildPromptLogMeta(promptContext);

  if (!isOpenAiReplyConfigured()) {
    await recordReplyLogFn({
      requestId,
      logContext,
      promptMeta,
      reply: buildErrorReplyMeta("openai_not_configured"),
      status: "error",
      startedAt,
      errorMessage: "AI reply service is not configured",
    });
    throw createReplyError("AI reply service is not configured");
  }

  try {
    const voiceFallbackMeta = buildVoiceFallbackMeta(logContext);
    // Recovery selects one logical fresh candidate with a bounded transport chain.
    const configuredModels = (SERVER_CONFIG.aiReply.replyChain || []).filter(model => model?.apiKey && model?.model);
    const originalRegenerationModel = configuredModels.find(model => model.model === regenerationProvider?.aiModel
      && model.baseUrl === regenerationProvider?.aiBaseUrl) || configuredModels[0] || SERVER_CONFIG.aiReply.openai;
    const alternateRegenerationModels = [SERVER_CONFIG.aiReply.fallbackOpenai, ...configuredModels];
    const regenerationModel = regeneration && regenerationUseAlternateProvider
      ? alternateRegenerationModels.find(model => model?.apiKey && model?.model
        && (model.model !== originalRegenerationModel.model || model.baseUrl !== originalRegenerationModel.baseUrl)) || originalRegenerationModel
      : originalRegenerationModel;
    // One logical regeneration; transport/protocol failure may use one other
    // configured model, never retry the same model or start another review cycle.
    const recoveryAlternates = configuredModels.filter(model => model.model !== regenerationModel.model || model.baseUrl !== regenerationModel.baseUrl);
    const recoveryBackup = recoveryAlternates.find(model => model.model !== originalRegenerationModel.model || model.baseUrl !== originalRegenerationModel.baseUrl)
      || recoveryAlternates[0];
    const recoveryProviders = [regenerationModel, recoveryBackup].filter(Boolean);
    const replyRequest = regeneration ? await requestReplyWithProviderFallback(requestReplyText, promptContext, {
      providerConfigs: recoveryProviders, providerTimeoutMs: SERVER_CONFIG.aiReply.chatTimeouts.generation, maxAttempts: recoveryProviders.length,
      requestOptions: { sourceRef: "chat-reply-regeneration" },
      validateReply: candidateText => validateAiReplyCandidate({ candidateText, userText, voiceFallbackMeta }),
      onProviderEvent: async event => recordReplyLogFn({ requestId, logContext, promptMeta, ...buildProviderAttemptLogEvent(event) }),
    }) : useConfiguredModelFallback
      ? await requestReplyWithProviderFallback(requestReplyText, promptContext, {
        providerTimeoutMs: SERVER_CONFIG.aiReply.chatTimeouts.generation,
        onProviderEvent: async (event) => recordReplyLogFn({
          requestId, logContext, promptMeta,
          ...buildProviderAttemptLogEvent(event),
        }),
        validateReply: (candidateText) => validateAiReplyCandidate({
          candidateText,
          userText,
          voiceFallbackMeta,
        }),
      })
      : {
        text: await requestReplyWithRetryBudget(requestReplyText, promptContext, {
          validateReply: (candidateText) => validateAiReplyCandidate({
            candidateText,
            userText,
            voiceFallbackMeta,
          }),
        }),
      };
    const text = replyRequest.text;
    const { structuredReply, replyVoiceMeta, normalizedText, truncated } = parseStructuredReply(text, voiceFallbackMeta);
    if (!normalizedText) {
      throw markAiAttemptFailure(createReplyError("AI reply was empty"), {
        attemptCount: 0,
        reason: "empty_ai_reply",
        startedAt,
      });
    }
    if (truncated) {
      throw markAiAttemptFailure(createReplyError("AI reply exceeded the visible length limit"), {
        attemptCount: 0,
        reason: "reply_too_long",
        startedAt,
      });
    }

    const emotionAligned = applyContextualEmotionTags({
      speechText: structuredReply.speechText,
      displayText: normalizedText,
      userText,
      sourceType: "ai",
    });
    const reply = {
      text: emotionAligned.displayText,
      displayText: emotionAligned.displayText,
      speechText: emotionAligned.speechText,
      voiceMeta: replyVoiceMeta,
      structured: structuredReply.structured,
      sourceType: "ai",
      sourceRef: resolveAiReplySourceRef(replyRequest.providerId),
      aiProvider: replyRequest.providerId || "openai",
      aiModel: replyRequest.model || SERVER_CONFIG.aiReply.openai.model,
      aiBaseUrl: replyRequest.baseUrl || SERVER_CONFIG.aiReply.openai.baseUrl,
      degraded: false,
      degradationReason: "",
    };
    const qualityResult = inspectAiReplyQuality({
      text: reply.text,
      deferIdentityToBoundaryReview,
      userText,
      language: logContext.languageCode || logContext.languageLabel || logContext.languagePreference || "en",
    });

    if (qualityResult.severity === "block") {
      const guardedReply = {
        text: qualityResult.finalText,
        displayText: qualityResult.finalText,
        speechText: applyContextualEmotionTags({
          speechText: qualityResult.finalText,
          displayText: qualityResult.finalText,
          userText,
          sourceType: "system",
        }).speechText,
        voiceMeta: reply.voiceMeta,
        structured: reply.structured,
        sourceType: "system",
        sourceRef: "quality-guard",
        degraded: true,
        degradationReason: qualityResult.reasons.join(","),
      };
      await recordReplyLogFn({
        requestId,
        logContext,
        promptMeta,
        reply: guardedReply,
        status: "quality_block",
        startedAt,
        errorMessage: qualityResult.reasons.join(","),
      });
      return guardedReply;
    }

    if (qualityResult.severity === "warn") {
      const guardedReply = {
        ...reply,
        text: qualityResult.finalText || reply.text,
        displayText: qualityResult.finalText || reply.displayText,
        speechText: applyContextualEmotionTags({
          speechText: qualityResult.finalText || reply.displayText,
          displayText: qualityResult.finalText || reply.displayText,
          userText,
          sourceType: reply.sourceType,
        }).speechText,
        degraded: true,
        degradationReason: qualityResult.reasons.join(","),
      };
      await recordReplyLogFn({
        requestId,
        logContext,
        promptMeta,
        reply: guardedReply,
        status: "quality_warn",
        startedAt,
        errorMessage: qualityResult.reasons.join(","),
      });
      return guardedReply;
    }

    return reply;
  } catch (error) {
    if (error.logged) {
      throw error;
    }
    console.warn("[aiove] AI reply failed:", error.message);
    const fallbackReply = buildFallbackReplyResult(userText, buildVoiceFallbackMeta(logContext), "ai_request_failed_fallback", {
      sourceRef: "ai-request-fallback",
    });
    await recordReplyLogFn({
      requestId,
      logContext,
      promptMeta,
      reply: fallbackReply,
      status: "fallback",
      startedAt,
      errorMessage: formatAiRequestFailureLogMessage(error),
    });
    return fallbackReply;
  }
}

export async function requestReplyWithRetryBudget(requestReplyText, promptContext, {
  timeoutMs = SERVER_CONFIG.aiReply.openai.timeoutMs,
  sleepFn = sleep,
  nowFn = Date.now,
  validateReply = defaultAiReplyValidation,
  maxAttempts = MAX_AI_REPLY_REQUEST_ATTEMPTS,
  requestOptions = {},
  onAttemptFailure = null,
} = {}) {
  const attemptTimeoutMs = Math.max(AI_REPLY_MIN_ATTEMPT_TIMEOUT_MS, Number(timeoutMs || SERVER_CONFIG.aiReply.openai.timeoutMs));
  const maximumAttempts = Math.max(1, Math.min(MAX_AI_REPLY_REQUEST_ATTEMPTS, Number(maxAttempts || MAX_AI_REPLY_REQUEST_ATTEMPTS)));
  const startedAt = nowFn();
  let lastError = null;
  let attemptCount = 0;

  while (attemptCount < maximumAttempts) {
    const attemptStartedAt = nowFn();
    try {
      const text = await requestReplyText(promptContext, { ...requestOptions, timeoutMs: attemptTimeoutMs });
      attemptCount += 1;
      const validation = normalizeAiReplyValidation(validateReply(text));
      if (validation.valid) return text;
      lastError = createAiReplyValidationError(validation.reason);
    } catch (error) {
      attemptCount += 1;
      lastError = error;
    }
    const retrying = isRetryableAiReplyTransportError(lastError) && attemptCount < maximumAttempts;
    await notifyProviderEvent(onAttemptFailure, {
      error: lastError, attempt: attemptCount, retrying, startedAt: attemptStartedAt,
    });
    if (!isRetryableAiReplyTransportError(lastError)) {
      throw markAiAttemptFailure(lastError, { attemptCount, startedAt });
    }
    if (attemptCount >= maximumAttempts) break;
    await sleepFn(AI_REPLY_RETRY_DELAY_MS);
  }
  throw markAiAttemptFailure(lastError || createReplyError("AI reply request timed out"), {
    attemptCount,
    reason: lastError?.aiFailureReason || classifyAiFailureReason(lastError),
    startedAt,
  });
}

export async function requestReplyWithModelFallback(requestReplyText, promptContext, {
  timeoutMs = SERVER_CONFIG.aiReply.openai.timeoutMs,
  sleepFn = sleep,
  nowFn = Date.now,
  validateReply = defaultAiReplyValidation,
  primaryModelConfig = SERVER_CONFIG.aiReply.openai,
  fallbackModelConfig = SERVER_CONFIG.aiReply.fallbackOpenai,
} = {}) {
  return requestReplyWithProviderFallback(requestReplyText, promptContext, {
    timeoutMs,
    sleepFn,
    nowFn,
    validateReply,
    providerConfigs: [primaryModelConfig, fallbackModelConfig],
  });
}

export async function requestReplyWithProviderFallback(requestReplyText, promptContext, {
  timeoutMs = SERVER_CONFIG.aiReply.openai.timeoutMs,
  sleepFn = sleep,
  nowFn = Date.now,
  validateReply = defaultAiReplyValidation,
  providerConfigs = SERVER_CONFIG.aiReply.replyChain,
  providerTimeoutMs = null,
  maxAttempts = MAX_AI_REPLY_REQUEST_ATTEMPTS,
  requestOptions = {},
  onProviderEvent = null,
} = {}) {
  if (providerTimeoutMs !== null && (!Number.isSafeInteger(providerTimeoutMs) || providerTimeoutMs < 1 || providerTimeoutMs > 120000))
    throw createReplyError("Invalid AI reply provider timeout policy");
  const startedAt = nowFn();
  const totalAttemptBudget = Math.max(1, Math.min(MAX_AI_REPLY_REQUEST_ATTEMPTS, Math.floor(Number(maxAttempts) || MAX_AI_REPLY_REQUEST_ATTEMPTS)));
  const configuredProviders = (Array.isArray(providerConfigs) ? providerConfigs : [])
    .filter((modelConfig) => Boolean(modelConfig?.apiKey && modelConfig?.model))
    .slice(0, totalAttemptBudget);
  if (!configuredProviders.length) {
    throw createReplyError("AI reply service is not configured");
  }

  const attemptBudgets = allocateProviderAttemptBudgets(configuredProviders.length, totalAttemptBudget);
  const modelAttemptSummaries = [];
  let totalAttempts = 0;
  let lastError = null;

  for (const [index, modelConfig] of configuredProviders.entries()) {
    try {
      const text = await requestReplyWithRetryBudget(requestReplyText, promptContext, {
        timeoutMs: providerTimeoutMs ?? (modelConfig.timeoutMs || timeoutMs),
        sleepFn,
        nowFn,
        validateReply,
        maxAttempts: attemptBudgets[index],
        requestOptions: { ...requestOptions, modelConfig },
        onAttemptFailure: (event) => notifyProviderEvent(onProviderEvent, {
          ...event, modelConfig, type: "attempt_failure",
          nextProvider: !event.retrying && shouldFallbackAiReplyProvider(event.error)
            ? configuredProviders[index + 1]?.id || "" : "",
        }),
      });
      if (index > 0) await notifyProviderEvent(onProviderEvent, {
        type: "fallback_success", modelConfig, startedAt,
        previousProviders: configuredProviders.slice(0, index).map((config) => config.id),
      });
      return {
        text,
        providerId: String(modelConfig.id || "openai").trim() || "openai",
        model: modelConfig.model,
        baseUrl: modelConfig.baseUrl,
      };
    } catch (error) {
      const attempts = resolveAiAttemptCount(error);
      totalAttempts += attempts;
      modelAttemptSummaries.push(formatAiModelAttemptSummary(modelConfig.model, attempts));
      lastError = error;
      if (!shouldFallbackAiReplyProvider(error)) {
        error.aiModelAttemptSummary = modelAttemptSummaries.join(",");
        throw error;
      }
    }
  }

  const terminalError = lastError || createReplyError("AI reply request timed out");
  terminalError.aiModelAttemptSummary = modelAttemptSummaries.join(",");
  throw markAiAttemptFailure(terminalError, {
    attemptCount: totalAttempts,
    startedAt,
  });
}

async function notifyProviderEvent(callback, event) {
  if (!callback) return;
  try { await callback(event); }
  catch { console.warn("[aiove] provider attempt log unavailable"); }
}

function allocateProviderAttemptBudgets(providerCount, maxAttempts = MAX_AI_REPLY_REQUEST_ATTEMPTS) {
  const total = Math.max(1, Math.min(MAX_AI_REPLY_REQUEST_ATTEMPTS, Number(maxAttempts) || MAX_AI_REPLY_REQUEST_ATTEMPTS));
  const count = Math.max(1, Math.min(MAX_AI_REPLY_REQUEST_ATTEMPTS, Number(providerCount || 1)));
  const baseAttempts = Math.floor(total / count);
  const extraAttempts = total % count;
  return Array.from({ length: count }, (_unused, index) => baseAttempts + (index < extraAttempts ? 1 : 0));
}

function resolveAiReplySourceRef(providerId = "") {
  const normalized = String(providerId || "").trim().toLowerCase();
  if (normalized === "venice") return "venice-chat-completions";
  if (normalized === "deepseek") return "deepseek-chat-completions";
  return "openai-responses";
}

function validateAiReplyCandidate({ candidateText, userText, voiceFallbackMeta }) {
  const { normalizedText, truncated } = parseStructuredReply(candidateText, voiceFallbackMeta);
  if (!normalizedText) return { valid: false, reason: "empty_ai_reply" };
  if (truncated) return { valid: false, reason: "reply_too_long" };
  const qualityResult = inspectAiReplyQuality({ text: normalizedText, userText,
    language: voiceFallbackMeta?.fallbackLanguageCode || voiceFallbackMeta?.fallbackLanguageLabel || "en" });
  if (qualityResult.reasons.includes("incomplete_ending")) {
    return { valid: false, reason: "incomplete_ending" };
  }
  // An unreadable output envelope is a generation failure, not a semantic
  // verdict about the product. Recover within the existing attempt budget;
  // security refusals still end at the quality guard without another verdict.
  if (qualityResult.severity === "block" && qualityResult.reasons.includes("structured_reply_leak")
    && !qualityResult.reasons.some(reason => ["internal_info_leak", "assistant_self_exposure"].includes(reason))) {
    return { valid: false, reason: "structured_reply_leak" };
  }
  return { valid: true };
}

function defaultAiReplyValidation(candidateText) {
  const { normalizedText, truncated } = parseStructuredReply(candidateText);
  return {
    valid: Boolean(normalizedText) && !truncated,
    reason: !normalizedText ? "empty_ai_reply" : truncated ? "reply_too_long" : "",
  };
}

function normalizeAiReplyValidation(result) {
  return result && typeof result === "object" && result.valid === true
    ? { valid: true, reason: "" }
    : { valid: false, reason: String(result?.reason || "invalid_ai_reply") };
}

function createAiReplyValidationError(reason = "invalid_ai_reply") {
  const error = createReplyError(`AI reply failed validation: ${reason}`);
  error.retryable = true;
  error.aiFailureReason = reason;
  return error;
}

function markAiAttemptFailure(error, { attemptCount, reason = "", startedAt = 0 } = {}) {
  const target = error instanceof Error ? error : new Error(String(error || "AI reply request failed"));
  target.aiAttemptCount = Math.max(0, Number(attemptCount || 0));
  target.aiFailureReason = reason || target.aiFailureReason || classifyAiFailureReason(target);
  target.aiElapsedMs = Math.max(0, Date.now() - Number(startedAt || Date.now()));
  return target;
}

function resolveAiAttemptCount(error) {
  return Math.max(0, Number(error?.aiAttemptCount || 0));
}

function formatAiModelAttemptSummary(model, attempts) {
  return `${String(model || "unknown").trim() || "unknown"}:${Math.max(0, Number(attempts || 0))}`;
}

function formatAiRequestFailureLogMessage(error) {
  const message = String(error?.message || "AI reply request failed").trim();
  const attempts = Math.max(0, Number(error?.aiAttemptCount || 0));
  const reason = String(error?.aiFailureReason || classifyAiFailureReason(error));
  const elapsedMs = Math.max(0, Number(error?.aiElapsedMs || 0));
  const modelAttempts = String(error?.aiModelAttemptSummary || "").trim();
  const modelSuffix = modelAttempts ? `, modelAttempts=${modelAttempts}` : "";
  return `${reason}: ${message} (attempts=${attempts}/${MAX_AI_REPLY_REQUEST_ATTEMPTS}, elapsedMs=${elapsedMs}${modelSuffix})`;
}

function classifyAiFailureReason(error) {
  const statusCode = Number(error?.statusCode || 0);
  if (statusCode === 408) return "http_408";
  if (statusCode === 429) return "http_429";
  if (statusCode >= 500) return "http_5xx";
  if (error?.code === "AI_REPLY_TIMEOUT") return "timeout";
  if (isRetryableAiReplyTransportError(error)) return "network";
  return "nonretryable_request_error";
}

function sleep(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(delayMs || 0))));
}

function createReplyError(message, { logged = false } = {}) {
  const error = new Error(message || "AI request failed");
  error.statusCode = 502;
  error.logged = logged;
  return error;
}

async function recordReplyLog({ requestId, logContext, promptMeta, reply, status, startedAt, errorMessage = "" }) {
  await recordAiReplyLog({
    requestId,
    userId: logContext.userId,
    sessionId: logContext.sessionId,
    characterId: logContext.characterId,
    provider: reply.aiProvider || SERVER_CONFIG.aiReply.provider,
    model: reply.aiModel || SERVER_CONFIG.aiReply.openai.model,
    baseUrl: reply.aiBaseUrl || SERVER_CONFIG.aiReply.openai.baseUrl,
    status,
    sourceType: reply.sourceType,
    sourceRef: reply.sourceRef,
    degraded: reply.degraded,
    degradationReason: reply.degradationReason,
    durationMs: Date.now() - startedAt,
    outputChars: normalizeReplyText(reply.text).length,
    errorMessage,
    ...promptMeta,
  });
}
