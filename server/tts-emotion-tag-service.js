const APPROVED_EXPRESSIVE_TAGS = [
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
  "short pause",
  "long pause",
  "slow",
];

const APPROVED_EXPRESSIVE_TAG_PATTERN = new RegExp(
  `\\[(?:${APPROVED_EXPRESSIVE_TAGS.map(escapeRegex).sort((a, b) => b.length - a.length).join("|")})\\]`,
  "gi"
);

const APPROVED_BREAK_TAG_PATTERN = /<break\s+time=["']\d+(?:\.\d+)?s["']\s*\/>/gi;

export function protectApprovedTtsControlTags(value = "") {
  const placeholders = [];
  let text = safeString(value).replace(APPROVED_BREAK_TAG_PATTERN, (match) => {
    const token = `@@AIOVE_TTS_CTRL_${placeholders.length}@@`;
    placeholders.push(match.replace(/'/g, "\""));
    return token;
  });

  text = text.replace(APPROVED_EXPRESSIVE_TAG_PATTERN, (match) => {
    const token = `@@AIOVE_TTS_CTRL_${placeholders.length}@@`;
    placeholders.push(canonicalizeExpressiveTag(match));
    return token;
  });

  return { text, placeholders };
}

export function restoreApprovedTtsControlTags(value = "", placeholders = []) {
  let text = safeString(value);
  placeholders.forEach((tag, index) => {
    text = text.replace(`@@AIOVE_TTS_CTRL_${index}@@`, tag);
  });
  return normalizeControlTagSpacing(text);
}

export function stripTtsControlTags(value = "") {
  return normalizeVisibleText(removeTtsControlTags(value));
}

// Language assessment needs the original typography, not TTS layout cleanup.
export function removeTtsControlTags(value = "") {
  return safeString(value).replace(APPROVED_BREAK_TAG_PATTERN, " ").replace(APPROVED_EXPRESSIVE_TAG_PATTERN, " ").trim();
}

export function normalizeVisibleText(value = "") {
  return safeString(value)
    .replace(/[ \t]+/g, " ")
    .replace(/\s*([,.!?;:，。！？；：])\s*/g, "$1 ")
    .replace(/\n{2,}/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\s+([,.!?;:，。！？；：])/g, "$1")
    .trim();
}

export function deriveDisplayTextFromReply({ displayText = "", speechText = "" } = {}) {
  // Visible content is authoritative. TTS sanitization must never rewrite it.
  const source = safeString(displayText) || safeString(speechText);
  return source.replace(/\r\n/g, "\n")
    .replace(new RegExp(`[ \t]*${APPROVED_BREAK_TAG_PATTERN.source}[ \t]*`, "gi"), " ")
    .replace(new RegExp(`[ \t]*${APPROVED_EXPRESSIVE_TAG_PATTERN.source}[ \t]*`, "gi"), " ")
    .trim();
}

function normalizeControlTagSpacing(value = "") {
  return safeString(value)
    .replace(/\s*(\[[^[\]]+\]|<break\s+time=["'][^"']+["']\s*\/>)\s*/gi, " $1 ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s+([,.!?;:，。！？；：])/g, "$1")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .trim();
}

function canonicalizeExpressiveTag(value = "") {
  const normalized = safeString(value).replace(/^\[/, "").replace(/\]$/, "").toLowerCase();
  const matched = APPROVED_EXPRESSIVE_TAGS.find((tag) => tag === normalized);
  return matched ? `[${matched}]` : "";
}

function escapeRegex(value = "") {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function safeString(value = "") {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}
