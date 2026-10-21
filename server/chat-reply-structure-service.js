import { sanitizeTtsSpeechText } from "./tts-speech-text-sanitizer.js";
import { SERVER_CONFIG } from "./config.js";
import { deriveDisplayTextFromReply } from "./tts-emotion-tag-service.js";

const DEFAULT_PROVIDER = "elevenlabs";
const DEFAULT_MODEL = SERVER_CONFIG.elevenLabs.qualityModel;
const MAX_DISPLAY_TEXT_CHARS = 2000;
const MAX_SPEECH_TEXT_CHARS = 3000;

export function parseStructuredChatReply(rawText = "", options = {}) {
  const parsed = parseJsonObject(rawText);
  if (parsed && hasDisplayField(parsed)) {
    return buildStructuredReply({
      displayText: parsed.displayText || parsed.content || parsed.reply || parsed.text,
      speechText: parsed.speechText || parsed.voiceText || parsed.ttsText,
      voiceMeta: parsed.voiceMeta,
      structured: true,
      options,
    });
  }

  const displayText = extractQuotedField(rawText, ["displayText", "content", "reply", "text"]);
  if (displayText) {
    return buildPlainTextStructuredReply(displayText, options);
  }

  return buildPlainTextStructuredReply(rawText, options);
}

function hasDisplayField(value = {}) {
  return Boolean(value.displayText || value.content || value.reply || value.text);
}

export function buildPlainTextStructuredReply(text = "", options = {}) {
  return buildStructuredReply({
    displayText: text,
    speechText: text,
    voiceMeta: null,
    structured: false,
    options,
  });
}

function buildStructuredReply({ displayText = "", speechText = "", voiceMeta = null, structured = false, options = {} }) {
  const normalizedSpeech = normalizeText(speechText || displayText, MAX_SPEECH_TEXT_CHARS);
  const normalizedSpeechText = sanitizeTtsSpeechText(normalizedSpeech.text, { displayText });
  const normalizedDisplay = normalizeText(
    deriveDisplayTextFromReply({
      displayText,
      speechText,
    }),
    MAX_DISPLAY_TEXT_CHARS
  );
  const normalizedVoiceMeta = normalizeVoiceMeta(voiceMeta, options);

  return {
    text: normalizedDisplay.text,
    displayText: normalizedDisplay.text,
    speechText: normalizedSpeechText,
    displayTextTruncated: normalizedDisplay.truncated,
    speechTextTruncated: normalizedSpeech.truncated,
    voiceMeta: normalizedVoiceMeta,
    structured: Boolean(structured),
  };
}

function normalizeVoiceMeta(voiceMeta = null, options = {}) {
  const meta = voiceMeta && typeof voiceMeta === "object" && !Array.isArray(voiceMeta) ? voiceMeta : {};
  return {
    languageCode: safeString(meta.languageCode || options.fallbackLanguageCode || "en").slice(0, 32),
    languageLabel: safeString(meta.languageLabel || options.fallbackLanguageLabel || "English").slice(0, 128),
    provider: safeString(meta.provider || options.fallbackProvider || DEFAULT_PROVIDER).slice(0, 64),
    model: safeString(meta.model || options.fallbackModel || DEFAULT_MODEL).slice(0, 128),
    voiceId: safeString(meta.voiceId || options.fallbackVoiceId || "").slice(0, 128),
  };
}

function parseJsonObject(text = "") {
  const source = stripJsonCodeFence(text);
  if (!source) return null;
  try {
    const parsed = JSON.parse(source);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {}

  const start = source.indexOf("{");
  const end = source.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(source.slice(start, end + 1));
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
    } catch {}
  }
  return null;
}

function extractQuotedField(text = "", fieldNames = []) {
  const source = safeString(text);
  for (const field of fieldNames) {
    const match = source.match(new RegExp(`["']?${field}["']?\\s*[:：]\\s*"((?:\\\\.|[^"\\\\])*)"`, "i"));
    if (match?.[1]) return decodeJsonStringFragment(match[1]);
  }
  return "";
}

function stripJsonCodeFence(text = "") {
  return safeString(text)
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function decodeJsonStringFragment(text = "") {
  const raw = safeString(text);
  if (!raw) return "";
  try {
    return JSON.parse(`"${raw.replace(/"/g, '\\"')}"`).trim();
  } catch {
    return raw.replace(/\\"/g, "\"").replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\t/g, "\t").trim();
  }
}

function normalizeText(value = "", maxLength = MAX_DISPLAY_TEXT_CHARS) {
  const normalized = safeString(value).replace(/\r\n/g, "\n").trim();
  if (!normalized) return { text: "", truncated: false };
  if (normalized.length > maxLength) {
    return {
      text: `${normalized.slice(0, maxLength).trim()}...`,
      truncated: true,
    };
  }
  return { text: normalized, truncated: false };
}

function safeString(value = "") {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}
