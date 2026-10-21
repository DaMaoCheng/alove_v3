import { normalizeVisibleText, deriveDisplayTextFromReply } from "./tts-emotion-tag-service.js";

const APPROVED_PREFIX_TAGS = [
  "happy",
  "excited",
  "curious",
  "thoughtful",
  "surprised",
  "sad",
  "angry",
  "sarcastic",
  "whisper",
  "annoyed",
  "appalled",
  "crying",
  "mischievously",
  "laughs",
  "laughing",
  "chuckles",
  "sighs",
  "slow",
];

const EXISTING_TAG_PATTERN = /\[(?:happy|excited|curious|thoughtful|surprised|sad|angry|sarcastic|whisper|annoyed|appalled|crying|mischievously|laughs|laughing|chuckles|sighs|short pause|long pause|slow)\]/i;
const EXISTING_TAG_PATTERN_GLOBAL = /\[(?:happy|excited|curious|thoughtful|surprised|sad|angry|sarcastic|whisper|annoyed|appalled|crying|mischievously|laughs|laughing|chuckles|sighs|short pause|long pause|slow)\]/gi;

export function applyContextualEmotionTags({ speechText = "", displayText = "", userText = "", sourceType = "" } = {}) {
  const normalizedSpeechText = normalizeVisibleText(speechText);
  const normalizedDisplayText = deriveDisplayTextFromReply({ displayText, speechText });
  if (!normalizedSpeechText) {
    return {
      speechText: "",
      displayText: normalizedDisplayText,
      emotionTags: [],
      reason: "empty_text",
    };
  }
  if (EXISTING_TAG_PATTERN.test(normalizedSpeechText)) {
    return {
      speechText: normalizedSpeechText,
      displayText: normalizedDisplayText,
      emotionTags: extractEmotionTags(normalizedSpeechText),
      reason: "model_supplied",
    };
  }

  const primary = pickPrimaryTag({ userText, replyText: normalizedDisplayText, sourceType });
  const pauseTag = pickPauseTag(normalizedDisplayText);
  const emotionTags = [primary, pauseTag].filter(Boolean);
  if (!emotionTags.length) {
    return {
      speechText: normalizedSpeechText,
      displayText: normalizedDisplayText,
      emotionTags: [],
      reason: "no_tag_needed",
    };
  }

  const tagged = injectTags(normalizedSpeechText, emotionTags);
  return {
    speechText: tagged,
    displayText: normalizedDisplayText,
    emotionTags,
    reason: "rule_injected",
  };
}

function pickPrimaryTag({ userText = "", replyText = "", sourceType = "" } = {}) {
  // AI has the full conversation when choosing delivery. Missing tags mean neutral,
  // not permission to infer a mood from isolated words. Keep non-AI fallbacks intact.
  if (safeString(sourceType).toLowerCase() === "ai") return "";
  const haystack = `${safeString(userText)}\n${safeString(replyText)}`.toLowerCase();
  if (!haystack) return "";

  if (/(rough day|sorry|it'?s been a rough one|take it easy|calm|low-key|tired|sad|anxious|upset|frustrated|hard day|not great|烦|难受|低落|失望|不开心|焦虑|累|抱歉)/i.test(haystack)) {
    return "thoughtful";
  }
  if (/(wow|no way|wild|crazy|what a|unreal|mad one|surprise|意外|离谱|太夸张)/i.test(haystack)) {
    return "surprised";
  }
  if (/(price|kit|shirt|jersey|drop|pick|buy|home shirt|away shirt|matchday|clean pick|screams|hit|energy|商品|球衣|推荐|买|下单|尺码|训练服)/i.test(haystack)) {
    return "excited";
  }
  if (/\?$/.test(safeString(replyText)) || /(which|what|pick one|tell me|do you want|want me to|how about|还是|要不要|想不想)/i.test(replyText)) {
    return "curious";
  }
  if (String(sourceType || "").toLowerCase() === "promotion_campaign") {
    return "happy";
  }
  if (/\bbro\b/i.test(replyText)) {
    return "happy";
  }
  return "";
}

function pickPauseTag(text = "") {
  const normalized = safeString(text);
  if (normalized.includes("\n\n")) return "short pause";
  const sentences = normalized.split(/[.!?。！？]/).map((part) => part.trim()).filter(Boolean);
  if (sentences.length >= 2 && normalized.length > 72) return "short pause";
  return "";
}

function injectTags(text = "", tags = []) {
  const normalized = safeString(text);
  if (!normalized) return "";
  let output = normalized;
  const [firstTag, secondTag] = tags.filter((tag) => APPROVED_PREFIX_TAGS.includes(tag) || tag === "short pause" || tag === "long pause");
  if (firstTag) output = `[${firstTag}] ${output}`;
  if (secondTag === "short pause" || secondTag === "long pause") {
    output = insertPauseTag(output, secondTag);
  }
  return output.trim();
}

function insertPauseTag(text = "", pauseTag = "short pause") {
  const normalized = safeString(text);
  const splitDoubleLine = normalized.split(/\n{2,}/);
  if (splitDoubleLine.length >= 2) {
    return `${splitDoubleLine[0].trim()} [${pauseTag}] ${splitDoubleLine.slice(1).join(" ").trim()}`.trim();
  }
  const match = normalized.match(/^(.+?[.!?。！？])\s+(.+)$/);
  if (match) {
    return `${match[1].trim()} [${pauseTag}] ${match[2].trim()}`.trim();
  }
  return normalized;
}

function extractEmotionTags(value = "") {
  return Array.from(String(value || "").matchAll(EXISTING_TAG_PATTERN_GLOBAL)).map((match) => match[0].slice(1, -1).toLowerCase());
}

function safeString(value = "") {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}
