import { isTrackingReference } from "./chat-feedback-action-service.js";

const SIZE_TOKEN_PATTERN = /^\d{1,2}X{1,4}L$/i;

export function isDiscountPolicyExplanation(searchIntent, userText) {
  const evidence = String(searchIntent?.discountExplanationEvidence || "").trim();
  return searchIntent?.discountExplanationRequired === true && Boolean(evidence)
    && String(userText || "").includes(evidence);
}

export function hasUnauthorizedDiscountPolicyClaim(text, { userText = "" } = {}) {
  // An explanation exception never authorizes disclosing a coupon token. Size
  // and tracking references remain independent of promotion eligibility.
  const tokens = text.match(/\b(?=[A-Z0-9_-]{4,}\b)(?=[A-Z0-9_-]*[A-Z])(?=[A-Z0-9_-]*\d)[A-Z0-9_-]+\b/gi) || [];
  if (tokens.some((token) => !SIZE_TOKEN_PATTERN.test(token)
    && !(isTrackingReference(token) && String(userText).includes(token)))) return true;
  if (/^[A-Z][A-Z0-9_-]{3,}[.!。！]?$/.test(text.trim())) return true;
  const namedCode = /(?:\b(?:promo|discount|coupon|voucher)\s+code|优惠码|折扣码|兑换码|促销码)\s*(?:is|:|：|=|是)?\s*([A-Z][A-Z0-9_-]{3,})\b/gi;
  const hasNamedCode = [...text.matchAll(namedCode)].some((match) => match[1] === match[1].toUpperCase());
  if (hasNamedCode || /\b(?:use|apply|enter)\s+(?:the\s+)?(?:code\s+)?[A-Z][A-Z0-9_-]{3,}\b/.test(text)
    || /(?:使用|输入|用)\s*[A-Z][A-Z0-9_-]{3,}/.test(text)) return true;
  // Check each claim separately: a denial cannot authorize a later affirmative
  // offer. A percentage needs promotion semantics; numeric logistics/specification
  // facts do not grant a benefit, even when the classifier selected policy explanation.
  const clauses = text.split(/[!?;。！？；\n]|\.(?!\d)|\b(?:but|however|pero|sin embargo)\b|但是|但你|不过/iu);
  return clauses.some((clause) => {
    const affirmativeGrant = /\b(?:i|we)\s+(?:(?:can|will|shall)\s+)?(?:give|grant|offer|provide|get|guarantee|promise|apply|activate)\b[^.!?;]{0,80}\b(?:discount|coupon|promo|voucher|benefit|reward|entitlement)\b/iu.test(clause)
      || /\b(?:you(?:'ll|’ll|\s+(?:will|can))?\s+(?:get|receive|have|qualify)|you\s+are\s+eligible)\b[^.!?;]{0,60}\b(?:discount|coupon|promo|voucher|benefit|reward|entitlement)\b/iu.test(clause)
      || /\byour\s+(?:discount|coupon|benefit|reward)\s+(?:is|will\s+be)\s+(?:approved|available|active|guaranteed|granted)\b/iu.test(clause)
      || /(?:给你|为你发放|你可以享受|你将获得|保证你|承诺给你).{0,40}(?:折扣|优惠|权益|奖励)/u.test(clause)
      || /\b(?:te\s+(?:doy|damos|ofrezco|ofrecemos|garantizo)|(?:tienes|recibes|recibirás)\s+(?:un\s+)?(?:descuento|cupón|beneficio))\b/iu.test(clause);
    if (affirmativeGrant) return true;
    const promotionPercentage = /\b(?:discount|coupon|promo|voucher|benefit|reward|entitlement|descuento|cup[oó]n|beneficio)\b|(?:折扣|优惠|权益|奖励)|[%％]\s*off\b/iu.test(clause)
      || /\bsave\s+\d+(?:[.,]\d+)?\s*[%％](?:\s+(?:today|now))?\s*$/iu.test(clause)
      || /\bsav(?:e|ing|ings)\b[^.!?;]{0,50}\b(?:money|price|cost|order|purchase|checkout)\b/iu.test(clause);
    for (const percentage of clause.matchAll(/\d+(?:[.,]\d+)?\s*[%％]/gu)) {
      if (!promotionPercentage) continue;
      const before = clause.slice(0, percentage.index);
      const after = clause.slice(percentage.index + percentage[0].length);
      const deniedBefore = /(?:\b(?:cannot|can't|can’t|won't|won’t|unable to|not able to)\s+(?:promise|guarantee|confirm|offer|give|provide|apply)|\b(?:no puedo|no podemos)\s+(?:prometer|garantizar|confirmar|ofrecer)|不能|无法|不承诺|不保证)(?:(?!\band\b|\bor\b)[^,;.!?]){0,35}$/iu.test(before);
      const deniedAfter = /^[^,;.!?]{0,25}\b(?:is\s+not|isn't|isn’t|cannot\s+be)\s+(?:guaranteed|promised|confirmed|approved)/iu.test(after);
      if (!deniedBefore && !deniedAfter) return true;
    }
    return /\b(?:discount|coupon|benefit|reward|entitlement)\b[^.!?;]{0,30}\b(?:is|has\s+been)\s+(?:guaranteed|approved|activated|granted)\b/iu.test(clause);
  });
}
