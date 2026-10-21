import {
  protectApprovedTtsControlTags,
  restoreApprovedTtsControlTags,
  stripTtsControlTags,
} from "./tts-emotion-tag-service.js";

export function sanitizeTtsSpeechText(value = "", { displayText } = {}) {
  const { text: protectedText, placeholders } = protectApprovedTtsControlTags(value);
  // A separate visible channel can prove an added speech-only aside is metadata.
  // Without that proof, preserve meaningful literal parentheses and indices.
  const bracketPattern = /\[[^\]\n]{0,80}\]|[（(][^）)\n]{0,80}[）)]/g;
  const withoutAsides = safeString(protectedText).replace(bracketPattern, " ");
  const sameVisibleMeaning = typeof displayText === "string"
    && stripTtsControlTags(restoreApprovedTtsControlTags(withoutAsides, placeholders)) === stripTtsControlTags(displayText);
  const literalSource = typeof displayText === "string"
    ? sameVisibleMeaning ? withoutAsides : protectedText
    : withoutAsides;
  let text = safeString(literalSource)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/```(?:[\w-]+)?\s*([\s\S]*?)```/g, "$1")
    .replace(/\*\*([^*\n]+?)\*\*/g, "$1")
    .replace(/__([^_\n]+?)__/g, "$1")
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "")
    .replace(/[•◆◇■□●○★☆♠♣♥♦]/g, "")
    .replace(/[—–]+/g, "-")
    .replace(/[“”]/g, "\"")
    .replace(/[‘’]/g, "'")
    .replace(/!{2,}/g, "!")
    .replace(/\?{2,}/g, "?")
    .replace(/。{2,}/g, "。")
    .replace(/！{2,}/g, "！")
    .replace(/？{2,}/g, "？")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*([,.!?;:，。！？；：])\s*/g, "$1 ")
    .replace(/\n{2,}/g, "\n")
    .trim();

  text = restoreApprovedTtsControlTags(text, placeholders);

  return text
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([,.!?;:，。！？；：])/g, "$1")
    .trim();
}

function safeString(value = "") {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}
