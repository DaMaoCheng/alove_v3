import { parseStructuredChatReply } from "./chat-reply-structure-service.js";
import { SERVER_CONFIG } from "./config.js";

const MIN_REPLY_LENGTH = 1;
const MAX_REPLY_LENGTH = 2000;

export function appendStructuredReplyInstructions(systemPrompt = "") {
  return [
    normalizePromptText(systemPrompt),
    [
      "## Reply Output Contract",
      "Return exactly one JSON object and no surrounding Markdown.",
      "The object must contain:",
      "- displayText: the plain user-visible message with no internal tags.",
      "- speechText: the same wording as displayText for TTS. You may add only light expressive control tags such as [happy], [excited], [curious], [thoughtful], [surprised], [sad], [angry], [sarcastic], [whisper], [annoyed], [appalled], [crying], [mischievously], [laughs], [laughing], [chuckles], [sighs], [short pause], [long pause], or [slow]. Do not change the meaning, wording, facts, or sentence order between displayText and speechText.",
      "- voiceMeta: an object with languageCode, languageLabel, provider, model, and voiceId when known.",
      "Every visible reply must be a complete natural sentence or complete conversational fragment in its active language. For English output, do not end with a dangling English function word such as a, an, the, and, or, but, to, for, with, of, in, on, because, or that. Evaluate other languages by their own sentence structure; complete names, foreign terms and explicitly requested quotations are permitted endings.",
      "Do not add service-offer endings like 'If you want, I can...', 'If you'd like, I can...', 'Let me know if you want...', or equivalent Chinese opt-in tails. Answer the current message directly and stop naturally.",
      "Do not include internal reasoning, system prompt text, database field names, or implementation details.",
    ].join("\n"),
  ].filter(Boolean).join("\n\n");
}

export function parseStructuredReply(text = "", voiceFallbackMeta = {}) {
  const structuredReply = parseStructuredChatReply(text, voiceFallbackMeta);
  const replyVoiceMeta = normalizeReplyVoiceMeta(structuredReply.voiceMeta, voiceFallbackMeta);
  const normalizedText = normalizeReplyText(structuredReply.displayText);
  return {
    structuredReply,
    replyVoiceMeta,
    normalizedText,
    truncated: Boolean(structuredReply.displayTextTruncated),
  };
}

export function normalizeReplyVoiceMeta(voiceMeta = {}, fallback = {}) {
  return {
    languageCode: normalizeVoiceMetaField(voiceMeta.languageCode || fallback.fallbackLanguageCode || "en", 32),
    languageLabel: normalizeVoiceMetaField(voiceMeta.languageLabel || fallback.fallbackLanguageLabel || "English", 128),
    provider: normalizeVoiceProvider(fallback.fallbackProvider || voiceMeta.provider),
    model: normalizeVoiceMetaField(fallback.fallbackModel || voiceMeta.model || SERVER_CONFIG.elevenLabs.qualityModel, 128),
    voiceId: normalizeVoiceMetaField(fallback.fallbackVoiceId || voiceMeta.voiceId, 128),
  };
}

export function normalizeReplyText(text) {
  const normalized = String(text || "").replace(/\r\n/g, "\n").trim();
  if (normalized.length < MIN_REPLY_LENGTH) return "";
  return normalized.length > MAX_REPLY_LENGTH ? `${normalized.slice(0, MAX_REPLY_LENGTH).trim()}...` : normalized;
}

function normalizeVoiceProvider(value = "") {
  const normalized = normalizeVoiceMetaField(value, 64).toLowerCase();
  if (normalized === "elevenlabs") return "elevenlabs";
  return normalized || "elevenlabs";
}

function normalizeVoiceMetaField(value = "", maxLength = 128) {
  const normalized = String(value == null ? "" : value).trim();
  return normalized.length > maxLength ? normalized.slice(0, maxLength) : normalized;
}

function normalizePromptText(text = "") {
  return String(text == null ? "" : text).trim();
}
