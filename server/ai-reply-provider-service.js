import { readChatCompletionStream } from './ai-chat-completion-stream.js';
import { SERVER_CONFIG } from "./config.js";
import { appendStructuredReplyInstructions } from "./ai-reply-contract-service.js";
import { recordProviderCallLog } from "./ai-reply-log-service.js";

const OPENAI_RESPONSES_PATH = "/responses";
const OPENAI_CHAT_COMPLETIONS_PATH = "/chat/completions";

export function isOpenAiReplyConfigured() {
  const replyChain = Array.isArray(SERVER_CONFIG.aiReply.replyChain)
    ? SERVER_CONFIG.aiReply.replyChain
    : [SERVER_CONFIG.aiReply.openai];
  return replyChain.some((modelConfig) => Boolean(modelConfig?.apiKey && modelConfig?.model));
}

export async function requestOpenAiReply(promptContext, {
  timeoutMs = SERVER_CONFIG.aiReply.openai.timeoutMs,
  modelConfig = SERVER_CONFIG.aiReply.openai,
  sourceRef = "chat-reply",
  recordProviderCallFn = recordProviderCallLog,
} = {}) {
  return requestOpenAiTextRequest(promptContext, {
    timeoutMs,
    modelConfig,
    appendStructuredOutputContract: true,
    jsonOutput: promptContext?.structuredOutput === true,
    sourceRef,
    recordProviderCallFn,
  });
}

export async function requestOpenAiText(promptContext, {
  timeoutMs = SERVER_CONFIG.aiReply.openai.timeoutMs,
  modelConfig = SERVER_CONFIG.aiReply.openai,
  sourceRef = "text-generation",
  recordProviderCallFn = recordProviderCallLog,
  fetchImpl = fetch,
  jsonOutput = false,
} = {}) {
  return requestOpenAiTextRequest(promptContext, {
    timeoutMs,
    modelConfig,
    appendStructuredOutputContract: false,
    sourceRef,
    recordProviderCallFn,
    fetchImpl,
    jsonOutput,
  });
}

async function requestOpenAiTextRequest(promptContext, {
  timeoutMs,
  modelConfig,
  appendStructuredOutputContract,
  sourceRef,
  recordProviderCallFn,
  fetchImpl = fetch,
  jsonOutput = false,
}) {
  const openAiConfig = modelConfig || SERVER_CONFIG.aiReply.openai;
  const startedAt = Date.now();
  const controller = new AbortController();
  const requestedTimeoutMs = Number(timeoutMs);
  const requestTimeoutMs = Number.isFinite(requestedTimeoutMs) && requestedTimeoutMs > 0
    ? Math.max(1, Math.floor(requestedTimeoutMs))
    : SERVER_CONFIG.aiReply.openai.timeoutMs;
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, requestTimeoutMs);

  try {
    if (openAiConfig.stream === true && openAiConfig.apiMode !== 'chat_completions')
      throw createAiReplyTransportError('AI reply streaming requires Chat Completions', { code: 'AI_REPLY_PROTOCOL_ERROR', protocolKind: 'invalid_stream' });
    const response = await fetchImpl(buildOpenAiRequestUrl(openAiConfig), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openAiConfig.apiKey}`,
      },
      body: JSON.stringify(buildOpenAiRequestBody(promptContext, openAiConfig, { appendStructuredOutputContract, jsonOutput })),
      signal: controller.signal,
    });

    const isStream = /^text\/event-stream(?:;|$)/i.test(String(response.headers?.get?.("content-type") || "").trim());
    let payload, streamedText;
    if (response.ok && isStream) {
      if (openAiConfig.stream !== true) {
        await response.body?.cancel?.().catch(() => {});
        throw createAiReplyTransportError("AI reply provider returned an unexpected stream", {
          code: "AI_REPLY_PROTOCOL_ERROR", protocolKind: "unexpected_stream",
        });
      }
      streamedText = await readChatCompletionStream(response, { signal: controller.signal });
    } else {
      payload = await response.json().catch((error) => {
        // Preserve non-2xx HTTP semantics, but a 2xx malformed envelope is not
        // an answer. Streaming is accepted only through the explicit branch above;
        // never guess text from usage events or retain an upstream body in logs.
        if (timedOut) throw error;
        if (!response.ok) return {};
        if (error?.name === "SyntaxError") throw createAiReplyTransportError("AI reply provider returned an invalid JSON envelope", {
          code: "AI_REPLY_PROTOCOL_ERROR", protocolKind: "invalid_json",
        });
        throw createAiReplyTransportError("AI reply response body could not be read", {
          code: "AI_REPLY_NETWORK_ERROR",
          retryable: true,
        });
      });
    }
    if (!response.ok) {
      const error = createAiReplyTransportError(normalizeOpenAiError(payload, response.status), {
        statusCode: response.status,
        retryable: response.status === 408 || response.status === 429 || response.status >= 500,
      });
      if (response.status === 429) error.providerRateLimit = describeProviderRateLimit(response, payload);
      throw error;
    }

    const text = streamedText ?? extractResponseText(payload);
    if (!text.trim()) throw createAiReplyTransportError("AI reply provider returned no response text", {
      code: "AI_REPLY_PROTOCOL_ERROR", protocolKind: "empty_answer",
    });
    await recordProviderCallFn({
      provider: openAiConfig.id,
      model: openAiConfig.model,
      baseUrl: openAiConfig.baseUrl,
      sourceRef,
      status: "success",
      startedAt,
    });
    return text;
  } catch (error) {
    let normalizedError = error;
    if (timedOut) {
      normalizedError = createAiReplyTransportError(`AI reply request timed out after ${requestTimeoutMs}ms`, {
        code: "AI_REPLY_TIMEOUT",
        retryable: true,
      });
    }
    if (!normalizedError?.statusCode && !normalizedError?.retryable && normalizedError?.code !== "AI_REPLY_TIMEOUT" && isNetworkTransportError(normalizedError)) {
      normalizedError = createAiReplyTransportError(normalizedError?.message || "AI reply request failed", {
        code: "AI_REPLY_NETWORK_ERROR",
        retryable: true,
      });
    }
    await recordProviderCallFn({
      provider: openAiConfig.id,
      model: openAiConfig.model,
      baseUrl: openAiConfig.baseUrl,
      sourceRef,
      status: "error",
      startedAt,
      error: normalizedError,
    });
    throw normalizedError;
  } finally {
    clearTimeout(timeout);
  }
}

export function isRetryableAiReplyTransportError(error) {
  const statusCode = Number(error?.statusCode || 0);
  if (statusCode > 0) return statusCode === 408 || statusCode === 429 || statusCode >= 500;
  if (error?.retryable === true) return true;
  return isNetworkTransportError(error);
}

export function shouldFallbackAiReplyProvider(error) {
  return Number(error?.statusCode) === 402
    || !Number(error?.statusCode) && error?.code === "AI_REPLY_PROTOCOL_ERROR"
    || isRetryableAiReplyTransportError(error);
}

function buildOpenAiRequestUrl(openAiConfig) {
  const path = openAiConfig.apiMode === "chat_completions"
    ? OPENAI_CHAT_COMPLETIONS_PATH
    : OPENAI_RESPONSES_PATH;
  return `${openAiConfig.baseUrl}${path}`;
}

function buildOpenAiRequestBody(promptContext, openAiConfig, { appendStructuredOutputContract = true, jsonOutput = false } = {}) {
  const systemPrompt = appendStructuredOutputContract
    ? appendStructuredReplyInstructions(promptContext.systemPrompt)
    : String(promptContext?.systemPrompt || "").trim();
  const requestBodyExtras = openAiConfig?.requestBodyExtras && typeof openAiConfig.requestBodyExtras === "object"
    ? openAiConfig.requestBodyExtras
    : {};
  if (openAiConfig.apiMode === "chat_completions") {
    return {
      ...requestBodyExtras,
      model: openAiConfig.model,
      stream: openAiConfig.stream === true,
      ...(jsonOutput ? { response_format: { type: "json_object" } } : {}),
      messages: [
        {
          role: "system",
          content: systemPrompt,
        },
        ...buildChatCompletionMessages(promptContext),
      ],
    };
  }

  return {
    ...requestBodyExtras,
    model: openAiConfig.model,
    stream: false,
    ...(jsonOutput ? { text: { format: { type: "json_object" } } } : {}),
    reasoning: { effort: openAiConfig.reasoningEffort },
    instructions: systemPrompt,
    input: buildResponsesInput(promptContext),
  };
}

function buildChatCompletionMessages(promptContext) {
  const messages = Array.isArray(promptContext.messages) ? promptContext.messages : [];
  const visionInputs = normalizeVisionInputs(promptContext.visionInputs);
  if (!visionInputs.length || !messages.length) return messages;

  const lastUserIndex = findLastUserMessageIndex(messages);
  if (lastUserIndex < 0) return messages;

  return messages.map((message, index) => {
    if (index !== lastUserIndex) return message;
    return {
      ...message,
      content: [
        { type: "text", text: String(message.content || "") },
        ...visionInputs.map((input) => ({
          type: "image_url",
          image_url: { url: input.dataUrl },
        })),
      ],
    };
  });
}

function buildResponsesInput(promptContext) {
  const messages = Array.isArray(promptContext.messages) ? promptContext.messages : [];
  const visionInputs = normalizeVisionInputs(promptContext.visionInputs);
  if (!visionInputs.length || !messages.length) return messages;

  const lastUserIndex = findLastUserMessageIndex(messages);
  if (lastUserIndex < 0) return messages;

  return messages.map((message, index) => {
    if (index !== lastUserIndex) return message;
    return {
      ...message,
      content: [
        { type: "input_text", text: String(message.content || "") },
        ...visionInputs.map((input) => ({
          type: "input_image",
          image_url: input.dataUrl,
        })),
      ],
    };
  });
}

function normalizeVisionInputs(visionInputs = []) {
  return (Array.isArray(visionInputs) ? visionInputs : [])
    .filter((input) => typeof input?.dataUrl === "string" && input.dataUrl.startsWith("data:image/"))
    .slice(0, 3);
}

function findLastUserMessageIndex(messages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") return index;
  }
  return -1;
}

function extractResponseText(payload) {
  const chatCompletionText = payload?.choices?.[0]?.message?.content;
  if (typeof chatCompletionText === "string") return chatCompletionText;

  if (typeof payload?.output_text === "string") return payload.output_text;

  const output = Array.isArray(payload?.output) ? payload.output : [];
  return output
    .flatMap((item) => Array.isArray(item?.content) ? item.content : [])
    .map((content) => content?.text || "")
    .filter(Boolean)
    .join("\n")
    .trim();
}

// Diagnostic categories only: never retain arbitrary upstream body text or
// headers. These facts cannot authorize a reply or change fallback behavior.
function describeProviderRateLimit(response, payload) {
  const numberHeader = name => {
    const raw = response.headers?.get?.(name);
    if (raw == null || !/^\d+$/.test(raw)) return undefined;
    const value = Number(raw);
    return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
  };
  const remainingRequests = numberHeader('x-ratelimit-remaining-requests');
  const remainingTokens = numberHeader('x-ratelimit-remaining-tokens');
  const retryAfterSeconds = numberHeader('retry-after');
  const code = String(payload?.error?.code || payload?.code || '').toUpperCase();
  const message = typeof payload?.error === 'string' ? payload.error : typeof payload?.error?.message === 'string' ? payload.error.message
    : typeof payload?.customMessage === 'string' ? payload.customMessage : typeof payload?.message === 'string' ? payload.message : '';
  const kind = ['MODEL_OVERLOADED', 'MODEL_AT_CAPACITY'].includes(code) || /model.*(?:overloaded|at capacity)/i.test(message) ? 'model_overloaded'
    : code === 'UNSUPPORTED_FEATURE_REQUESTS' || /too many.*unsupported feature/i.test(message) ? 'unsupported_features'
    : code === 'FAILED_REQUESTS' || /too many failed attempts/i.test(message) ? 'failed_requests'
    : remainingRequests === 0 ? 'requests_exhausted' : remainingTokens === 0 ? 'tokens_exhausted'
    : code === 'RATE_LIMIT_EXCEEDED' || /rate limit|too many requests/i.test(message) ? 'rate_limited' : 'unknown_429';
  return { kind, ...(remainingRequests !== undefined ? { remainingRequests } : {}),
    ...(remainingTokens !== undefined ? { remainingTokens } : {}), ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}) };
}

function normalizeOpenAiError(payload, status) {
  const message = payload?.error?.message || payload?.message || "";
  return message ? `OpenAI ${status}: ${message}` : `OpenAI request failed with status ${status}`;
}

function createAiReplyTransportError(message, { statusCode = 0, code = "", retryable = false, protocolKind = "" } = {}) {
  const error = new Error(message || "AI reply request failed");
  error.statusCode = Number(statusCode || 0) || undefined;
  error.code = code || undefined;
  error.retryable = Boolean(retryable);
  if (["unexpected_stream", "invalid_json", "empty_answer", "invalid_stream", "incomplete_stream", "stream_limit"].includes(protocolKind)) error.protocolKind = protocolKind;
  return error;
}

function isNetworkTransportError(error) {
  if (error?.name === "AbortError") return true;
  const message = String(error?.message || "").toLowerCase();
  return /fetch failed|network|socket|connection|econn|enotfound|aborted|timeout/.test(message);
}
