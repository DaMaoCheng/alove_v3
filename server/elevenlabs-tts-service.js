import { mkdir, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { SERVER_CONFIG, PROJECT_ROOT } from "./config.js";
import { createId } from "./security.js";
import { resolveEncodedAudioDurationSeconds } from "./encoded-audio-duration-service.js";
import { recordProviderCallLog } from "./ai-reply-log-service.js";

const DEFAULT_OUTPUT_DIR = join(PROJECT_ROOT, "uploads/voice/ai");
const DEFAULT_PUBLIC_PATH = "/uploads/voice/ai";
const DEFAULT_MAX_RETRIES = 2;
const MAX_RETRIES = 2;
const RETRY_BACKOFF_MS = 250;

export function resolveElevenLabsTtsConfig(overrides = {}) {
  const apiKey = safeString(overrides.apiKey ?? SERVER_CONFIG.elevenLabs.apiKey);
  const baseUrl = safeString(overrides.baseUrl ?? SERVER_CONFIG.elevenLabs.baseUrl).replace(/\/+$/, "") || "https://api.elevenlabs.io/v1";
  return {
    enabled: Boolean(apiKey),
    apiKey,
    baseUrl,
    qualityModel: safeString(overrides.qualityModel ?? SERVER_CONFIG.elevenLabs.qualityModel) || "eleven_v4_turbo",
    fastModel: safeString(overrides.fastModel ?? SERVER_CONFIG.elevenLabs.fastModel) || "eleven_v4_turbo",
    outputFormat: safeString(overrides.outputFormat ?? SERVER_CONFIG.elevenLabs.outputFormat) || "mp3_44100_128",
    timeoutMs: Math.max(1000, Number(overrides.timeoutMs ?? SERVER_CONFIG.elevenLabs.timeoutMs) || 8000),
    maxRetries: Math.max(0, Math.min(MAX_RETRIES, Number(overrides.maxRetries ?? SERVER_CONFIG.elevenLabs.ttsMaxRetries ?? DEFAULT_MAX_RETRIES) || 0)),
    outputDir: safeString(overrides.outputDir) || DEFAULT_OUTPUT_DIR,
    publicPath: safeString(overrides.publicPath) || DEFAULT_PUBLIC_PATH,
  };
}

export function buildElevenLabsTtsRequest({ config, voiceId, text, model }) {
  const normalizedConfig = config || resolveElevenLabsTtsConfig();
  const normalizedVoiceId = safeString(voiceId);
  const normalizedText = safeString(text);
  if (!normalizedConfig.enabled) throw new Error("ElevenLabs TTS is not configured");
  if (!normalizedVoiceId) throw new Error("ElevenLabs voice id is required");
  if (!normalizedText) throw new Error("TTS text is empty");

  const url = new URL(`${normalizedConfig.baseUrl}/text-to-speech/${encodeURIComponent(normalizedVoiceId)}`);
  url.searchParams.set("output_format", normalizedConfig.outputFormat);
  return {
    url: url.toString(),
    headers: {
      "xi-api-key": normalizedConfig.apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text: normalizedText,
      model_id: safeString(model) || normalizedConfig.qualityModel,
    }),
  };
}

export async function generateElevenLabsSpeech({
  text,
  voiceId,
  model,
  outputFileName = "",
  temporaryFileSuffix = "",
  deferFinalize = false,
  config = resolveElevenLabsTtsConfig(),
  fetchImpl = fetch,
} = {}) {
  const deterministicFileName = normalizeOutputFileName(outputFileName);
  if (deterministicFileName) {
    const existingPath = join(config.outputDir, deterministicFileName);
    const existing = await stat(existingPath).catch(() => null);
    if (existing?.isFile() && existing.size > 0) {
      return {
        status: "ready",
        audioUrl: `${config.publicPath}/${deterministicFileName}`,
        audioBytes: existing.size,
        durationSeconds: resolveEncodedAudioDurationSeconds({ audioBytes: existing.size, outputFormat: config.outputFormat }),
        outputFormat: config.outputFormat,
        outputPath: existingPath,
        temporaryPath: "",
        reused: true,
      };
    }
  }
  const request = buildElevenLabsTtsRequest({ config, voiceId, text, model });
  const startedAt = Date.now();
  let retryCount = 0;
  while (true) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
      const response = await fetchImpl(request.url, {
        method: "POST",
        headers: request.headers,
        body: request.body,
        signal: controller.signal,
      });
      if (!response.ok) {
        const error = new Error(`ElevenLabs TTS failed: HTTP ${response.status} ${await readErrorText(response)}`);
        error.statusCode = response.status;
        throw error;
      }

      const audioBuffer = Buffer.from(await response.arrayBuffer());
      if (!audioBuffer.length) throw new Error("ElevenLabs returned an empty audio payload");
      await recordProviderCallLog({
        provider: "elevenlabs", model: safeString(model) || config.qualityModel, baseUrl: config.baseUrl,
        sourceRef: "elevenlabs-tts", status: "success", startedAt,
      });

      await mkdir(config.outputDir, { recursive: true });
      const fileName = deterministicFileName || `${createId("ai_voice")}.mp3`;
      const outputPath = join(config.outputDir, fileName);
      const safeTemporarySuffix = normalizeTemporarySuffix(temporaryFileSuffix);
      const temporaryPath = `${outputPath}.${safeTemporarySuffix || "write"}.tmp`;
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(temporaryPath, audioBuffer);
      if (!deferFinalize) await rename(temporaryPath, outputPath);

      return {
        status: "ready",
        audioUrl: `${config.publicPath}/${fileName}`,
        audioBytes: audioBuffer.length,
        durationSeconds: resolveEncodedAudioDurationSeconds({ audioBytes: audioBuffer.length, outputFormat: config.outputFormat }),
        outputFormat: config.outputFormat,
        outputPath,
        temporaryPath: deferFinalize ? temporaryPath : "",
        reused: false,
      };
    } catch (error) {
      if (isRetryableElevenLabsError(error) && retryCount < config.maxRetries) {
        retryCount += 1;
        await waitBeforeElevenLabsRetry(retryCount);
        continue;
      }
      error.retryCount = retryCount;
      await recordProviderCallLog({
        provider: "elevenlabs", model: safeString(model) || config.qualityModel, baseUrl: config.baseUrl,
        sourceRef: "elevenlabs-tts", status: "error", startedAt, error,
      });
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function isRetryableElevenLabsError(error) {
  if (!error) return false;
  if (error.name === "AbortError") return true;
  if (error instanceof TypeError) return true;
  return ["ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "ECONNRESET", "EAI_AGAIN", "ENETUNREACH", "ECONNREFUSED"].includes(String(error.code || "").toUpperCase());
}

function waitBeforeElevenLabsRetry(retryCount) {
  return new Promise((resolve) => setTimeout(resolve, RETRY_BACKOFF_MS * retryCount));
}

function normalizeOutputFileName(value = "") {
  const normalized = safeString(value);
  return /^[a-zA-Z0-9_-]+\.mp3$/.test(normalized) ? normalized : "";
}

function normalizeTemporarySuffix(value = "") {
  const normalized = safeString(value);
  return /^[a-zA-Z0-9_-]+$/.test(normalized) ? normalized.slice(0, 80) : "";
}

async function readErrorText(response) {
  const text = await response.text().catch(() => "");
  if (!text) return "";
  try {
    return JSON.stringify(JSON.parse(text));
  } catch {
    return text.slice(0, 500);
  }
}

function safeString(value = "") {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}
