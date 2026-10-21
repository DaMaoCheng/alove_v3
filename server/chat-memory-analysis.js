const FOOTBALL_TOPIC_RULES = Object.freeze([
  { topic: "match_result", patterns: [/赢了|输了|绝平|绝杀|进球|丢球|比分|win|lost|goal|score/i] },
  { topic: "referee", patterns: [/裁判|点球|var|越位|红牌|黄牌|referee|penalty|offside/i] },
  { topic: "transfer", patterns: [/转会|签约|买人|卖人|租借|transfer|signing|loan/i] },
  { topic: "tactics", patterns: [/阵型|战术|压迫|防守|进攻|控球|formation|tactic|press/i] },
  { topic: "kit_merch", patterns: [/球衣|队服|围巾|周边|kit|jersey|scarf|merch/i] },
]);

const EMOTION_RULES = Object.freeze([
  { tag: "excited", patterns: [/爽|燃|牛|太强|绝了|激动|excited|hyped|amazing/i] },
  { tag: "frustrated", patterns: [/烦|服了|离谱|崩|气死|难受|frustrated|annoyed|mad/i] },
  { tag: "disappointed", patterns: [/失望|可惜|心碎|拉胯|disappointed|sad|heartbroken/i] },
]);

const INTENT_RULES = Object.freeze([
  { tag: "vent", patterns: [/真服了|气死|烦死|离谱|吐槽|rant|vent/i] },
  { tag: "analysis", patterns: [/怎么看|分析|为什么|原因|战术|复盘|why|analyze|analysis/i] },
  { tag: "prediction", patterns: [/预测|猜|会不会|能不能赢|prediction|predict|will .* win/i] },
  { tag: "memory_recall", patterns: [/还记得|之前说|上次聊|remember|last time/i] },
]);

const COMMON_STOP_WORDS = new Set([
  "the", "and", "you", "are", "for", "with", "that", "this", "what", "why",
  "怎么", "什么", "这个", "那个", "就是", "真的", "现在", "今天",
]);

export function analyzeMessageText(text = "") {
  const normalized = String(text || "").trim();
  return {
    keywords: extractKeywords(normalized),
    topics: matchRuleTags(normalized, FOOTBALL_TOPIC_RULES),
    entities: extractEntities(normalized),
    emotionTags: matchRuleTags(normalized, EMOTION_RULES),
    intentTags: matchRuleTags(normalized, INTENT_RULES),
  };
}

export function scoreMessageImportance({ text, senderType, contentType, analysis }) {
  let score = 20;
  const length = String(text || "").trim().length;
  if (senderType === "user") score += 10;
  if (contentType === "attachment") score += 10;
  if (length > 40) score += 10;
  if (length > 120) score += 10;
  if (analysis.topics.length) score += 15;
  if (analysis.intentTags.includes("memory_recall")) score += 20;
  if (analysis.emotionTags.length) score += 10;
  return normalizeScore(score, 20);
}

export function normalizeScore(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.min(100, numeric));
}

function extractKeywords(text = "") {
  const words = String(text || "")
    .match(/[\u4e00-\u9fa5]{2,}|[A-Za-z][A-Za-z0-9'-]{2,}/g) || [];
  const seen = new Set();
  return words
    .map((word) => word.trim())
    .filter((word) => word && !COMMON_STOP_WORDS.has(word.toLowerCase()))
    .filter((word) => {
      const key = word.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 12);
}

function extractEntities(text = "") {
  const entities = String(text || "").match(/\b[A-Z][A-Za-z0-9'-]*(?:\s+[A-Z][A-Za-z0-9'-]*){0,3}\b/g) || [];
  return [...new Set(entities.map((item) => item.trim()).filter(Boolean))].slice(0, 8);
}

function matchRuleTags(text = "", rules = []) {
  return rules
    .filter((rule) => rule.patterns.some((pattern) => pattern.test(text)))
    .map((rule) => rule.tag || rule.topic)
    .filter(Boolean);
}
