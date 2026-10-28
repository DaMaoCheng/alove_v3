import { SERVER_CONFIG } from "./config.js";
import { recordProviderCallLog } from "./ai-reply-log-service.js";

const SYSTEM_ONE_PATH = "/systemone";
const CACHE_TTL_MS = 15_000;
const MAX_JEV_ATTEMPTS = 2;
const MAX_JEV_REQUEST_BYTES = 64 * 1024;
const MAX_JEV_QUESTIONS = 32;
const decisionCache = new Map();
const pendingDecisions = new Map();
const referenceIds = new WeakMap();
let nextReferenceId = 0;

// One transport boundary for primary routing and domain interpretation. Only an
// exhausted transport/protocol failure grants permission to try the LLM lane;
// a valid low score/unclear choice remains a valid JEV decision.
export async function evaluateJevQuestions({ state = {}, questions = {}, configOverride = null,
  fetchImpl = fetch, forceRefresh = false, sourceRef = "jev-intent-router", logContext = {},
  validatePayload = null, recordLog = recordProviderCallLog } = {}) {
  const config = configOverride || SERVER_CONFIG.typeSafe;
  if (!config.enabled || !config.apiKey) return evaluationFailure("missing_api_key", 0);
  if (!isPlainObject(state) || !isPlainObject(questions) || !Object.keys(questions).length)
    return evaluationFailure("invalid_input", 0);
  if (Object.keys(questions).length > MAX_JEV_QUESTIONS) return evaluationFailure("invalid_input", 0);
  let serialized;
  try { serialized = JSON.stringify({ state, model: config.model, questions }); }
  catch { return evaluationFailure("invalid_input", 0); }
  // Protocol limits apply to encoded bytes of the complete request, not JS
  // characters: multilingual source spans can be several bytes per character.
  if (Buffer.byteLength(serialized, "utf8") > MAX_JEV_REQUEST_BYTES) return evaluationFailure("invalid_input", 0);
  // Provider configuration and injected transports are isolated. The credential
  // itself never appears in a cache key, diagnostic or return value.
  const key = `${referenceId(config)}|${referenceId(fetchImpl)}|${referenceId(validatePayload)}|${serialized}`;
  if (!forceRefresh) {
    const cached = readCache(key);
    if (cached) return { ...cached, cached: true };
  }
  if (pendingDecisions.has(key)) return structuredClone(await pendingDecisions.get(key));
  const pending = runJevEvaluation({ state, questions, config, fetchImpl, sourceRef, logContext, validatePayload, recordLog });
  pendingDecisions.set(key, pending);
  try {
    const result = await pending;
    // A short success cache is legacy compatibility. Failures are never cached
    // globally: a failed turn must not suppress the next turn's fresh attempts.
    if (result.ok) writeCache(key, result);
    return structuredClone(result);
  } finally { pendingDecisions.delete(key); }
}

async function runJevEvaluation({ state, questions, config, fetchImpl, sourceRef, logContext, validatePayload, recordLog }) {
  let reason = "request_failed";
  for (let attempt = 1; attempt <= MAX_JEV_ATTEMPTS; attempt++) {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timeoutMs = Number.isFinite(Number(config.timeoutMs)) && Number(config.timeoutMs) > 0 ? Number(config.timeoutMs) : 5000;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${config.baseUrl}${SYSTEM_ONE_PATH}`, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
        body: JSON.stringify({ state, model: config.model, questions }), signal: controller.signal,
      });
      if (!response.ok) throw Object.assign(new Error(`jev HTTP ${response.status}`), { statusCode: response.status });
      let payload;
      try { payload = await response.json(); } catch { throw new Error("jev invalid response JSON"); }
      const valid = validatePayload ? validatePayload(payload, questions) : validQuestionPayload(payload, questions);
      if (!valid) throw new Error("jev invalid response shape");
      await safeRecord(recordLog, { ...logContext, provider: "typesafe", model: config.model, baseUrl: config.baseUrl,
        sourceRef, status: "success", startedAt });
      return { ok: true, source: "jev", answers: payload.answers, payload, attempts: attempt,
        exhausted: false, llmFallbackAllowed: false };
    } catch (error) {
      reason = controller.signal.aborted ? "timeout" : resolveFailureReason(error);
      await safeRecord(recordLog, { ...logContext, provider: "typesafe", model: config.model, baseUrl: config.baseUrl,
        sourceRef, status: "error", startedAt, error });
    } finally { clearTimeout(timeout); }
  }
  return evaluationFailure(reason, MAX_JEV_ATTEMPTS);
}

async function safeRecord(recordLog, event) {
  // Operational logging must not turn a valid provider decision into another
  // paid call, nor leak the provider's request/response in a diagnostic.
  try { await recordLog(event); } catch { /* Provider result remains authoritative. */ }
}

function evaluationFailure(reason, attempts) {
  const exhausted = attempts === MAX_JEV_ATTEMPTS;
  return { ok: false, source: "jev_unavailable", fallbackReason: reason, attempts,
    exhausted, llmFallbackAllowed: exhausted };
}

function referenceId(value) {
  if ((typeof value !== "object" || value === null) && typeof value !== "function") return "default";
  if (!referenceIds.has(value)) referenceIds.set(value, ++nextReferenceId);
  return referenceIds.get(value);
}

function validQuestionPayload(payload, questions) {
  if (!isPlainObject(payload?.answers)) return false;
  return Object.entries(questions).every(([key, question]) => {
    const answer = payload.answers[key];
    if (!isPlainObject(answer) || answer.type && answer.type !== question.type) return false;
    if (question.type === "choice") return Object.hasOwn(question.criteria || {}, answer.choice)
      && typeof answer.confidence === "number" && Number.isFinite(answer.confidence)
      && answer.confidence >= 0 && answer.confidence <= 1;
    if (question.type === "noul") return typeof answer.noul === "number" && Number.isFinite(answer.noul) && answer.noul >= 0 && answer.noul <= 1;
    if (question.type === "score") return typeof answer.score === "number" && Number.isFinite(answer.score);
    return false;
  });
}

function resolveFailureReason(error = {}) {
  if (error?.name === "AbortError") return "timeout";
  if (Number(error?.statusCode) === 429) return "rate_limit";
  if (Number(error?.statusCode) >= 500) return "provider_error";
  if (String(error?.message || "").startsWith("jev invalid response")) return "invalid_response";
  return "request_failed";
}

function readCache(key) {
  const entry = decisionCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > CACHE_TTL_MS) {
    decisionCache.delete(key);
    return null;
  }
  return structuredClone(entry.value);
}

function writeCache(key, value) {
  decisionCache.set(key, { createdAt: Date.now(), value: structuredClone(value) });
  if (decisionCache.size > 256) {
    const oldestKey = decisionCache.keys().next().value;
    if (oldestKey) decisionCache.delete(oldestKey);
  }
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
