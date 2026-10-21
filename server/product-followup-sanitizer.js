import { applyContextualEmotionTags } from "./tts-emotion-routing-service.js";
import { stripTtsControlTags } from "./tts-emotion-tag-service.js";

const DEFAULT_FOLLOWUP = "This one fits the moment nicely.";

export function sanitizeProductFollowupText(text = "", product = {}) {
  return normalizeProductFollowupReply({ text, speechText: text, product }).displayText;
}

export function normalizeProductFollowupReply({ text = "", speechText = "", product = {}, userText = "", sourceType = "ai", protectedLiterals = [], preserveAnswer = false } = {}) {
  const source = safeString(preserveAnswer ? (text || speechText) : (speechText || text));
  const protectedText = protectLiterals(source, protectedLiterals);
  const cleaned = preserveAnswer
    ? removeUrls(removeJsonFragments(protectedText.text)).replace(/\s{2,}/g, " ").trim()
    : sanitizeProductFollowupSpeechText(protectedText.text, product);
  const aligned = applyContextualEmotionTags({
    speechText: cleaned,
    displayText: stripTtsControlTags(cleaned),
    userText,
    sourceType,
  });
  const restoredSpeechText = normalizeCjkPunctuationSpacing(
    restoreProtectedLiterals(aligned.speechText, protectedText.placeholders),
  );
  const restoredDisplayText = normalizeCjkPunctuationSpacing(restoreProtectedLiterals(
    stripTtsControlTags(aligned.speechText),
    protectedText.placeholders,
  ));
  return {
    displayText: restoredDisplayText,
    speechText: restoredSpeechText,
  };
}

function sanitizeProductFollowupSpeechText(text = "", product = {}) {
  const source = safeString(text);
  if (looksLikeLeakedProductJson(source)) return DEFAULT_FOLLOWUP;
  if (looksLikeAiFallbackText(source)) return buildProductAwareFallback(product);
  const cleaned = [
    removeJsonFragments,
    removeUrls,
    removePrices,
    removeStockWords,
    removeSelfDenyingSalesLanguage,
    removeProductFieldFragments,
    normalizeSeparators,
  ].reduce((value, step) => step(value, product), source);

  const sentence = pickBestSentence(cleaned);
  if (mentionsUnrelatedProductTitle(sentence, product)) return DEFAULT_FOLLOWUP;
  return ensureTerminalPunctuation(sentence || DEFAULT_FOLLOWUP) || DEFAULT_FOLLOWUP;
}

function protectLiterals(value = "", literals = []) {
  let text = String(value || "");
  const placeholders = [];
  for (const literal of [...new Set((Array.isArray(literals) ? literals : []).map(safeString).filter(Boolean))]) {
    const placeholder = `AioveProtectedLiteral${placeholders.length}Token`;
    const matcher = new RegExp(escapeRegExp(literal), "gi");
    if (!matcher.test(text)) continue;
    text = text.replace(matcher, placeholder);
    placeholders.push({ placeholder, literal });
  }
  return { text, placeholders };
}

function restoreProtectedLiterals(value = "", placeholders = []) {
  return placeholders.reduce(
    (text, item) => text.replaceAll(item.placeholder, item.literal),
    String(value || ""),
  );
}

function normalizeCjkPunctuationSpacing(value = "") {
  return String(value || "")
    .replace(/\s+([，。！？；：、])/g, "$1")
    .replace(/([，。！？；：、])\s+/g, "$1");
}

function looksLikeAiFallbackText(text) {
  const value = safeString(text);
  if (!value) return false;
  if (/^I['’]?m here,?\s*bro\.?$/i.test(value)) return true;
  return /\bI['’]?m here\b/i.test(value) && (
    /\breply glitched\b/i.test(value) ||
    /\bproduct search took a bad first touch\b/i.test(value) ||
    /\bsend me the team\b/i.test(value) ||
    /\btry again\b/i.test(value)
  );
}

function buildProductAwareFallback(product = {}) {
  const productText = [
    product.name,
    product.subtitle,
    product.summary,
    product.tag,
    ...(Array.isArray(product.features) ? product.features : []),
  ].filter(Boolean).join(" ");
  const productSubject = safeString(product.subtitle);
  if (productSubject) return `This one fits your ${productSubject} mood nicely.`;
  if (/\bretro\b/i.test(productText)) return "This one fits the retro mood nicely.";
  if (/\b(?:home|away|third|kit|shirt|jersey)\b/i.test(productText)) return "This one fits the matchday mood nicely.";
  return DEFAULT_FOLLOWUP;
}

function mentionsUnrelatedProductTitle(text = "", product = {}) {
  const value = safeString(text);
  const productSubject = safeString(product.subtitle);
  if (!value || !productSubject) return false;
  const containsProductTitleShape = /\b(?:home|away|third|3rd|retro)\b[\s\S]{0,80}\b(?:shirt|jersey|kit)\b|\b(?:football|soccer)\s+(?:shirt|jersey|kit)\b/i.test(value);
  if (!containsProductTitleShape) return false;
  return !value.toLowerCase().includes(productSubject.toLowerCase());
}

function looksLikeLeakedProductJson(text) {
  const value = safeString(text);
  if (!value) return false;
  if (!/[{}]/.test(value)) return false;
  if (!/"?(?:product|price|originalPrice|url|subtitle|name)"?\s*:/i.test(value)) return false;
  const stripped = value
    .replace(/\{[\s\S]*\}/g, " ")
    .replace(/[{}\[\]":,0-9.]/g, " ")
    .trim();
  return !stripped || stripped.length < 16;
}

function removeKnownProductValues(text, product = {}) {
  let value = text;
  for (const key of ["name", "priceNow", "priceWas", "subtitle", "stock", "url", "code", "tag"]) {
    const productValue = safeString(product[key]);
    if (!productValue) continue;
    value = removeLiteral(value, productValue);
    try {
      value = removeLiteral(value, decodeURIComponent(productValue));
    } catch {
      // Keep the original text if a product URL contains malformed escape sequences.
    }
  }
  return value;
}

function removeJsonFragments(text) {
  return text
    .replace(/\{[\s\S]*\}/g, " ")
    .replace(/\b(?:product|name|subtitle|price|originalPrice|priceWas|url)\b\s*:\s*[^.!?。！？;；]+/gi, " ");
}

function removeUrls(text) {
  return text
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/(?:^|\s)\/[a-z0-9/_-]+(?:\?[^\s]*)?/gi, " ");
}

function removePrices(text) {
  return text
    .replace(/\b(?:GBP|USD|EUR|JPY|CNY|RMB|HKD|AUD|CAD|BRL|MXN)\s*[$€£¥]?\s*\d+(?:[.,]\d{1,2})?\b/gi, " ")
    .replace(/[$€£¥]\s*\d+(?:[.,]\d{1,2})?\b/g, " ")
    .replace(/\b\d+(?:[.,]\d{1,2})?\s*(?:GBP|USD|EUR|JPY|CNY|RMB|HKD|AUD|CAD|BRL|MXN)\b/gi, " ");
}

function removeStockWords(text) {
  return text.replace(/\b(?:in stock|out of stock|available|sold out|restock|supporter edition)\b/gi, " ")
    .replace(/现货|有货|缺货|补货|球迷版|球员版/g, " ");
}

function removeProductFieldFragments(text) {
  return text.replace(/\b(?:price|stock|subtitle|summary|url|link|code|promo code|original price)\s*:\s*[^.!?。！？;；]+/gi, " ");
}

function removeSelfDenyingSalesLanguage(text) {
  return text
    .replace(/\bI\s+(?:do\s+not|don't|don’t)\s+(?:personally\s+)?(?:sell|stock)\s+shirts?\s*(?:myself)?\b[,\s—–-]*/gi, " ")
    .replace(/\bI\s+(?:do\s+not|don't|don’t)\s+sell\s+shirts?\s+myself\b[,\s—–-]*/gi, " ")
    .replace(/\bI\s+can(?:not|'t|’t)\s+say\s+(?:I(?:'ve|’ve)?\s+)?got\s+one\s+in\s+stock\b[,\s—–-]*/gi, " ")
    .replace(/我(?:自己)?(?:不卖|没有卖|不囤|没有囤)(?:衣服|球衣|队服)[，,\s]*/g, " ");
}

function normalizeSeparators(text) {
  return text
    .replace(/[|•]+/g, " ")
    .replace(/\s*[—–-]\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function pickBestSentence(text) {
  const value = safeString(text);
  if (!value) return "";
  const parts = value
    .split(/(?<=[.!?。！？])\s+|[；;]/u)
    .map((part) => part.trim())
    .filter(Boolean);
  const candidates = parts.length ? parts : [value];
  return candidates
    .map(removeLeadingLooseMetadata)
    .filter((item) => item && !looksLikeMetadataOnly(item))
    .sort((a, b) => scoreSentence(b) - scoreSentence(a))[0] || "";
}

function removeLeadingLooseMetadata(text) {
  return safeString(text)
    .replace(/^(?:[A-Z][A-Za-z0-9' ]{1,40}\s+){1,4}(?=that\b|this\b|it\b|these\b|those\b)/i, "")
    .replace(/^[,，.。:：\s]+/, "")
    .trim();
}

function looksLikeMetadataOnly(text) {
  const value = safeString(text);
  if (!value) return true;
  if (/^(?:recommended|recommendation|quick_product|budget|sizing|stock)$/i.test(value)) return true;
  if (!/[a-z\u4e00-\u9fff]/i.test(value)) return true;
  return value.length < 4;
}

function scoreSentence(text) {
  let score = 0;
  if (/\b(that|this|it|these|those|fits|suits|clean|perfect|proper|nice|easy|winner)\b/i.test(text)) score += 3;
  if (/适合|挺配|很搭|正好|不错|拿下|安排|氛围|感觉/.test(text)) score += 3;
  if (text.length <= 180) score += 2;
  if (text.length > 180) score -= 3;
  return score;
}

function ensureTerminalPunctuation(text) {
  const value = safeString(text).replace(/[。.!?！？]+$/u, "");
  if (!value) return "";
  return `${value}${/[\u4e00-\u9fff]/.test(value) ? "。" : "."}`;
}

function removeLiteral(text, literal) {
  const value = safeString(text);
  const needle = safeString(literal);
  if (!needle) return value;
  return value.replace(new RegExp(escapeRegExp(needle), "gi"), " ");
}

function escapeRegExp(value) {
  return safeString(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function safeString(value = "") {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}
