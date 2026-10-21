const SHORT_ACK_PATTERN = /^(哈哈+|嘿嘿+|呵呵+|嗯+|哦+|啊+|诶+|欸+|哇+|哈+|1|6|ok|okay|好|好的|行|可以|收到|在吗)$/i;
const SHORT_PROBE_REPLY_PATTERN = /^(win|goal|yes|no|done)$/i;
const TEST_PROBE_PATTERN = /^(测试|test|testing|123+|abc+|hello|hi|喂|嗨|你好)\s*$/i;
const INSTRUCTION_TEST_PROBE_PATTERN = /^(reply|respond|say)\s+with\s+(one|1)\s+word\b|^只(回复|回答|说)(一个|1个)?(词|字)\b/i;
const RISKY_LINK_PATTERN = /(https?:\/\/|www\.)\S+/i;

export function inspectMemoryNoise(text = "") {
  const normalized = normalizeNoiseText(text);
  if (!normalized) return { reject: true, reason: "empty" };
  if (SHORT_ACK_PATTERN.test(normalized)) return { reject: true, reason: "short_ack" };
  if (SHORT_PROBE_REPLY_PATTERN.test(normalized)) return { reject: true, reason: "short_probe_reply" };
  if (TEST_PROBE_PATTERN.test(normalized)) return { reject: true, reason: "test_probe" };
  if (INSTRUCTION_TEST_PROBE_PATTERN.test(normalized)) return { reject: true, reason: "instruction_test_probe" };
  if (isEmojiHeavyText(normalized)) return { reject: true, reason: "emoji_heavy" };
  if (stripEmojiLikeText(normalized).length > 0 && stripEmojiLikeText(normalized).length <= 2) {
    return { reject: true, reason: "too_short" };
  }
  if (RISKY_LINK_PATTERN.test(normalized)) return { reject: true, reason: "link" };
  if (/^(.)\1{5,}$/.test(normalized)) return { reject: true, reason: "repeated_char" };
  return { reject: false, reason: "" };
}

export function shouldSkipMemoryExtraction(text = "") {
  return inspectMemoryNoise(text).reject;
}

export function shouldSkipSummarySource(text = "") {
  return inspectMemoryNoise(text).reject;
}

function normalizeNoiseText(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function isEmojiHeavyText(text = "") {
  const normalized = String(text || "").trim();
  if (!normalized) return false;
  const withoutEmoji = stripEmojiLikeText(normalized);
  return normalized.length >= 2 && withoutEmoji.length / normalized.length < 0.35;
}

function stripEmojiLikeText(text = "") {
  return String(text || "")
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "")
    .replace(/[~!！。,.，、\s]+/g, "")
    .trim();
}
