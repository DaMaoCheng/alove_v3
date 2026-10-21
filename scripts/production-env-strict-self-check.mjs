import assert from "node:assert/strict";
import { SERVER_CONFIG } from "../server/config.js";

const STRICT_PRODUCTION_ENV = parseBoolean(process.env.STRICT_PRODUCTION_ENV);

if (!STRICT_PRODUCTION_ENV) {
  console.log("production env strict self-check skipped (set STRICT_PRODUCTION_ENV=true to enable)");
  process.exit(0);
}

const issues = [];

requireValue("PUBLIC_BASE_URL", SERVER_CONFIG.publicBaseUrl);
requirePublicUrl("PUBLIC_BASE_URL", SERVER_CONFIG.publicBaseUrl);
assert.equal(SERVER_CONFIG.security.cookieSecure, true, "COOKIE_SECURE must be enabled in strict production checks");
assert.equal(SERVER_CONFIG.security.forceHttps, true, "FORCE_HTTPS must be enabled in strict production checks");
assert.equal(SERVER_CONFIG.security.hstsEnabled, true, "HSTS_ENABLED must be enabled in strict production checks");
assert.ok(SERVER_CONFIG.security.hstsMaxAgeSeconds > 0, "HSTS_MAX_AGE_SECONDS must be positive in strict production checks");
requireValue("DB_PASSWORD", SERVER_CONFIG.db.password);
rejectPlaceholder("DB_PASSWORD", SERVER_CONFIG.db.password);

assert.equal(SERVER_CONFIG.emailAuthDevMode, false, "EMAIL_AUTH_DEV_MODE must be false in strict production checks");
assert.equal(SERVER_CONFIG.email.provider, "smtp", "EMAIL_PROVIDER must be smtp in strict production checks");
requireValue("EMAIL_FROM", SERVER_CONFIG.email.from);
requireValue("SMTP_HOST", SERVER_CONFIG.email.smtp.host);
requireValue("SMTP_USER", SERVER_CONFIG.email.smtp.user);
requireValue("SMTP_PASSWORD", SERVER_CONFIG.email.smtp.password);
rejectPlaceholder("SMTP_PASSWORD", SERVER_CONFIG.email.smtp.password);

requireValue("OPENAI_API_KEY", SERVER_CONFIG.aiReply.openai.apiKey);
rejectPlaceholder("OPENAI_API_KEY", SERVER_CONFIG.aiReply.openai.apiKey);
requirePublicUrl("OPENAI_BASE_URL", SERVER_CONFIG.aiReply.openai.baseUrl);
assert.ok(["responses", "chat_completions"].includes(SERVER_CONFIG.aiReply.openai.apiMode), "OPENAI_API_MODE must be responses or chat_completions");
requireValue("KNOWLEDGE_AI_API_KEY or OPENAI_API_KEY", SERVER_CONFIG.knowledgeAi.openai.apiKey);
rejectPlaceholder("KNOWLEDGE_AI_API_KEY", SERVER_CONFIG.knowledgeAi.openai.apiKey);
requirePublicUrl("KNOWLEDGE_AI_BASE_URL", SERVER_CONFIG.knowledgeAi.openai.baseUrl);
assert.equal(SERVER_CONFIG.knowledgeAi.provider, "openai", "KNOWLEDGE_AI_PROVIDER must be openai in strict production checks");
requireValue("KNOWLEDGE_AI_MODEL", SERVER_CONFIG.knowledgeAi.openai.model);
assert.ok(Number.isFinite(SERVER_CONFIG.knowledgeAi.openai.timeoutMs) && SERVER_CONFIG.knowledgeAi.openai.timeoutMs > 0, "KNOWLEDGE_AI_TIMEOUT_MS must be a positive number");

requireValue("IMAGE_GENERATION_API_KEY or OPENAI_API_KEY", SERVER_CONFIG.imageGeneration.openai.apiKey);
rejectPlaceholder("IMAGE_GENERATION_API_KEY", SERVER_CONFIG.imageGeneration.openai.apiKey);
requirePublicUrl("IMAGE_GENERATION_BASE_URL", SERVER_CONFIG.imageGeneration.openai.baseUrl);
assert.match(SERVER_CONFIG.imageGeneration.openai.size, /^\d+x\d+$/, "IMAGE_GENERATION_SIZE must look like 1024x1792");
assert.equal(SERVER_CONFIG.imageGeneration.openai.count, 1, "IMAGE_GENERATION_COUNT should stay 1 for avatar generation cost control");

requireValue("ELEVENLABS_API_KEY", SERVER_CONFIG.elevenLabs.apiKey);
rejectPlaceholder("ELEVENLABS_API_KEY", SERVER_CONFIG.elevenLabs.apiKey);
requirePublicUrl("ELEVENLABS_BASE_URL", SERVER_CONFIG.elevenLabs.baseUrl);
requireValue("ELEVENLABS_QUALITY_MODEL", SERVER_CONFIG.elevenLabs.qualityModel);
requireValue("ELEVENLABS_FAST_MODEL", SERVER_CONFIG.elevenLabs.fastModel);
requireValue("ELEVENLABS_OUTPUT_FORMAT", SERVER_CONFIG.elevenLabs.outputFormat);
assert.ok(Number.isFinite(SERVER_CONFIG.elevenLabs.timeoutMs) && SERVER_CONFIG.elevenLabs.timeoutMs > 0, "ELEVENLABS_TIMEOUT_MS must be a positive number");
assert.ok(Number.isInteger(SERVER_CONFIG.elevenLabs.ttsMaxRetries) && SERVER_CONFIG.elevenLabs.ttsMaxRetries >= 0 && SERVER_CONFIG.elevenLabs.ttsMaxRetries <= 2, "ELEVENLABS_TTS_MAX_RETRIES must be between 0 and 2");
requireValue("ELEVENLABS_STT_API_KEY or ELEVENLABS_API_KEY", SERVER_CONFIG.elevenLabs.sttApiKey || SERVER_CONFIG.elevenLabs.apiKey);
rejectPlaceholder("ELEVENLABS_STT_API_KEY", SERVER_CONFIG.elevenLabs.sttApiKey || SERVER_CONFIG.elevenLabs.apiKey);
requirePublicUrl("ELEVENLABS_STT_BASE_URL", SERVER_CONFIG.elevenLabs.sttBaseUrl);

if (SERVER_CONFIG.google.clientId || SERVER_CONFIG.google.clientSecret) {
  requireValue("GOOGLE_CLIENT_ID", SERVER_CONFIG.google.clientId);
  requireValue("GOOGLE_CLIENT_SECRET", SERVER_CONFIG.google.clientSecret);
  requirePublicUrl("GOOGLE_REDIRECT_URI", SERVER_CONFIG.google.redirectUri);
  assert.ok(
    SERVER_CONFIG.google.redirectUri.startsWith(`${SERVER_CONFIG.publicBaseUrl}/`),
    "GOOGLE_REDIRECT_URI should use PUBLIC_BASE_URL in strict production checks"
  );
}

requirePublicUrl("GEO_SEARCH_BASE_URL", SERVER_CONFIG.geoSearch.baseUrl);
requirePublicUrl("GEO_IP_BASE_URL", SERVER_CONFIG.geoIp.baseUrl);
requirePublicUrl("GEO_IP_IPWHOIS_BASE_URL", SERVER_CONFIG.geoIp.ipwhoisBaseUrl);
requirePublicUrl("GEO_IP_IP_API_BASE_URL", SERVER_CONFIG.geoIp.ipApiBaseUrl);
assert.ok(SERVER_CONFIG.geoIp.providers.length, "GEO_IP_PROVIDERS should include at least one provider");
assert.ok(SERVER_CONFIG.geoSearch.userAgent && !/example/i.test(SERVER_CONFIG.geoSearch.userAgent), "GEO_SEARCH_USER_AGENT should be a real app user agent");

requireValue("PRODUCT_API_SECRET_KEY", process.env.PRODUCT_API_SECRET_KEY);
rejectPlaceholder("PRODUCT_API_SECRET_KEY", process.env.PRODUCT_API_SECRET_KEY);

if (issues.length) {
  for (const issue of issues) console.error(`[production-env] ${issue}`);
  throw new Error(`strict production env check failed with ${issues.length} issue(s)`);
}

console.log("production env strict self-check passed");

function parseBoolean(value) {
  return String(value || "false").trim().toLowerCase() === "true";
}

function requireValue(name, value) {
  if (!String(value || "").trim()) {
    issues.push(`${name} is required`);
  }
}

function rejectPlaceholder(name, value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return;
  if (["change_me", "replace_me", "replace_with_strong_production_password", "replace_with_clcl_key", "replace_with_image_generation_key", "replace_with_elevenlabs_key"].includes(normalized)) {
    issues.push(`${name} still uses a placeholder value`);
  }
}

function requirePublicUrl(name, value) {
  const raw = String(value || "").trim();
  if (!raw) {
    issues.push(`${name} is required`);
    return;
  }

  let url;
  try {
    url = new URL(raw);
  } catch {
    issues.push(`${name} must be a valid URL`);
    return;
  }

  if (!/^https?:$/.test(url.protocol)) {
    issues.push(`${name} must use http or https`);
  }
  if (["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
    issues.push(`${name} must not point to local host in strict production checks`);
  }
}
