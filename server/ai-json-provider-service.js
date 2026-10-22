import { SERVER_CONFIG } from "./config.js";
import { requestOpenAiText, shouldFallbackAiReplyProvider } from "./ai-reply-provider-service.js";
import { recordProviderCallLog } from "./ai-reply-log-service.js";

function configuredProviders(config) {
  // Explicit overrides stay isolated: fixtures must never reach real backups.
  const providers = config == null ? SERVER_CONFIG.aiReply.replyChain
    : Array.isArray(config) ? config : [{ id: "venice", apiMode: "chat_completions", ...config }];
  return providers.filter((provider) => Boolean(provider?.apiKey && provider?.model));
}

export function isAiJsonProviderConfigured(config = null) {
  return configuredProviders(config).length > 0;
}

// Default consumers use transport fallback only. A caller may additionally
// validate its output protocol; this must not reinterpret a semantic verdict.
// Default callers retain a total task budget. Review and commerce callers
// explicitly opt into a fresh bounded timeout for each provider.
export async function requestAiJsonWithProviderFallback(messages, {
  config = null,
  fetchImpl = fetch,
  timeoutMs = 3500,
  sourceRef = "json-classification",
  recordProviderCallFn = recordProviderCallLog,
  nowFn = Date.now,
  responseFormat = null,
  fallbackReserveMs = 0,
  perProviderTimeout = false,
  providerTimeoutMs = null,
  validateParsed = null,
} = {}) {
  const providers = configuredProviders(config);
  if (!providers.length) throw new Error("AI JSON service is not configured");
  if (typeof perProviderTimeout !== "boolean") throw new Error("Invalid AI JSON timeout policy");
  if (providerTimeoutMs !== null && (!perProviderTimeout || !Number.isSafeInteger(providerTimeoutMs) || providerTimeoutMs < 1 || providerTimeoutMs > 120000))
    throw new Error("Invalid AI JSON provider timeout policy");
  const budgetMs = Number(timeoutMs);
  if (!Number.isFinite(budgetMs) || budgetMs <= 0) throw new Error("Invalid AI JSON timeout");
  const deadline = perProviderTimeout ? null : nowFn() + budgetMs;
  // Keep separate review contracts and their original message order intact.
  const hasLeadingSystem = messages[0]?.role === "system";
  const promptContext = {
    systemPrompt: hasLeadingSystem ? messages[0].content : "",
    messages: hasLeadingSystem ? messages.slice(1) : messages,
  };
  const failures = [];
  const rememberFailure = (modelConfig, error, kind) => {
    failures.push({ provider: ["venice", "openai", "deepseek"].includes(modelConfig.id) ? modelConfig.id : "other", kind });
    error.aiJsonProviderFailures = [...failures];
    return error;
  };
  let lastError = null;
  let text;
  for (const [index, modelConfig] of providers.entries()) {
    const remainingMs = perProviderTimeout ? budgetMs : deadline - nowFn();
    if (remainingMs < 1) break;
    const providerTimeout = providerTimeoutMs ?? Number(modelConfig.timeoutMs);
    // Caller opt-in only. Preserve the original primary allocation, then divide
    // the remaining reserve among remaining backups so one cannot starve the
    // next. A valid protocol response ends the chain; the deadline never moves.
    const requestedReserve = !perProviderTimeout && Number.isFinite(Number(fallbackReserveMs)) ? Math.max(0, Number(fallbackReserveMs)) : 0;
    const providersLeft = providers.length - index;
    const reserveMs = requestedReserve > 0 && providersLeft > 1
      ? index === 0 ? Math.min(budgetMs - 1, requestedReserve)
        : remainingMs * (providersLeft - 1) / providersLeft : 0;
    const attemptBudget = Math.max(1, remainingMs - reserveMs);
    const formatExtras = responseFormat ? modelConfig.apiMode === "chat_completions"
      ? { response_format: responseFormat }
      : { text: { ...modelConfig.requestBodyExtras?.text, format: responseFormat.type === "json_schema"
        ? { type: "json_schema", ...responseFormat.json_schema } : responseFormat } } : null;
    try {
      text = await requestOpenAiText(promptContext, {
        modelConfig: formatExtras ? { ...modelConfig, requestBodyExtras: { ...modelConfig.requestBodyExtras, ...formatExtras } } : modelConfig,
        fetchImpl, jsonOutput: !responseFormat, sourceRef, recordProviderCallFn,
        timeoutMs: Math.min(attemptBudget, providerTimeout > 0 ? providerTimeout : attemptBudget),
      });
    } catch (error) {
      lastError = rememberFailure(modelConfig, error, error?.code === "AI_REPLY_TIMEOUT" ? "timeout"
        : error?.statusCode === 429 ? "http_429" : "provider");
      if (!shouldFallbackAiReplyProvider(error)) throw error;
      continue;
    }
    // Without protocol opt-in, HTTP200 retains the original terminal behavior.
    let parsed;
    try {
      parsed = JSON.parse(String(text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
    } catch {
      // Do not include upstream text (which may contain private data) in errors.
      lastError = Object.assign(new SyntaxError("AI JSON response could not be parsed"), { code: "AI_JSON_PARSE_ERROR" });
      rememberFailure(modelConfig, lastError, "parse");
      if (!validateParsed) throw lastError;
    }
    if (parsed !== undefined && validateParsed) {
      const verdict = validateParsed(parsed);
      if (verdict?.valid === true) return parsed;
      const reason = ["shape", "evidence"].includes(verdict?.reason) ? verdict.reason : "shape";
      lastError = rememberFailure(modelConfig, Object.assign(new Error(`AI JSON protocol rejected: ${reason}`), { code: "AI_JSON_INVALID_OUTPUT" }), `protocol_${reason}`);
    } else if (parsed !== undefined) {
      return parsed;
    }
    await recordProviderCallFn({ provider: modelConfig.id, model: modelConfig.model, baseUrl: modelConfig.baseUrl,
      sourceRef, status: "error", startedAt: Date.now(), error: lastError });
  }
  throw lastError || new Error("AI JSON task time budget exhausted");
}
