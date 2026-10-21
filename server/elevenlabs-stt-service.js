import { SERVER_CONFIG } from "./config.js";
import { recordProviderCallLog } from "./ai-reply-log-service.js";

export function resolveElevenLabsSttConfig(overrides = {}) {
  const apiKey = safeString(overrides.apiKey ?? SERVER_CONFIG.elevenLabs.sttApiKey ?? SERVER_CONFIG.elevenLabs.apiKey);
  const baseUrl = safeString(overrides.baseUrl ?? SERVER_CONFIG.elevenLabs.sttBaseUrl ?? SERVER_CONFIG.elevenLabs.baseUrl).replace(/\/+$/, "") || "https://api.elevenlabs.io/v1";
  return {
    enabled: Boolean(apiKey),
    apiKey,
    baseUrl,
    model: safeString(overrides.model ?? SERVER_CONFIG.elevenLabs.sttModel) || "scribe_v2",
    timeoutMs: Math.max(1000, Number(overrides.timeoutMs ?? SERVER_CONFIG.elevenLabs.sttTimeoutMs ?? SERVER_CONFIG.elevenLabs.timeoutMs) || 20000),
  };
}

export async function transcribeChatVoice({ buffer, filename = "audio.webm", mimeType = "audio/webm", config = resolveElevenLabsSttConfig(), fetchImpl = fetch } = {}) {
  const audioBuffer = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  if (!audioBuffer.length) {
    throwSttError("语音内容为空", 400);
  }
  if (!config.enabled) {
    throwSttError("语音识别服务未配置", 503);
  }

  const form = buildElevenLabsSttForm({
    config,
    buffer: audioBuffer,
    filename,
    mimeType,
  });
  const request = buildElevenLabsSttRequest({ config, form });
  const startedAt = Date.now();
  let providerCallLogged = false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await fetchImpl(request.url, {
      ...request.options,
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(`语音识别失败：${extractElevenLabsError(payload) || response.status}`);
      error.statusCode = response.status;
      throw error;
    }

    const text = safeString(payload?.text || payload?.transcript);
    if (!text) {
      throwSttError("语音识别未返回文本", 422);
    }

    await recordProviderCallLog({
      provider: "elevenlabs", model: config.model, baseUrl: config.baseUrl,
      sourceRef: "elevenlabs-stt", status: "success", startedAt,
    });
    providerCallLogged = true;

    return {
      text,
      source: "elevenlabs_stt",
      model: config.model,
      usage: payload?.usage && typeof payload.usage === "object" ? payload.usage : null,
      language: safeString(payload?.language_code || payload?.language_probability?.language || payload?.language) || null,
      audioBytes: audioBuffer.length,
      durationSeconds: normalizeDuration(payload),
      costSnapshot: null,
    };
  } catch (error) {
    if (!providerCallLogged) {
      await recordProviderCallLog({
        provider: "elevenlabs", model: config.model, baseUrl: config.baseUrl,
        sourceRef: "elevenlabs-stt", status: "error", startedAt, error,
      });
    }
    if (error?.name === "AbortError") {
      throwSttError("语音识别超时", 504);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function buildElevenLabsSttForm({ config, buffer, filename = "audio.webm", mimeType = "audio/webm" } = {}) {
  const normalizedConfig = config || resolveElevenLabsSttConfig();
  const audioBuffer = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  const normalizedMimeType = normalizeMimeType(mimeType) || "audio/webm";
  const normalizedFilename = safeString(filename) || `audio.${extensionForMimeType(normalizedMimeType)}`;
  const form = new FormData();
  form.set("model_id", normalizedConfig.model);
  form.set("tag_audio_events", "false");
  form.set("diarize", "false");
  form.set("file_format", "other");
  form.set("file", new Blob([audioBuffer], { type: normalizedMimeType }), normalizedFilename);
  return form;
}

export function buildElevenLabsSttRequest({ config, form } = {}) {
  const normalizedConfig = config || resolveElevenLabsSttConfig();
  if (!normalizedConfig.enabled) throw new Error("ElevenLabs STT is not configured");
  return {
    url: `${normalizedConfig.baseUrl}/speech-to-text`,
    headers: {
      "xi-api-key": normalizedConfig.apiKey,
    },
    options: {
      method: "POST",
      headers: {
        "xi-api-key": normalizedConfig.apiKey,
      },
      body: form,
    },
  };
}

function normalizeDuration(payload = {}) {
  const value = Number(payload?.duration_seconds ?? payload?.duration ?? payload?.audio_duration_seconds);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function extractElevenLabsError(payload = null) {
  return safeString(
    payload?.detail?.message ||
    payload?.detail?.error ||
    payload?.message ||
    payload?.error
  );
}

function normalizeMimeType(value = "") {
  return String(value || "").split(";")[0].trim().toLowerCase();
}

function extensionForMimeType(mimeType = "") {
  const normalized = normalizeMimeType(mimeType);
  if (normalized.includes("wav")) return "wav";
  if (normalized.includes("mpeg") || normalized.includes("mp3")) return "mp3";
  if (normalized.includes("mp4") || normalized.includes("m4a") || normalized.includes("aac")) return "m4a";
  if (normalized.includes("ogg") || normalized.includes("opus")) return "ogg";
  return "webm";
}

function throwSttError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  throw error;
}

function safeString(value = "") {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}
