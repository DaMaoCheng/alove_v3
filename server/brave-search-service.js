import { SERVER_CONFIG } from "./config.js";
import { recordProviderCallLog } from "./ai-reply-log-service.js";
import { normalizeCharacterLanguage } from "../shared/language-library.js";
import { isIP } from "node:net";

const FACT_QUERY = /\b(world cup|世界杯|champions league|liga mx|premier league|first goal|首个进球|scored|goal|match|比赛|球员|player|footballer|soccer|世界杯历史|record|history|born|national team)\b/i;
let requestQueue = Promise.resolve();
let nextRequestAt = 0;

// Official GET /web/search enums and query limits:
// https://api-dashboard.search.brave.com/api-reference/web/search/get
const SEARCH_LANGUAGES = new Set("ar eu bn bg ca zh-hans zh-hant hr cs da nl en en-gb et fi fr gl de el gu he hi hu is it ja jp kn ko lv lt ms ml mr nb pl pt-br pt-pt pa ro ru sr sk sl es sv ta te th tr uk vi".split(" "));
const SEARCH_COUNTRIES = new Set("AR AU AT BE BR CA CL DK FI FR DE GR HK IN ID IT JP KR MY MX NL NZ NO CN PL PT PH RU SA ZA ES SE CH TW TR GB US ALL".split(" "));

export function shouldTriggerBraveSearch(userText = "", { knowledgeItems = [], config = SERVER_CONFIG.braveSearch } = {}) {
  return Boolean(config?.enabled)
    && FACT_QUERY.test(String(userText || ""))
    && (!Array.isArray(knowledgeItems) || knowledgeItems.length === 0);
}

export function normalizeBraveSearchQuery(query = "") {
  return Array.from(String(query || "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().split(/\s+/).slice(0, 75).join(" ")).slice(0, 600).join("").trim();
}

export function normalizeBraveSearchItems(items = [], { limit = 5 } = {}) {
  return (Array.isArray(items) ? items : []).slice(0, boundedNumber(limit, 5, 1, 10)).map((item) => {
    const rawContent = item?.content || item?.description;
    const content = typeof rawContent === "string" ? rawContent.trim().slice(0, 2000) : "";
    const url = typeof item?.url === "string" ? item.url.trim() : "";
    if (!content || !isPublicReferenceUrl(url)) return null;
    return { title: typeof item?.title === "string" && item.title.trim() ? item.title.trim().slice(0, 200) : "Web source", content, url };
  }).filter(Boolean);
}

function isPublicReferenceUrl(value) {
  if (!value || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password
      && !isIP(url.hostname.replace(/^\[|\]$/g, "")) && url.hostname.includes(".")
      && !/(^|\.)(localhost|local|internal)$/i.test(url.hostname);
  } catch { return false; }
}

function normalizeSearchLanguage(value, country) {
  const raw = String(value || "").trim().toLowerCase().replace(/_/g, "-");
  if (SEARCH_LANGUAGES.has(raw)) return raw;
  const code = normalizeCharacterLanguage(value)?.code || normalizeCharacterLanguage(raw.split("-")[0])?.code || "en";
  const mapped = code === "zh" ? "zh-hans" : code === "no" ? "nb" : code === "pt" ? (country === "BR" ? "pt-br" : "pt-pt") : code;
  return SEARCH_LANGUAGES.has(mapped) ? mapped : "en";
}

export async function searchBraveLlmContext(query, { country = "US", searchLang = "en", config = SERVER_CONFIG.braveSearch, fetchImpl = fetch, recordLog = recordProviderCallLog, logContext = {} } = {}) {
  const normalizedQuery = normalizeBraveSearchQuery(query);
  if (!config?.enabled || !String(config?.apiKey || "").trim() || !normalizedQuery) return { items: [], searched: false };
  const countryCode = String(country).trim().toUpperCase();
  const normalizedCountry = SEARCH_COUNTRIES.has(countryCode) ? countryCode : "US";
  const params = new URLSearchParams({ q: normalizedQuery, country: normalizedCountry, search_lang: normalizeSearchLanguage(searchLang, normalizedCountry), count: String(boundedNumber(config.maxResults, 5, 1, 10)), safesearch: "strict" });
  const startedAt = Date.now();
  const deadline = startedAt + boundedNumber(config.timeoutMs, 8000, 1, 30000);
  const controller = new AbortController();
  let searched = false, timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => { controller.abort(); resolve({ items: [], searched, error: "TIMEOUT" }); }, Math.max(0, deadline - Date.now()));
  });
  const run = enqueueBraveRequest(() => {
    searched = true;
    const operation = (async () => {
      try {
        const response = await fetchImpl(`${String(config.baseUrl || "").replace(/\/+$/, "")}/web/search?${params}`, { headers: { Accept: "application/json", "X-Subscription-Token": config.apiKey }, signal: controller.signal });
        if (controller.signal.aborted || Date.now() >= deadline) return { items: [], searched: true, error: "TIMEOUT" };
        if (!response.ok) return { items: [], searched: true, error: `HTTP_${Number(response.status) || 0}` };
        const payload = await response.json();
        if (controller.signal.aborted || Date.now() >= deadline) return { items: [], searched: true, error: "TIMEOUT" };
        return { items: normalizeBraveSearchItems(payload?.web?.results, { limit: config.maxResults }), searched: true };
      } catch (error) {
        return { items: [], searched: true, error: controller.signal.aborted || error?.name === "AbortError" ? "TIMEOUT" : "NETWORK_ERROR" };
      }
    })();
    // A non-cooperative provider must not hold every later request in the queue.
    return Promise.race([operation, timeout]);
  }, { deadline, signal: controller.signal, minIntervalMs: boundedNumber(config.minIntervalMs, 1100, 0, 30000) });
  const result = await Promise.race([run, timeout]);
  clearTimeout(timer);
  const safeContext = Object.fromEntries(["requestId", "sessionId", "characterId", "userId", "guestSessionId"].filter((key) => logContext?.[key]).map((key) => [key, String(logContext[key]).slice(0, 200)]));
  // Logging cannot extend the search deadline or expose query/token/provider bodies.
  if (result.searched) {
    const error = /^HTTP_\d+$/.test(result.error || "") ? { statusCode: Number(result.error.slice(5)) }
      : result.error === "TIMEOUT" ? { name: "AbortError" }
        : result.error ? { code: "AI_REPLY_NETWORK_ERROR" } : null;
    Promise.resolve().then(() => recordLog({ ...safeContext, provider: "brave", baseUrl: config.baseUrl, sourceRef: "brave-search", status: result.error ? "error" : "success", startedAt, error })).catch(() => undefined);
  }
  return result;
}

function enqueueBraveRequest(task, { deadline, signal, minIntervalMs }) {
  const run = requestQueue.then(async () => {
    if (signal.aborted || Date.now() >= deadline) return { items: [], searched: false, error: "TIMEOUT" };
    const waitMs = Math.max(0, nextRequestAt - Date.now());
    if (waitMs) await waitForTurn(Math.min(waitMs, Math.max(0, deadline - Date.now())), signal);
    if (signal.aborted || Date.now() >= deadline || Date.now() < nextRequestAt) return { items: [], searched: false, error: "TIMEOUT" };
    nextRequestAt = Date.now() + minIntervalMs;
    return task();
  });
  requestQueue = run.catch(() => undefined);
  return run;
}

function waitForTurn(ms, signal) {
  return new Promise((resolve) => {
    const finish = () => { clearTimeout(timer); signal.removeEventListener("abort", finish); resolve(); };
    const timer = setTimeout(finish, ms);
    signal.addEventListener("abort", finish, { once: true });
    if (signal.aborted) finish();
  });
}

function boundedNumber(value, fallback, min, max) {
  return Number.isFinite(Number(value)) ? Math.max(min, Math.min(max, Number(value))) : fallback;
}
