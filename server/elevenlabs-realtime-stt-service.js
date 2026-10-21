import { SERVER_CONFIG } from "./config.js";

export function resolveElevenLabsRealtimeSttConfig(overrides = {}) {
  const apiKey = safeString(overrides.apiKey ?? SERVER_CONFIG.elevenLabs.sttApiKey ?? SERVER_CONFIG.elevenLabs.apiKey);
  const baseUrl = safeString(overrides.baseUrl ?? SERVER_CONFIG.elevenLabs.sttBaseUrl ?? SERVER_CONFIG.elevenLabs.baseUrl).replace(/\/+$/, "") || "https://api.elevenlabs.io/v1";
  return {
    enabled: Boolean(apiKey),
    apiKey,
    baseUrl,
    model: safeString(overrides.model ?? SERVER_CONFIG.elevenLabs.sttRealtimeModel) || "scribe_v2_realtime",
  };
}

export function buildElevenLabsRealtimeSttUrl({ config = resolveElevenLabsRealtimeSttConfig(), sampleRate = 16000 } = {}) {
  const url = new URL(`${toWebSocketBaseUrl(config.baseUrl)}/speech-to-text/realtime`);
  url.searchParams.set("model_id", config.model || "scribe_v2_realtime");
  url.searchParams.set("sample_rate", String(Math.max(8000, Number(sampleRate || 16000))));
  url.searchParams.set("audio_format", `pcm_${Math.max(8000, Number(sampleRate || 16000))}`);
  url.searchParams.set("commit_strategy", "vad");
  url.searchParams.set("vad_silence_threshold_secs", "0.3");
  url.searchParams.set("vad_threshold", "0.35");
  url.searchParams.set("min_speech_duration_ms", "50");
  url.searchParams.set("min_silence_duration_ms", "50");
  return url.toString();
}

export function buildElevenLabsRealtimeSttHeaders(config = resolveElevenLabsRealtimeSttConfig()) {
  if (!config.enabled) {
    const error = new Error("语音识别服务未配置");
    error.statusCode = 503;
    throw error;
  }
  return {
    "xi-api-key": config.apiKey,
  };
}

export function normalizeElevenLabsRealtimeEvent(payload = {}) {
  const rawType = safeString(payload?.type || payload?.event || payload?.message_type);
  const text = safeString(payload?.transcript || payload?.text || payload?.message);
  if (!rawType) return null;

  if (["partial_transcript", "partial", "transcript_partial"].includes(rawType)) {
    return text ? { type: "partial", text, rawType } : null;
  }
  if (["committed_transcript", "final_transcript", "transcript_final", "final"].includes(rawType)) {
    return text ? { type: "final", text, rawType } : null;
  }
  if (["error", "transcription_error"].includes(rawType)) {
    return {
      type: "error",
      text: safeString(payload?.message || payload?.error || payload?.detail) || "语音识别失败",
      rawType,
    };
  }
  return null;
}

export function parseRealtimeMessage(data) {
  try {
    const text = Buffer.isBuffer(data) ? data.toString("utf8") : String(data || "");
    if (!text.trim()) return null;
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function toWebSocketBaseUrl(baseUrl = "") {
  const normalized = safeString(baseUrl).replace(/\/+$/, "") || "https://api.elevenlabs.io/v1";
  if (normalized.startsWith("https://")) return `wss://${normalized.slice("https://".length)}`;
  if (normalized.startsWith("http://")) return `ws://${normalized.slice("http://".length)}`;
  if (normalized.startsWith("wss://") || normalized.startsWith("ws://")) return normalized;
  return `wss://${normalized}`;
}

function safeString(value = "") {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}
