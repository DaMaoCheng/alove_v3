const INTERNAL_INFO_PATTERNS = [
  /api[\s._-]*key/i,
  /secret[\s._-]*key/i,
  /bearer[\s._-]*token/i,
  /openai[_\s-]*api[_\s-]*key/i,
  /\bsk-[A-Za-z0-9_-]{12,}\b/,
  /system\s+prompt/i,
  /系统[\s　]*(提示词|指令|规则|设定)/,
  /\.env\b/i,
  /环境变量/,
  /数据库|mysql|后端|源码|源代码/,
  /base\s*url|baseurl/i,
];

const SELF_EXPOSURE_PATTERNS = [
  /\b(chatgpt|claude|openai|anthropic)\b/i,
  /\b(as an ai|i am an ai|i'm an ai|language model|ai assistant)\b/i,
  /(?:作为|身为).*(?:ai|人工智能|语言模型|助手)/i,
  /我(?:是|只是).*(?:ai|人工智能|语言模型|模型|程序|助手)/i,
  /我(?:不能|无法).*(?:访问|查看).*(?:系统提示词|内部规则|数据库|源码)/,
  /开发助手|代码助手|编程助手/,
];

const STRUCTURED_FIELD_PATTERN = /["']?(displayText|speechText|voiceMeta|voiceText|ttsText)["']?\s*[:：]/i;

const MARKDOWN_PATTERNS = [
  /(^|\n)\s{0,3}#{1,6}\s+\S/,
  /\*\*[^*\n][\s\S]*?\*\*/,
  /__[^_\n][\s\S]*?__/,
  /(^|\n)\s*[-*+]\s+\S/,
  /```/,
];

const INCOMPLETE_ENDING_PATTERNS = [
  /(for example|including|such as|as follows|here is|here are|I can help with|I will now)[：:，,、\s]*$/i,
  /(?:^|[^\p{L}\p{M}\p{N}_])(?:a|an|the|and|or|but|to|for|with|of|in|on|at|by|from|as|because|that|which|who|when|where)\s*[.!?。！？]?$/iu,
  /(比如|例如|包括|如下|我可以|我会|建议|可以这样)[：:，,、\s]*$/,
  /[（(「『“《]$/,
];

const TEMPLATE_TONE_PATTERNS = [
  /if you want[,\s]+i can/i,
  /if you(?:'d| would)? like[,\s]+i can/i,
  /if you need[,\s]+i can/i,
  /let me know if you want/i,
  /let me know if you(?:'d| would)? like/i,
  /hope this helps/i,
  /as a reminder/i,
  /如果你愿意[，,\s]*(我|这边)?可以/,
  /如果你需要[，,\s]*(我|这边)?可以/,
  /需要的话[，,\s]*(我|这边)?可以/,
  /想的话[，,\s]*(我|这边)?可以/,
  /希望这(?:些|个)?对你有帮助/,
  /接住你的情绪/,
  /你先别慌/,
  /你放心/,
];

export function detectInternalInfoLeak(text = "") {
  return INTERNAL_INFO_PATTERNS.some((pattern) => pattern.test(text));
}

export function detectAssistantSelfExposure(text = "") {
  return SELF_EXPOSURE_PATTERNS.some((pattern) => pattern.test(text));
}

export function detectStructuredReplyLeak(text = "") {
  return STRUCTURED_FIELD_PATTERN.test(text);
}

export function detectMarkdownFormatting(text = "") {
  return MARKDOWN_PATTERNS.some((pattern) => pattern.test(text));
}

export function detectIncompleteEnding(text = "", language = "en") {
  const english = ["en", "english"].includes(String(language).toLowerCase().split(/[-_]/)[0]);
  const unclosedQuote = /"$/.test(text) && (text.match(/(?<!\\)"/g) || []).length % 2 === 1;
  return unclosedQuote || INCOMPLETE_ENDING_PATTERNS.some((pattern, index) => (index > 1 || english) && pattern.test(text));
}

export function detectTemplateTone(text = "") {
  return TEMPLATE_TONE_PATTERNS.some((pattern) => pattern.test(text));
}

export function sanitizeTemplateTone(text = "") {
  return splitSentences(safeString(text))
    .filter((sentence) => !TEMPLATE_TONE_PATTERNS.some((pattern) => pattern.test(sentence)))
    .join(" ")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([.!?。！？])/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function splitSentences(text = "") {
  const source = safeString(text);
  if (!source) return [];
  const matches = source.match(/[^.!?。！？]+[.!?。！？]+|[^.!?。！？]+$/g);
  return (matches || [source]).map((item) => item.trim()).filter(Boolean);
}

export function sanitizeMarkdownFormatting(text = "") {
  return safeString(text)
    .replace(/```(?:[\w-]+)?\s*([\s\S]*?)```/g, "$1")
    .replace(/(^|\n)\s{0,3}#{1,6}\s+/g, "$1")
    .replace(/\*\*([^*\n]+?)\*\*/g, "$1")
    .replace(/__([^_\n]+?)__/g, "$1")
    .replace(/(^|\n)\s*[-*+]\s+/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function extractStructuredDisplayText(text = "") {
  const normalized = stripJsonCodeFence(text);
  const parsed = parseFirstJsonObject(normalized);
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    return safeString(parsed.displayText || parsed.content || parsed.reply || parsed.text);
  }

  return extractQuotedField(normalized, ["displayText", "content", "reply", "text"]);
}

function stripJsonCodeFence(text = "") {
  return safeString(text)
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function parseFirstJsonObject(text = "") {
  const source = safeString(text);
  if (!source) return null;
  try {
    return JSON.parse(source);
  } catch {}

  const start = source.indexOf("{");
  const end = source.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(source.slice(start, end + 1));
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

function decodeJsonStringFragment(text = "") {
  const raw = safeString(text);
  if (!raw) return "";
  try {
    return JSON.parse(`"${raw.replace(/"/g, '\\"')}"`).trim();
  } catch {
    return raw.replace(/\\"/g, "\"").replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\t/g, "\t").trim();
  }
}

function safeString(value = "") {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}
