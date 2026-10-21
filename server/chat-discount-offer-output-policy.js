import { stripTtsControlTags } from "./tts-emotion-tag-service.js";
import { isAiTransportFallback } from "./ai-reply-fallback-service.js";
import { isDiscountPolicyExplanation, hasUnauthorizedDiscountPolicyClaim } from "./discount-policy-explanation-service.js";

const DISCOUNT_SIGNAL = /(?:折扣|优惠|优惠码|折扣码|促销码|兑换码|打折|优惠券|你的码|有.{0,6}码|省钱)|\b(?:discount|promo|coupon|voucher)\b|\b(?:offer|deal|benefit|reward)\s+code\b|\b(?:special|member|loyalty)\s+(?:offer|deal|benefit|reward)\b|\b(?:any|a|the|your|promo|sale|member)\s+(?:offers?|deals?|sales?|benefits?|rewards?|code)\b|\bcode\s+(?:for|to use)\b|\bsave\s+(?:me\s+)?money\b/i;
const ALL_OFFERS_SIGNAL = /(?:全部|所有|有哪些|列出)|\b(?:all|list)\b.*\b(?:discount|promo|coupon|voucher|codes?|offers?)\b|\b(?:what|which)\s+(?:are\s+)?(?:all\s+)?(?:the\s+|your\s+)?(?:discount\s+|promo\s+|coupon\s+|voucher\s+)?(?:codes|offers)\b/i;
const OTHER_OFFER_SIGNAL = /^(?:还有吗|还有别的吗|还有其他的吗|另一个呢|下一个呢|anything else\??|any more\??|another one\??|next one\??)$/i;
const NO_OFFER_MARKER = /(?:没有可以确认的有效折扣码|暂时还没有可以用的折扣码)|(?:don[’']t have (?:a verified discount code|a discount code for you right now))/i;
export const DISCOUNT_OFFER_MENTION_DIRECTIVE = "[MENTION_DISCOUNT_OFFER]";

export function enforceDiscountOfferReplyPolicy({ replyResult = {}, offers = [], userText = "", language = "", recentMessages = [], allowDiscountMention = false, searchIntent = null } = {}) {
  if (isAiTransportFallback(replyResult)) return replyResult;
  const safeOffers = normalizeOffers(offers);
  const text = String(replyResult?.text || "").trim();
  const speechText = String(replyResult?.speechText || text).trim();
  const combined = `${text}\n${speechText}`;
  const directiveRequested = combined.includes(DISCOUNT_OFFER_MENTION_DIRECTIVE);
  const replyWithoutDirective = removeDiscountMentionDirective(replyResult);
  const historyText = (Array.isArray(recentMessages) ? recentMessages : []).map((message) => String(message?.text || message?.text_content || "")).join("\n");
  const mentionedCodes = new Set(safeOffers.filter((offer) => historyText.includes(offer.code)).map((offer) => offer.code));
  const normalizedUserText = String(userText || "").trim();
  const normalizedFollowupText = normalizedUserText.replace(/[?？!！。\s]+$/g, "");
  const isAllOffersRequest = ALL_OFFERS_SIGNAL.test(normalizedUserText);
  const isDiscountFollowup = OTHER_OFFER_SIGNAL.test(normalizedFollowupText) && (mentionedCodes.size > 0 || NO_OFFER_MARKER.test(historyText));
  const isUserDiscountRequest = DISCOUNT_SIGNAL.test(normalizedUserText) || isAllOffersRequest || isDiscountFollowup;

  if (isDiscountPolicyExplanation(searchIntent, userText)) {
    const policyValues = [replyWithoutDirective.text, replyWithoutDirective.speechText];
    const hasActualOffer = policyValues.some((value) => hasUnauthorizedDiscountPolicyClaim(String(value || ""), { userText })
      || safeOffers.some((offer) => containsExactCode(value, offer.code)));
    return hasActualOffer
      ? removeUnexpectedDiscountContent(replyWithoutDirective, { userText, language, safeOffers, discountPolicyExplanation: true })
      : ensureReplyContent(replyWithoutDirective, { userText, language });
  }

  if (!safeOffers.length && isUserDiscountRequest) return withSafeReply(replyResult, buildNoOfferReply({ userText, language }));
  if (!safeOffers.length && directiveRequested) {
    return replyContainsDiscountMention(replyWithoutDirective, safeOffers, { userText })
      ? removeUnexpectedDiscountContent(replyWithoutDirective, { userText, language, safeOffers })
      : ensureReplyContent(replyWithoutDirective, { userText, language });
  }
  if (isAllOffersRequest) {
    return withSafeReply(replyResult, buildVerifiedOffersReply(safeOffers, { userText, language }), safeOffers);
  }
  if (isDiscountFollowup) {
    const nextOffer = safeOffers.find((offer) => !mentionedCodes.has(offer.code));
    if (!nextOffer) return withSafeReply(replyResult, buildNoMoreOffersReply({ userText, language }));
    return withSafeReply(replyResult, buildVerifiedOfferReply(nextOffer, { userText, language }), [nextOffer]);
  }
  if (isUserDiscountRequest || (allowDiscountMention && directiveRequested)) {
    return withSafeReply(replyResult, buildVerifiedOfferReply(safeOffers[0], { userText, language }), [safeOffers[0]]);
  }
  if (replyContainsDiscountMention(replyWithoutDirective, safeOffers, { userText })) {
    return removeUnexpectedDiscountContent(replyWithoutDirective, { userText, language, safeOffers });
  }
  return ensureReplyContent(replyWithoutDirective, { userText, language });
}

function normalizeOffers(offers = []) {
  const seen = new Set();
  return (Array.isArray(offers) ? offers : [])
    .map((offer) => ({
      code: String(offer?.code || "").trim(),
      offerDescription: String(offer?.offerDescription || "").trim(),
    }))
    .filter((offer) => offer.code && offer.offerDescription)
    .filter((offer) => {
      const key = offer.code.toUpperCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 5);
}

function buildNoOfferReply(context = {}) {
  return isChineseContext(context)
    ? "暂时还没有可以用的折扣码，有新的我再告诉你。"
    : "I don’t have a discount code for you right now, but I’ll let you know when I do.";
}

function buildVerifiedOfferReply(offer, context = {}) {
  return isChineseContext(context)
    ? `有呀，用 ${offer.code} 可以享受 ${offer.offerDescription}，结账时记得填上。`
    : `Yep — use ${offer.code} for ${offer.offerDescription} when you check out.`;
}

function buildVerifiedOffersReply(offers = [], context = {}) {
  const details = offers.map((offer) => `${offer.code}: ${offer.offerDescription}`).join(isChineseContext(context) ? "；" : "; ");
  return isChineseContext(context)
    ? `有呀，目前可以用的是：${details}。`
    : `Yep — these are available right now: ${details}.`;
}

function buildNoMoreOffersReply(context = {}) {
  return isChineseContext(context)
    ? "目前能用的就是这些啦，有新的我再告诉你。"
    : "That’s everything available right now — I’ll let you know if another one comes up.";
}

function isChineseContext({ userText = "", language = "" } = {}) {
  return /[\u3400-\u9fff]|Chinese|Mandarin|中文|汉语/i.test(`${language} ${userText}`);
}

function containsExactCode(value = "", code = "") {
  const target = String(code || "").trim();
  if (!target) return false;
  return new RegExp(`(^|[^a-z0-9_-])${escapeRegExp(target)}(?=$|[^a-z0-9_-])`, "i").test(String(value || ""));
}

function containsDiscountMention(value = "", safeOffers = [], { userText = "" } = {}) {
  const text = normalizeDiscountDetectionText(value);
  if (DISCOUNT_SIGNAL.test(text)) return true;
  if (safeOffers.some((offer) => containsExactCode(text, offer.code))) return true;
  if (containsSuspiciousCodeToken(text, { userText })) return true;
  return /\b(?:use|enter|apply|try)\s+[a-z0-9_-]{4,}\b|\b(?:code|promo|coupon|voucher)\b|\bbonus\b|\b\d+(?:[.,]\d+)?\s*%\s*off\b|[$€£¥]\s*\d+(?:[.,]\d+)?\s*off\b|\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|forty|fifty|half)\s+(?:percent\s+off|price)\b|\bfree shipping\b|\b(?:extra|another|additional|second)\s+(?:discount|offer|deal|code)\b|\bsav(?:e|es|ing)\b[^.!?。！？]{0,24}\b(?:money|percent|checkout)\b/i.test(text)
    || /(?:优惠码|折扣码|促销码|兑换码|优惠券|包邮|免邮|额外优惠|其他优惠|另一个优惠)/.test(text);
}

function normalizeDiscountDetectionText(value = "") {
  return stripTtsControlTags(value)
    .replace(/(?:^|\s)\[[a-z][a-z0-9 _-]{0,31}\]\s*/gi, " ")
    .replace(/<[^>]{1,128}>/g, " ")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function replyContainsDiscountMention(replyResult = {}, safeOffers = [], context = {}) {
  return valueContainsDiscountMention(replyResult?.text, safeOffers, context)
    || valueContainsDiscountMention(replyResult?.speechText || replyResult?.text, safeOffers, context);
}

function valueContainsDiscountMention(value = "", safeOffers = [], context = {}) {
  const text = String(value || "");
  if (containsDiscountMention(text, safeOffers, context)) return true;
  const sentences = text.match(/[^.!?。！？]+[.!?。！？]?/g) || [];
  return sentences.some((sentence) => containsDiscountMention(sentence.trim(), safeOffers, context));
}

function containsSuspiciousCodeToken(value = "", { userText = "" } = {}) {
  const text = String(value || "");
  const expectsOrdinaryIdentifier = /(?:型号|编号|游戏|主机|版本|球员|比分|年份|尺码|尺寸)|\b(?:which|what|name|tell me)\b[^?？.!。！]{0,40}\b(?:game|console|model|version|sku|product|player|score|year|number|size|identifier)\b/i.test(String(userText || ""));
  const expectsOrdinaryRuleStatement = /(?:政策|规则|条件|条款|要求)|\b(?:policy|rule|condition|term|requirement|law)\b/i.test(String(userText || ""));
  for (const match of text.matchAll(/(^|[^a-z0-9_-])([a-z][a-z0-9_-]{2,31})(?=$|[^a-z0-9_-])/gi)) {
    const token = String(match[2] || "");
    const hasDigit = /\d/.test(token);
    const hasCouponLexeme = /(?:free|ship|save|off|deal|promo|sale|vip|welcome|discount|coupon|voucher|offer)/i.test(token);
    const letters = token.replace(/[^a-z]/gi, "");
    const looksUppercase = Boolean(letters) && letters === letters.toUpperCase();
    const hasCodeShape = hasDigit || hasCouponLexeme || looksUppercase;
    const parts = text
      .split(/\s+/)
      .map((part) => part.replace(/^[^a-z0-9_-]+|[^a-z0-9_-]+$/gi, ""))
      .filter(Boolean);
    const isBareToken = (hasDigit || hasCouponLexeme)
      && !expectsOrdinaryIdentifier
      && parts.length > 0
      && parts.every((part) => part.toLowerCase() === token.toLowerCase());
    const hasStrongPrefixCue = new RegExp(
      `\\b(?:here(?:'|’)s|use|enter|apply|try|claim|redeem|code|promo|coupon|voucher)\\s+${escapeRegExp(token)}\\b`,
      "i",
    ).test(text);
    const hasCheckoutSuffixCue = new RegExp(
      `\\b${escapeRegExp(token)}\\b\\s+(?:at|for)\\s+checkout\\b`,
      "i",
    ).test(text);
    const hasDirectSuffixCue = hasCodeShape && new RegExp(
      `\\b${escapeRegExp(token)}\\b\\s+(?:(?:is\\s+)?(?:valid|available)|works?|applies?|gives?|gets?|saves?|redeems?)\\b`,
      "i",
    ).test(text);
    const hasBareAssertionCue = !expectsOrdinaryRuleStatement && new RegExp(
      `^\\s*${escapeRegExp(token)}\\s+(?:(?:is\\s+)?valid|works?|applies?)\\s*[.!?。！？]?\\s*$`,
      "i",
    ).test(text);
    const hasWeakUsageCue = hasCodeShape && new RegExp(
      `\\b(?:grab|get|take|with)\\s+(?:it\\s+)?${escapeRegExp(token)}\\b`,
      "i",
    ).test(text);
    if (isBareToken || hasStrongPrefixCue || hasCheckoutSuffixCue || hasDirectSuffixCue || hasBareAssertionCue || hasWeakUsageCue) return true;
  }
  return false;
}

function escapeRegExp(value = "") {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function removeUnexpectedDiscountContent(replyResult = {}, { userText = "", language = "", safeOffers = [], discountPolicyExplanation = false } = {}) {
  const fallback = isChineseContext({ userText, language })
    ? "我在呢，想聊点什么？"
    : "I’m here — what do you feel like talking about?";
  const cleanedText = stripDiscountSentences(replyResult?.text, safeOffers, { userText, discountPolicyExplanation });
  const cleanedSpeechText = stripDiscountSentences(replyResult?.speechText || replyResult?.text, safeOffers, { userText, discountPolicyExplanation });
  const safeText = stripTtsControlTags(cleanedText || cleanedSpeechText) || fallback;
  return {
    ...replyResult,
    text: safeText,
    displayText: safeText,
    speechText: safeText,
  };
}

function stripDiscountSentences(value = "", safeOffers = [], context = {}) {
  const sentences = String(value || "").match(/[^.!?。！？]+[.!?。！？]?/g) || [];
  return sentences
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .filter((sentence) => !containsDiscountMention(sentence, safeOffers, context)
      && !(context.discountPolicyExplanation && hasUnauthorizedDiscountPolicyClaim(sentence, context)))
    .join(" ")
    .trim();
}

function removeDiscountMentionDirective(replyResult = {}) {
  const clean = (value = "") => String(value || "")
    .replaceAll(DISCOUNT_OFFER_MENTION_DIRECTIVE, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([,.!?。！？])/g, "$1")
    .trim();
  const text = clean(replyResult?.text);
  const speechText = clean(replyResult?.speechText || replyResult?.text);
  return {
    ...replyResult,
    text,
    displayText: text,
    speechText,
  };
}

function ensureReplyContent(replyResult = {}, { userText = "", language = "" } = {}) {
  const text = String(replyResult?.text || "").trim();
  if (text) return replyResult;
  const fallback = isChineseContext({ userText, language })
    ? "我在呢，想聊点什么？"
    : "I’m here — what do you feel like talking about?";
  return {
    ...replyResult,
    text: fallback,
    displayText: fallback,
    speechText: fallback,
  };
}

function withSafeReply(replyResult = {}, value = "", offers = []) {
  return {
    ...replyResult,
    text: value,
    displayText: value,
    speechText: value,
    discountOfferReply: true,
    verifiedDiscountOffers: offers.map(({ code, offerDescription }) => ({ code, offerDescription })),
  };
}
