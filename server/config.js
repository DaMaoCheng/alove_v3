import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const PROJECT_ROOT = new URL("..", import.meta.url).pathname;

loadDotEnv(join(PROJECT_ROOT, ".env.local"));
loadDotEnv(join(PROJECT_ROOT, ".env"));

const PRIMARY_OPENAI_REPLY_CONFIG = Object.freeze({
  id: "openai",
  apiKey: process.env.OPENAI_API_KEY || "",
  baseUrl: String(process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, ""),
  model: process.env.OPENAI_MODEL || "gpt-5.6-luna",
  apiMode: normalizeOpenAiApiMode(process.env.OPENAI_API_MODE),
  reasoningEffort: normalizeOpenAiReasoningEffort(process.env.OPENAI_REASONING_EFFORT),
  reviewRequestProfile: resolveReviewRequestProfile(process.env.OPENAI_REVIEW_PROFILE),
  timeoutMs: Number(process.env.OPENAI_TIMEOUT_MS || 20000),
});

const VENICE_REPLY_CONFIG = Object.freeze({
  id: "venice",
  apiKey: process.env.VENICE_API_KEY || "",
  baseUrl: String(process.env.VENICE_BASE_URL || "https://api.venice.ai/api/v1").replace(/\/+$/, ""),
  model: process.env.VENICE_MODEL || "deepseek-v4-1-flash-1017-uncensored",
  apiMode: normalizeOpenAiApiMode(process.env.VENICE_API_MODE || "chat_completions"),
  reasoningEffort: "minimal",
  reviewRequestProfile: resolveReviewRequestProfile(process.env.VENICE_REVIEW_PROFILE),
  timeoutMs: Number(process.env.VENICE_TIMEOUT_MS || 20000),
  requestBodyExtras: Object.freeze({
    venice_parameters: Object.freeze({
      include_venice_system_prompt: parseOptionalBoolean(process.env.VENICE_INCLUDE_DEFAULT_SYSTEM_PROMPT, false),
    }),
  }),
});

const DEEPSEEK_FALLBACK_REPLY_CONFIG = Object.freeze({
  id: "deepseek",
  stream: parseOptionalBoolean(process.env.OPENAI_FALLBACK_STREAM, false),
  apiKey: process.env.OPENAI_FALLBACK_API_KEY || PRIMARY_OPENAI_REPLY_CONFIG.apiKey,
  baseUrl: String(process.env.OPENAI_FALLBACK_BASE_URL || PRIMARY_OPENAI_REPLY_CONFIG.baseUrl).trim().replace(/\/+$/, ""),
  model: String(process.env.OPENAI_FALLBACK_MODEL || "").trim(),
  apiMode: normalizeOpenAiApiMode(process.env.OPENAI_FALLBACK_API_MODE || PRIMARY_OPENAI_REPLY_CONFIG.apiMode),
  reasoningEffort: PRIMARY_OPENAI_REPLY_CONFIG.reasoningEffort,
  reviewRequestProfile: resolveReviewRequestProfile(process.env.OPENAI_FALLBACK_REVIEW_PROFILE),
  timeoutMs: normalizeBoundedTimeout(process.env.OPENAI_FALLBACK_TIMEOUT_MS, PRIMARY_OPENAI_REPLY_CONFIG.timeoutMs),
});

const AI_REPLY_CONFIG = Object.freeze({
  chatTimeouts: Object.freeze({
    generation: normalizeBoundedTimeout(process.env.CHAT_REPLY_GENERATION_TIMEOUT_MS, 60000),
    review: normalizeBoundedTimeout(process.env.CHAT_REPLY_REVIEW_TIMEOUT_MS, 60000),
    languageReview: normalizeBoundedTimeout(process.env.CHAT_REPLY_LANGUAGE_REVIEW_TIMEOUT_MS, 60000),
  }),
  provider: String(process.env.AI_REPLY_PROVIDER || "openai").trim().toLowerCase(),
  venice: VENICE_REPLY_CONFIG,
  openai: PRIMARY_OPENAI_REPLY_CONFIG,
  fallbackOpenai: DEEPSEEK_FALLBACK_REPLY_CONFIG,
  replyChain: Object.freeze([
    VENICE_REPLY_CONFIG,
    PRIMARY_OPENAI_REPLY_CONFIG,
    DEEPSEEK_FALLBACK_REPLY_CONFIG,
  ]),
});

export const SERVER_CONFIG = Object.freeze({
  port: Number(process.env.PORT || 4173),
  host: String(process.env.HOST || "127.0.0.1").trim() || "127.0.0.1",
  db: Object.freeze({
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || "aiove_app",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "aiove_app",
  }),
  emailAuthDevMode: isLocalPublicHost(process.env.PUBLIC_BASE_URL || `http://127.0.0.1:${process.env.PORT || 4173}`)
    && String(process.env.EMAIL_AUTH_DEV_MODE || "true").trim().toLowerCase() !== "false",
  email: Object.freeze({
    provider: String(process.env.EMAIL_PROVIDER || "").trim().toLowerCase(),
    from: process.env.EMAIL_FROM || "",
    smtp: Object.freeze({
      host: process.env.SMTP_HOST || "",
      port: Number(process.env.SMTP_PORT || 587),
      user: process.env.SMTP_USER || "",
      password: process.env.SMTP_PASSWORD || "",
      secure: String(process.env.SMTP_SECURE || "false").trim().toLowerCase() === "true",
      proxyUrl: String(process.env.SMTP_PROXY || "").trim(),
    }),
  }),
  authCookieName: process.env.AUTH_COOKIE_NAME || "aiove_auth_token",
  security: Object.freeze({
    superAdminEmails: parseList(process.env.AIOVE_SUPER_ADMIN_EMAILS || "admin@aiove.local"),
    cookieSecure: parseOptionalBoolean(process.env.COOKIE_SECURE, isHttpsUrl(process.env.PUBLIC_BASE_URL)),
    forceHttps: parseOptionalBoolean(process.env.FORCE_HTTPS, isHttpsUrl(process.env.PUBLIC_BASE_URL)),
    hstsEnabled: parseOptionalBoolean(process.env.HSTS_ENABLED, isHttpsUrl(process.env.PUBLIC_BASE_URL)),
    hstsMaxAgeSeconds: Math.max(0, Number(process.env.HSTS_MAX_AGE_SECONDS || 31536000)),
    cspReportOnlyEnabled: parseOptionalBoolean(process.env.CSP_REPORT_ONLY_ENABLED, true),
    trustProxy: parseOptionalBoolean(process.env.TRUST_PROXY, true),
    trustedProxyIps: parseList(process.env.TRUSTED_PROXY_IPS || "127.0.0.1,::1,::ffff:127.0.0.1"),
  }),
  publicBaseUrl: String(process.env.PUBLIC_BASE_URL || `http://127.0.0.1:${process.env.PORT || 4173}`).replace(/\/+$/, ""),
  runtime: Object.freeze({
    isProduction: String(process.env.TTMALL_RUNTIME_MODE || "local_test").trim().toLowerCase() === "production",
    allowLocalProduction: parseOptionalBoolean(process.env.TTMALL_ALLOW_LOCAL_PRODUCTION, false),
    providerLogWriteEnabled: parseOptionalBoolean(process.env.AIOVE_PROVIDER_LOG_WRITE_ENABLED, true),
  }),
  ttmallAccountBinding: Object.freeze({
    secretKey: String(process.env.TTMALL_ACCOUNT_BINDING_SECRET_KEY || "").trim(),
  }),
  guestChat: Object.freeze({
    networkPepper: String(process.env.GUEST_NETWORK_PEPPER || process.env.APP_SECRET || process.env.DB_PASSWORD || "aiove-local-guest-network").trim(),
  }),
  google: Object.freeze({
    clientId: process.env.GOOGLE_CLIENT_ID || "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
    redirectUri: process.env.GOOGLE_REDIRECT_URI || `http://127.0.0.1:${process.env.PORT || 4173}/api/auth/google/callback`,
  }),
  aiReply: AI_REPLY_CONFIG,
  typeSafe: Object.freeze({
    apiKey: String(process.env.TYPESAFE_API_KEY || "").trim(),
    baseUrl: String(process.env.TYPESAFE_BASE_URL || "https://api.typesafe.ai/v1").replace(/\/+$/, ""),
    model: String(process.env.TYPESAFE_MODEL || "jev-latest").trim() || "jev-latest",
    timeoutMs: Math.max(1000, Number(process.env.TYPESAFE_TIMEOUT_MS || 4500)),
    enabled: Boolean(String(process.env.TYPESAFE_API_KEY || "").trim()),
  }),
  knowledgeAi: resolveKnowledgeAiConfig(process.env, AI_REPLY_CONFIG),
  imageGeneration: Object.freeze({
    provider: String(process.env.IMAGE_GENERATION_PROVIDER || "openai").trim().toLowerCase(),
    // Chat-only opt-out; unset or mistyped values keep the provider filter on.
    chatVeniceSafeMode: !["false", "0", "no", "off"].includes(String(process.env.CHAT_IMAGE_VENICE_SAFE_MODE || "").trim().toLowerCase()),
    openai: Object.freeze({
      apiKey: process.env.IMAGE_GENERATION_API_KEY || process.env.OPENAI_API_KEY || "",
      baseUrl: String(process.env.IMAGE_GENERATION_BASE_URL || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, ""),
      model: process.env.IMAGE_GENERATION_MODEL || "gpt-image-2",
      editModel: process.env.IMAGE_GENERATION_EDIT_MODEL || "",
      size: process.env.IMAGE_GENERATION_SIZE || "1024x1792",
      count: Math.max(1, Number(process.env.IMAGE_GENERATION_COUNT || 1)),
      timeoutMs: Number(process.env.IMAGE_GENERATION_TIMEOUT_MS || 180000),
    }),
  }),
  avatarModeration: Object.freeze({
    timeoutMs: Number(process.env.AVATAR_MODERATION_TIMEOUT_MS || 12000),
  }),
  elevenLabs: Object.freeze({
    apiKey: process.env.ELEVENLABS_API_KEY || "",
    baseUrl: String(process.env.ELEVENLABS_BASE_URL || "https://api.elevenlabs.io/v1").replace(/\/+$/, ""),
    qualityModel: process.env.ELEVENLABS_QUALITY_MODEL || "eleven_v4_turbo",
    fastModel: process.env.ELEVENLABS_FAST_MODEL || "eleven_v4_turbo",
    outputFormat: process.env.ELEVENLABS_OUTPUT_FORMAT || "mp3_44100_128",
    timeoutMs: Number(process.env.ELEVENLABS_TIMEOUT_MS || 8000),
    ttsMaxRetries: Math.max(0, Math.min(2, Number(process.env.ELEVENLABS_TTS_MAX_RETRIES || 2))),
    sttApiKey: process.env.ELEVENLABS_STT_API_KEY || process.env.ELEVENLABS_API_KEY || "",
    sttBaseUrl: String(process.env.ELEVENLABS_STT_BASE_URL || process.env.ELEVENLABS_BASE_URL || "https://api.elevenlabs.io/v1").replace(/\/+$/, ""),
    sttModel: process.env.ELEVENLABS_STT_MODEL || "scribe_v2",
    sttRealtimeModel: process.env.ELEVENLABS_STT_REALTIME_MODEL || "scribe_v2_realtime",
    sttTimeoutMs: Number(process.env.ELEVENLABS_STT_TIMEOUT_MS || process.env.ELEVENLABS_TIMEOUT_MS || 20000),
  }),
  memoryRunner: Object.freeze({
    enabled: String(process.env.MEMORY_RUNNER_ENABLED || "true").trim().toLowerCase() !== "false",
    pollMs: Math.max(1000, Number(process.env.MEMORY_RUNNER_POLL_MS || 5000)),
    batchSize: Math.max(1, Math.min(10, Number(process.env.MEMORY_RUNNER_BATCH_SIZE || 2))),
  }),
  proactiveScheduler: Object.freeze({
    enabled: String(process.env.PROACTIVE_MESSAGE_SCHEDULER_ENABLED || "true").trim().toLowerCase() !== "false",
    pollMs: Math.max(10000, Number(process.env.PROACTIVE_MESSAGE_SCHEDULER_POLL_MS || 60000)),
    batchSize: Math.max(1, Math.min(100, Number(process.env.PROACTIVE_MESSAGE_SCHEDULER_BATCH_SIZE || 20))),
  }),
  network: Object.freeze({
    proxyUrl: String(process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY || "").trim(),
  }),
  geoSearch: Object.freeze({
    provider: String(process.env.GEO_SEARCH_PROVIDER || "nominatim").trim().toLowerCase(),
    baseUrl: String(process.env.GEO_SEARCH_BASE_URL || "https://nominatim.openstreetmap.org").replace(/\/+$/, ""),
    timeoutMs: Number(process.env.GEO_SEARCH_TIMEOUT_MS || 12000),
    userAgent: String(process.env.GEO_SEARCH_USER_AGENT || "AIOVE Admin Geo Search").trim() || "AIOVE Admin Geo Search",
  }),
  braveSearch: Object.freeze({
    enabled: Boolean(String(process.env.BRAVE_SEARCH_API_KEY || "").trim()),
    apiKey: String(process.env.BRAVE_SEARCH_API_KEY || "").trim(),
    baseUrl: String(process.env.BRAVE_SEARCH_BASE_URL || "https://api.search.brave.com/res/v1").replace(/\/+$/, ""),
    timeoutMs: Math.max(1000, Number(process.env.BRAVE_SEARCH_TIMEOUT_MS || 8000)),
    minIntervalMs: Math.max(1000, Number(process.env.BRAVE_SEARCH_MIN_INTERVAL_MS || 1100)),
    maxResults: Math.max(1, Math.min(10, Number(process.env.BRAVE_SEARCH_MAX_RESULTS || 5))),
    maxTokens: Math.max(1024, Math.min(32768, Number(process.env.BRAVE_SEARCH_MAX_TOKENS || 6000))),
  }),
  geoIp: Object.freeze({
    providers: parseList(process.env.GEO_IP_PROVIDERS || "cloudflare,ip-api,ipwhois,ipapi"),
    provider: String(process.env.GEO_IP_PROVIDER || "ipapi").trim().toLowerCase(),
    baseUrl: String(process.env.GEO_IP_BASE_URL || "https://ipapi.co").replace(/\/+$/, ""),
    ipwhoisBaseUrl: String(process.env.GEO_IP_IPWHOIS_BASE_URL || "https://ipwho.is").replace(/\/+$/, ""),
    ipApiBaseUrl: String(process.env.GEO_IP_IP_API_BASE_URL || "http://ip-api.com").replace(/\/+$/, ""),
    timeoutMs: Number(process.env.GEO_IP_TIMEOUT_MS || 3000),
  }),
  productApi: Object.freeze({
    timeoutMs: Number(process.env.PRODUCT_API_TIMEOUT_MS || 3000),
    // TTMall search hydrates product details after the initial search response;
    // keep its slower network budget isolated from Shopify and account flows.
    ttmallTimeoutMs: Number(process.env.TTMALL_PRODUCT_API_TIMEOUT_MS || 12000),
    ttmallDetailTimeoutMs: Number(process.env.TTMALL_PRODUCT_DETAIL_TIMEOUT_MS || 5000),
    shopifyAdminApiVersion: String(process.env.SHOPIFY_ADMIN_API_VERSION || "2026-04").trim() || "2026-04",
    shopifyAdminAccessToken: process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || "",
    secretKey: process.env.PRODUCT_API_SECRET_KEY || process.env.APP_SECRET || process.env.DB_PASSWORD || "",
  }),
});

// Verified model-bound settings for output review/wording repair only. A model
// change must not silently inherit another model's reasoning capabilities.
export function resolveReviewRequestProfile(raw) {
  if (!String(raw ?? '').trim()) return null;
  let profile;
  try { profile = JSON.parse(raw); } catch { throw new Error('Invalid review request profile JSON'); }
  const fields = new Set(['model', 'reasoningEffort', 'maxOutputTokens']);
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)
    || Object.keys(profile).some(key => !fields.has(key))
    || typeof profile.model !== 'string' || !profile.model.trim() || profile.model.length > 160
    || profile.reasoningEffort === undefined && profile.maxOutputTokens === undefined
    || profile.reasoningEffort !== undefined && !['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(profile.reasoningEffort)
    || profile.maxOutputTokens !== undefined && (!Number.isSafeInteger(profile.maxOutputTokens) || profile.maxOutputTokens < 512 || profile.maxOutputTokens > 16000))
    throw new Error('Invalid review request profile fields');
  return Object.freeze({ ...profile, model: profile.model.trim() });
}

export function resolveKnowledgeAiConfig(env = {}, aiReplyConfig = AI_REPLY_CONFIG) {
  const aiReply = aiReplyConfig?.openai || {};
  return Object.freeze({
    provider: normalizeProvider(env.KNOWLEDGE_AI_PROVIDER || aiReplyConfig?.provider),
    openai: Object.freeze({
      apiKey: env.KNOWLEDGE_AI_API_KEY || aiReply.apiKey || "",
      baseUrl: String(env.KNOWLEDGE_AI_BASE_URL || aiReply.baseUrl || "https://api.openai.com/v1").replace(/\/+$/, ""),
      model: env.KNOWLEDGE_AI_MODEL || aiReply.model || "gpt-5.6-luna",
      apiMode: normalizeOpenAiApiMode(env.KNOWLEDGE_AI_API_MODE || aiReply.apiMode),
      timeoutMs: Number(env.KNOWLEDGE_AI_TIMEOUT_MS || aiReply.timeoutMs || 30000),
    }),
  });
}

function loadDotEnv(path) {
  if (!existsSync(path)) return;

  const content = readFileSync(path, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const index = trimmed.indexOf("=");
    if (index <= 0) continue;

    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    if (!key || Object.prototype.hasOwnProperty.call(process.env, key)) continue;

    process.env[key] = stripEnvQuotes(value);
  }
}

function stripEnvQuotes(value) {
  if (
    (value.startsWith("\"") && value.endsWith("\"")) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function parseList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function parseOptionalBoolean(value, fallback = false) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return Boolean(fallback);
  return ["1", "true", "yes", "on"].includes(normalized);
}

function isHttpsUrl(value) {
  try {
    return new URL(String(value || "").trim()).protocol === "https:";
  } catch {
    return false;
  }
}

function normalizeBoundedTimeout(value, fallback) {
  const number = Number(String(value ?? "").trim());
  return Number.isSafeInteger(number) && number >= 1 && number <= 120000 ? number : fallback;
}

function normalizeOpenAiApiMode(value) {
  const normalized = String(value || "responses").trim().toLowerCase().replace(/[-\s]+/g, "_");
  return ["responses", "chat_completions"].includes(normalized) ? normalized : "responses";
}

function normalizeOpenAiReasoningEffort(value) {
  const normalized = String(value || "minimal").trim().toLowerCase().replace(/[-\s]+/g, "_");
  return ["minimal", "low", "medium", "high"].includes(normalized) ? normalized : "minimal";
}

function normalizeProvider(value) {
  const normalized = String(value || "openai").trim().toLowerCase();
  return normalized || "openai";
}

function isLocalPublicHost(rawUrl) {
  try {
    const url = new URL(String(rawUrl || "").trim());
    return url.hostname === "127.0.0.1" || url.hostname === "localhost";
  } catch {
    return false;
  }
}
