import { hasCheckoutIssue } from "./checkout-support-guidance.js";
import { resolveOrderActionPromptState } from "./chat-global-reply-policy.js";
import { normalizeProductFollowupReply } from "./product-followup-sanitizer.js";
import { resolveProductSizingGuidanceReply } from "./product-sizing-guidance-service.js";
import { isTrackingReference } from "./chat-feedback-action-service.js";
import { buildGuestProductReplyCopy, buildUnconfirmedProductStateReply, buildGuestProductTonePrefix, resolveGuestProductReplyLanguage } from "./guest-product-reply-copy.js";
import { isDiscountPolicyExplanation, hasUnauthorizedDiscountPolicyClaim } from "./discount-policy-explanation-service.js";
import { getChatImageStatusCopy } from "./chat-image-copy-service.js";
import { toImageStatusReviewContext, getChatImageStatusFallbackCopy } from "./chat-image-status-context-service.js";
import { getGuestBenefitReviewContext, isGuestBenefitReplyReviewed, isControlledGuestBenefitCopy, buildGuestBenefitFallback } from "./guest-benefit-guidance-service.js";
import { hasPendingProductRequest } from "./product-request-scope-service.js";

const GUEST_DISCOUNT_NOTICE = "Discounts are available after you create an account.";
const CODE_PATTERNS = [
  /\b(?:use|enter|apply)\s+(?:the\s+)?(?:promo\s+|discount\s+|coupon\s+)?code\s+[A-Z0-9][A-Z0-9_-]{3,}\b/gi,
  /\b(?:promo|discount|coupon)\s+code\s*[:\-]?\s*[A-Z0-9][A-Z0-9_-]{3,}\b/gi,
];
const PROMOTION_REQUEST_PATTERN = /(?:折扣|优惠|优惠码|折扣码|促销码|兑换码|权益|奖励)|\b(?:discount|promo|coupon|offer|deal|voucher|benefit|reward|sale)\b/i;
const SIZE_TOKEN_PATTERN = /^\d{1,2}X{1,4}L$/i;
export function applyGuestProductClarificationPromptPolicy(promptContext = {}, {
  productRequested = false,
  product = null,
  searchIntent = {},
  skipProductClarification = false,
} = {}) {
  if (hasPendingProductRequest(searchIntent)) return promptContext;
  if (
    !productRequested
    || product
    || skipProductClarification
    || searchIntent?.customerServiceKnowledgeRequest
    || !["needs_clarification", "clarification_exhausted"].includes(searchIntent?.searchState)
  ) return promptContext;
  const knownCriteria = [
    searchIntent?.requestedTeam,
    searchIntent?.requestedVariant,
    searchIntent?.requestedProductType,
    searchIntent?.requestedAudience,
    searchIntent?.requestedColor,
  ].map((value) => String(value || "").trim()).filter(Boolean);
  const criteriaLine = knownCriteria.length
    ? `The confirmed request criteria are: ${knownCriteria.join(", ")}.`
    : "No specific team or style has been confirmed yet.";
  const correctionLine = searchIntent?.correctionSuggestion?.corrected
    ? `A high-confidence spelling suggestion is pending: ${searchIntent.correctionSuggestion.correctedText}. Ask only whether the user means that phrase; do not search until the user confirms.`
    : "";
  const exhausted = searchIntent?.searchState === "clarification_exhausted";
  const outputToken = exhausted
    ? "[guest_product_clarification_exhausted:TONE]"
    : "[guest_product_clarification:TONE]";
  const policy = [
    "No live product was confirmed by the trusted product source for this request.",
    "Choose the tone that best matches the active character: warm, playful, direct, or encouraging.",
    exhausted
      ? "The request has already used the maximum two clarification attempts. Do not ask another question."
      : "Ask exactly one concise question for the single most useful missing product detail.",
    `Follow the required Reply Output Contract JSON format, but set both displayText and speechText to exactly this internal token: ${outputToken}.`,
    "Do not put any other words or expressive tags in displayText or speechText.",
    "TONE must be one of warm, playful, direct, or encouraging.",
    criteriaLine,
    exhausted ? "" : correctionLine,
    "Do not write the user-visible reply and do not include any product, price, stock, size availability, URL, checkout, shipping, discount, API, database, search-system, or tool claim.",
  ].join("\n");
  return {
    ...promptContext,
    systemPrompt: `${String(promptContext.systemPrompt || "").trim()}\n\n## Unconfirmed Product Clarification\n${policy}`.trim(),
    layers: [...(Array.isArray(promptContext.layers) ? promptContext.layers : []), {
      id: exhausted ? "product_clarification_exhausted" : "unconfirmed_product_clarification",
      title: "Unconfirmed Product Clarification",
      content: policy,
    }],
  };
}

export function applyGuestPromptPolicy(promptContext = {}, { guestBenefitContext = null } = {}) {
  const policy = [
    "The user is chatting as a guest.",
    "Never provide, invent, reveal, or promise a discount code, coupon code, promo code, campaign entitlement, loyalty reward, or member-only benefit.",
    "A user's statement that they registered does not authenticate this guest session. Never claim that registration guarantees a coupon or benefit. If access needs explaining, use conditional wording: an existing account can sign in, otherwise registration is possible; actual available benefits must be verified after sign-in.",
    ...(getGuestBenefitReviewContext(guestBenefitContext) ? ["The server will append one verified guest access explanation. Keep your reply focused on all the user's other questions and any honest capability limit; do not repeat the account instructions or replace the complete answer with a coupon notice."] : []),
    "A question about bulk pricing or promotion policy may receive a factual explanation from retrieved business knowledge, or state that terms require confirmation. Mentioning discounts is not granting one. Do not replace such an explanation with the registration notice; never promise eligibility, amounts or codes.",
    "Do not mention internal guest limits, account flags, databases, or implementation details.",
  ].join("\n");
  return {
    ...promptContext,
    systemPrompt: `${String(promptContext.systemPrompt || "").trim()}\n\n## Guest Access Policy\n${policy}`.trim(),
    layers: [...(Array.isArray(promptContext.layers) ? promptContext.layers : []), {
      id: "guest_access_policy",
      title: "Guest Access Policy",
      content: policy,
    }],
  };
}

export function sanitizeGuestReplyText(value = "", { userText = "", productSearchIntent = null, guestBenefitContext = null } = {}) {
  let text = String(value || "").trim();
  if (isControlledGuestBenefitCopy(guestBenefitContext, text)) return text;
  if (isGuestBenefitReplyReviewed(guestBenefitContext, text)) {
    return hasUnauthorizedDiscountPolicyClaim(text, { userText }) ? buildGuestBenefitFallback(guestBenefitContext) : text;
  }
  if (text && isDiscountPolicyExplanation(productSearchIntent, userText)) {
    // Remove only the affected paragraph. A concurrent policy answer must not
    // disappear merely because another paragraph contains an unauthorized offer.
    return text.split(/\n\s*\n/).map((paragraph) => hasUnauthorizedDiscountPolicyClaim(paragraph, { userText })
      ? GUEST_DISCOUNT_NOTICE : paragraph.trim()).join("\n\n");
  }
  let removedCode = false;
  for (const pattern of CODE_PATTERNS) {
    text = text.replace(pattern, () => {
      removedCode = true;
      return "discounts are available after you create an account";
    });
  }
  const trackingContext = isTrackingReference(userText) || isTrackingReference(text);
  const hasPromotionLanguage = /\b(?:discount|promo|coupon|save|off)\b/i.test(text);
  const codeLikeTokens = text.match(/\b(?=[A-Z0-9_-]{4,}\b)(?=[A-Z0-9_-]*[A-Z])(?=[A-Z0-9_-]*\d)[A-Z0-9_-]+\b/g) || [];
  const hasCouponPresentation = /\b(?:here(?:\s+is)?|code)\s*:\s*[A-Z][A-Z0-9_-]{3,}\b/i.test(text);
  const hasCodeLikeToken = !trackingContext && codeLikeTokens.some((token) => !SIZE_TOKEN_PATTERN.test(token) && (hasPromotionLanguage || /^SAVE/i.test(token) || hasCouponPresentation));
  const hasCodeInstruction = !trackingContext && (/\b(?:use|apply|enter)\s+(?:the\s+)?[A-Z][A-Z0-9_-]{3,}\b/.test(text)
    || /(?:使用|输入|用)\s*[A-Z][A-Z0-9_-]{3,}/.test(text));
  if (hasCodeLikeToken || hasCodeInstruction) {
    text = GUEST_DISCOUNT_NOTICE;
    removedCode = true;
  }
  const isRegistrationNotice = /\bdiscounts?\s+(?:are|become)\s+available\s+(?:only\s+)?after\s+(?:you\s+)?(?:create|register|sign\s+up)/i.test(text);
  const hasPromotionOffer = /\b\d{1,3}\s*%\s*off\b/i.test(text)
    || /\bsave\s+\d{1,3}\s*%/i.test(text)
    || /\b(?:promo|coupon|loyalty reward|member-only benefit)\b/i.test(text)
    || /(?:优惠码|折扣码|兑换码|优惠券|会员专享)/.test(text)
    || (/\bdiscounts?\b/i.test(text) && !isRegistrationNotice);
  if (hasPromotionOffer) {
    text = GUEST_DISCOUNT_NOTICE;
    removedCode = true;
  }
  // Visible content may contain code or intentional line breaks; coupon checks
  // above transform only unauthorized offers, never unrelated formatting.
  text = text.trim();
  if (removedCode) return GUEST_DISCOUNT_NOTICE;
  if (text) return text;
  return removedCode
    ? GUEST_DISCOUNT_NOTICE
    : "I’m here — tell me what’s on your mind.";
}

export function normalizeGuestReplyText({ text = "", product = null, productRequested = false, productSearchIntent = null, productSearchOutcome = "", productSourceErrorCode = "", orderActionCandidate = null, guestBenefitContext = null, chatImageContext = null, productContextSourceRef = "", productCardShown = true, sizingProduct = null, requestedSizes = [], languageCode = "", skipProductClarification = false, imageReason = "", imageTaskCreated = false, imageDeliveryType = "", userText = "", sourceType = "ai", aiTransportFallback = false } = {}) {
  // Preserve the exact audited answer. Re-running caption/no-match transforms
  // after approval could discard concurrent policy questions and audit proof.
  if (isControlledGuestBenefitCopy(guestBenefitContext, text) || isGuestBenefitReplyReviewed(guestBenefitContext, text)) {
    return sanitizeGuestReplyText(text, { userText, productSearchIntent, guestBenefitContext });
  }
  if (!imageTaskCreated && imageReason === "active_generation" && !productSearchIntent?.answerRequired) {
    return toImageStatusReviewContext(chatImageContext)
      ? getChatImageStatusFallbackCopy(chatImageContext, languageCode || "en")
      : "I’m still working on the current image — it’ll appear here when it’s ready.";
  }
  if (!imageTaskCreated && imageReason === "quota_exhausted") {
    return "That guest image has already been used. Create an account to keep making images.";
  }
  if (!imageTaskCreated && imageReason === "disallowed_request") {
    return "I can help with the same character-photo requests available in chat, but I can’t create that image request.";
  }
  if (isTrackingReference(userText) && !hasCheckoutIssue(productSearchIntent || {}) && !resolveOrderActionPromptState(orderActionCandidate)) {
    return buildGuestTrackingUnavailableReply({ languageCode, userText });
  }
  if (hasPendingProductRequest(productSearchIntent)) {
    if (productSearchIntent?.answerRequired === true && String(text || "").trim() && !aiTransportFallback) {
      // Keep parallel answers and whole paragraphs available to the joint review.
      // Guest coupon sanitization still applies before any candidate is accepted.
      return String(text).trim().split(/\n\s*\n/).map((paragraph) => sanitizeGuestReplyText(paragraph, { userText, productSearchIntent, guestBenefitContext })).join("\n\n");
    }
    return buildUnconfirmedProductStateReply({ searchIntent: productSearchIntent, languageCode, userText });
  }
  if (!productSearchIntent?.answerRequired && !isDiscountPolicyExplanation(productSearchIntent, userText) && PROMOTION_REQUEST_PATTERN.test(String(userText || ""))) {
    return GUEST_DISCOUNT_NOTICE;
  }
  if (!productSearchIntent?.answerRequired && productRequested && !product && (!productSearchIntent?.customerServiceKnowledgeRequest || productSearchIntent?.needsLiveProductData) && (productSearchIntent?.searchState === "source_error" || productSearchOutcome === "source_error")) {
    return buildUnconfirmedProductStateReply({ searchIntent: productSearchIntent, searchOutcome: productSearchOutcome,
      sourceErrorCode: productSourceErrorCode, languageCode, userText });
  }
  if (!productSearchIntent?.answerRequired && !product && productSearchIntent?.commerceRoute === "product_question" && productSearchIntent?.needsLiveProductData) {
    return buildUnconfirmedProductStateReply({ searchIntent: productSearchIntent, searchOutcome: productSearchOutcome,
      sourceErrorCode: productSourceErrorCode, languageCode, userText });
  }
  const sizingGuidanceReply = productRequested && !productSearchIntent?.answerRequired ? resolveProductSizingGuidanceReply({
    sourceRef: productContextSourceRef,
    sizingProduct,
    requestedSizes,
  }, { languageCode, userText }) : "";
  if (sizingGuidanceReply) return sizingGuidanceReply;
  if (!aiTransportFallback && !productSearchIntent?.answerRequired && productRequested && !product && productSearchIntent?.replyBoundary?.salesAllowed === false) {
    return buildUnconfirmedProductStateReply({ searchIntent: productSearchIntent, searchOutcome: productSearchOutcome,
      sourceErrorCode: productSourceErrorCode, languageCode, userText });
  }
  if (
    productRequested
    && !productSearchIntent?.answerRequired
    && !product
    && !skipProductClarification
    && !productSearchIntent?.customerServiceKnowledgeRequest
    && productSearchIntent?.searchState === "needs_clarification"
  ) {
    return normalizeGuestProductClarificationReply({
      text,
      searchIntent: productSearchIntent,
      userText,
      languageCode,
    });
  }
  if (
    productRequested
    && !productSearchIntent?.answerRequired
    && !product
    && !skipProductClarification
    && !productSearchIntent?.customerServiceKnowledgeRequest
    && productSearchIntent?.searchState === "clarification_exhausted"
  ) {
    return normalizeGuestProductClarificationExhaustedReply({ text, userText, languageCode });
  }
  if (aiTransportFallback && !imageTaskCreated) return String(text || "").trim();
  if (
    productRequested
    && !productSearchIntent?.answerRequired
    && !product
    && !skipProductClarification
    && !productSearchIntent?.customerServiceKnowledgeRequest
    && (productSearchIntent?.searchState === "ready_to_search"
      || productSearchIntent?.searchState === "ready")
  ) {
    return buildUnconfirmedProductStateReply({ searchIntent: productSearchIntent, searchOutcome: productSearchOutcome,
      sourceErrorCode: productSourceErrorCode, languageCode, userText });
  }
  if (imageTaskCreated && (aiTransportFallback || !String(text || "").trim())) {
    return getChatImageStatusCopy({
      language: resolveGuestProductReplyLanguage(languageCode, userText),
      status: imageDeliveryType === "mascot_library_image" ? "ready" : "queued",
    });
  }
  const sanitizedText = sanitizeGuestReplyText(text, { userText, productSearchIntent, guestBenefitContext });
  if (!product || !productCardShown) return sanitizedText;
  const productFollowup = normalizeProductFollowupReply({
    preserveAnswer: productSearchIntent?.answerRequired === true || product?.matchStatus === "candidate"
      || (productContextSourceRef === "displayed-product-reference" && productSearchIntent?.commerceRoute === "product_search"
        && productSearchIntent?.cardAllowed === true && productSearchIntent?.referencedProductIds?.includes(String(product.productId || product.id || ""))),
    text: sanitizedText,
    speechText: sanitizedText,
    product,
    userText,
    sourceType,
  });
  return sanitizeGuestReplyText(productFollowup.displayText || sanitizedText, { userText, productSearchIntent, guestBenefitContext });
}

function buildGuestTrackingUnavailableReply({ languageCode = "", userText = "" } = {}) {
  switch (resolveGuestProductReplyLanguage(languageCode, userText)) {
    case "zh":
      return "谢谢你提供信息。很抱歉，这里暂时不能实时查询或核验物流单号。请通过承运商的追踪页面查询，或联系店铺客服并提供订单号和收货地址；如果你把物流状态文字发给我，我可以帮你解释。";
    case "es":
      return "Gracias por enviarlo. Por ahora no puedo comprobar el seguimiento en tiempo real ni verificar ese número desde aquí. Puedes consultarlo en la página del transportista o pedir ayuda a la tienda con tu número de pedido y dirección de entrega.";
    case "fr":
      return "Merci pour l’information. Je ne peux pas encore vérifier ce numéro ni suivre le colis en direct depuis ici. Consulte le suivi du transporteur ou contacte la boutique avec ton numéro de commande et ton adresse de livraison.";
    case "hu":
      return "Köszönöm az információt. Sajnos innen még nem tudom élőben ellenőrizni vagy hitelesíteni a fuvarlevélszámot. A fuvarozó nyomkövető oldalán, illetve az üzlet ügyfélszolgálatán kérhetsz pontos státuszt a rendelési számmal és a szállítási címmel.";
    case "tr":
      return "Bilgiyi gönderdiğin için teşekkür ederim. Buradan kargo takibini canlı olarak kontrol edemiyor veya takip numarasını doğrulayamıyorum. Sipariş numaran ve teslimat adresinle taşıyıcının takip sayfasından ya da mağaza desteğinden net durum isteyebilirsin.";
    case "ar":
      return "شكرًا لإرسال التفاصيل. لا أستطيع من هنا التحقق المباشر من رقم التتبع أو حالة الشحنة. يمكنك مراجعة صفحة تتبع شركة الشحن أو التواصل مع المتجر مع رقم الطلب وعنوان التسليم.";
    default:
      return "Thanks for sending it. I’m sorry, but I can’t check live tracking or verify a tracking number in this chat yet. Please use the carrier’s tracking page or contact the store support team with your order number and delivery address. If you share the tracking status text, I can help explain it.";
  }
}

function normalizeGuestProductClarificationReply({ text = "", searchIntent = null, userText = "", languageCode = "" } = {}) {
  const toneMatch = String(text || "").trim().match(/^\[guest_product_clarification:\s*(warm|playful|direct|encouraging)\]$/i);
  return buildControlledGuestProductClarification(searchIntent, {
    tone: toneMatch?.[1]?.toLowerCase() || "direct",
    language: resolveGuestProductReplyLanguage(languageCode, userText),
  });
}

function normalizeGuestProductClarificationExhaustedReply({ text = "", userText = "", languageCode = "" } = {}) {
  const toneMatch = String(text || "").trim().match(/^\[guest_product_clarification_exhausted:\s*(warm|playful|direct|encouraging)\]$/i);
  const language = resolveGuestProductReplyLanguage(languageCode, userText);
  const tone = toneMatch?.[1]?.toLowerCase() || "direct";
  if (language === "zh") {
    const lead = {
      warm: "我还需要更具体的球队、球员或商品信息才能继续确认。",
      playful: "这次线索还不够具体，我先不乱猜啦。",
      direct: "我还需要更具体的球队、球员或商品信息才能确认。",
      encouraging: "再给我更具体的球队、球员或商品信息，我就能继续帮你找。",
    };
    return `${lead[tone] || lead.direct} 你也可以直接打开搜索页浏览。`;
  }
  if (language !== "en") {
    return [buildGuestProductTonePrefix(tone, language), buildGuestProductReplyCopy("exhausted", { languageCode: language })].filter(Boolean).join(" ");
  }
  const lead = {
    warm: "I still need a more specific team, player, or product detail to confirm a match.",
    playful: "I don’t have enough detail to make a reliable pick, so I won’t guess.",
    direct: "I still need a more specific team, player, or product detail to confirm a match.",
    encouraging: "A more specific team, player, or product detail will let me keep searching.",
  };
  return `${lead[tone] || lead.direct} You can also browse the Search page directly.`;
}

function buildControlledGuestProductClarification(searchIntent = {}, {
  tone = "direct",
  language = "en",
} = {}) {
  const phrase = String(searchIntent?.correctionSuggestion?.correctedText || searchIntent?.correctionSuggestion?.corrected || "").trim();
  if (phrase) return buildGuestProductReplyCopy("correction", { languageCode: language, values: { phrase } });
  const team = String(searchIntent?.requestedTeam || "").trim();
  const variant = String(searchIntent?.requestedVariant || "").trim();
  if (language === "zh") {
    const leads = {
      warm: "我暂时还没确认到合适的商品，我们一起再缩小一点范围吧。",
      playful: "这次还没精准命中，再给我一个线索，我继续帮你找。",
      direct: "我暂时没确认到匹配的商品。",
      encouraging: "我暂时还没确认到合适的商品，不过再补一个条件就更容易找到了。",
    };
    const question = team && variant
      ? "你希望优先按尺码还是预算继续找？"
      : team
        ? "你想优先看主场、客场、第三还是复古款？"
        : "你想先看哪个球队或球员的款式？";
    return `${leads[tone] || leads.direct}${question}`;
  }
  if (language !== "en") {
    const lead = buildGuestProductReplyCopy("clarification", { languageCode: language });
    const question = buildGuestProductReplyCopy(team && variant ? "detailQuestion" : team ? "variantQuestion" : "teamQuestion", {
      languageCode: language,
      values: { team, variant },
    });
    return [buildGuestProductTonePrefix(tone, language), lead, question].filter(Boolean).join(" ");
  }
  const leads = {
    warm: "I haven’t confirmed the right match just yet, but we can narrow it down together.",
    playful: "Not quite a clean match this time — give me one more clue and I’ll take another shot.",
    direct: "I couldn’t confirm a reliable match yet.",
    encouraging: "I haven’t got a reliable match yet, but one more detail should get us closer.",
  };
  const question = team && variant
    ? `What size or budget should I use for the ${team} ${variant} search?`
    : team
      ? `Are you after a ${team} home, away, third or retro style?`
      : "Which team or player should I focus on?";
  return `${leads[tone] || leads.direct} ${question}`;
}
