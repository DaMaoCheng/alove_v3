import { buildCommerceClassificationFailureReply } from "./commerce-classification-failure-service.js";
import { finalizeProductCandidateState } from "./product-candidate-state-service.js";
import { getCandidateConfirmationProduct } from './product-candidate-confirmation-service.js';
import { hasPendingProductRequest } from "./product-request-scope-service.js";
import { productScopeResultLabel } from "./product-request-scope-copy.js";
import { getDbPool } from "./db-core.js";
import { resolveChatImageStatusContext, refreshChatImageStatusContext } from "./chat-image-status-context-service.js";
import { buildImageReplyRecoveryPrompt } from "./chat-image-reply-recovery-service.js";
import { buildReplyPurposeRecoveryPrompt } from "./chat-reply-purpose-service.js";
import { prepareChatIntentTurn } from "./chat-intent-turn-service.js";
import { shouldSkipOrderLookupForCheckout } from "./checkout-support-guidance.js";
import { isStorefrontGuidanceCharacter } from "./chat-global-reply-policy.js";
import { resolveTtmallOrderAction } from "./chat-order-intent-service.js";
import { mergeReplyCommerceContext, applyReplyBoundaryToProductContext, applyReplyBoundaryPromptPolicy, applyCheckoutSupportPromptPolicy, enforceReplyBoundary, hasReplyBoundary } from "./chat-reply-boundary-service.js";
import { generateChatReply } from "./ai-reply-service.js";
import { isAiTransportFallback } from "./ai-reply-fallback-service.js";
import { buildChatReplyPrompt } from "./chat-prompt-service.js";
import { indexChatMessage } from "./chat-memory-service.js";
import { buildChatProductRecommendationContext } from "./chat-product-recommendation-service.js";
import { resolveProductRecommendationSite } from "./product-recommendation-site-service.js";
import { applyCommerceQuestionPromptPolicy, resolveCommerceSearchIntent } from "./commerce-routing-service.js";
import { recordCommerceDecisionLog } from "./ai-reply-log-service.js";
import { retrieveChatKnowledgeSections } from "./knowledge-retrieval-service.js";
import { resolveChatFactualContext } from "./chat-factual-context-service.js";
import { normalizeProductFollowupReply } from "./product-followup-sanitizer.js";
import { resolveProductSizingGuidanceReply } from "./product-sizing-guidance-service.js";
import { insertProductReplyMessage, selectProductsForReply, suppressRepeatedProductCards } from "./chat-product-reply-service.js";
import { createAiReplyVoiceAssetForDb } from "./chat-voice-asset-service.js";
import { resolveReplySpeechText } from "./chat-reply-speech-service.js";
import { resolveReplyVoiceMetaModel } from "./chat-reply-voice-service.js";
import { resolveCharacterDiscountOffers } from "./discount-code-eligibility-service.js";
import { enforceDiscountOfferReplyPolicy } from "./chat-discount-offer-output-policy.js";
import { buildProductCorrectionClarificationReply, buildProductSearchIntent, buildRecentProductContext } from "./product-intent-service.js";
import { PRODUCT_CLARIFICATION_SOURCE_MARKER } from "./product-search-decision-service.js";
import { appendFeedbackFollowupCopy, resolveChatFeedbackAction, resolveChatFeedbackActionCandidate } from "./chat-feedback-action-service.js";
import {
  attachVoiceAssetToMessage,
  buildUserPromptContext,
  enqueueSummaryRefreshJobs,
  getNextMessageOrder,
  insertMessage,
  mapSessionRow,
} from "./chat-service-shared.js";

export async function buildCharacterReplyGenerationForDb(db, {
  promptCharacter,
  session,
  userId,
  characterId,
  userText,
  recentMessages,
  productTrigger = "",
  productContextOverride = null,
  chatImageContext = null,
  userDisplayOrder = 0,
  visionInputs = [],
  logContext = {},
  voiceMetaFallback = null,
  intentTurn = null,
  orderLookupSiteSlug = "",
}) {
  intentTurn ||= await prepareChatIntentTurn(db, { session, character: promptCharacter, userText, userId });
  const userContext = await buildUserPromptContext(db, {
    userId,
    characterId,
    sessionId: session.id,
    queryText: userText,
    recentMessages,
  });
  const commerceSite = await resolveProductRecommendationSite(db, { character: promptCharacter, userId });
  let commerceSearchIntent = await (intentTurn.resolveCommerce?.bind(intentTurn) || resolveCommerceSearchIntent)({ userText, recentMessages,
    searchIntent: buildProductSearchIntent(userText, productTrigger, { recentProductContext: buildRecentProductContext(recentMessages) }),
    enrichAllTurns: true, explicitTrigger: Boolean(productTrigger), jevDecision: intentTurn.decision, siteId: commerceSite?.id || "", siteSlug: commerceSite?.slug || "", characterId: characterId || promptCharacter.id });
  let productContext = suppressRepeatedProductCards((!hasPendingProductRequest(commerceSearchIntent) && !commerceSearchIntent.productRequestState && productContextOverride) || await buildChatProductRecommendationContext(db, {
    character: promptCharacter,
    userId,
    sessionId: session.id,
    userText,
    productTrigger,
    intentTurn,
    precomputedSearchIntent: commerceSearchIntent,
    recentMessages,
    onCommerceDecision: (intent) => { commerceSearchIntent = intent; },
  }), { recentMessages, userText });
  productContext = mergeReplyCommerceContext(productContext, commerceSearchIntent);
  productContext = applyReplyBoundaryToProductContext(productContext, commerceSearchIntent);
  if (productContext) productContext.userText = userText;
  const classificationFailureReply = buildCommerceClassificationFailureReply(commerceSearchIntent, { userText, language: logContext.languageCode || promptCharacter?.profile?.language || "en" });
  let knowledgeContext = await retrieveChatKnowledgeSections({
    db,
    query: userText,
    knowledgeQuery: commerceSearchIntent.knowledgeQuery,
    knowledgeScope: classificationFailureReply ? "none" : commerceSearchIntent.commerceRoute === "product_search" && !commerceSearchIntent.answerRequired ? "none" : commerceSearchIntent.knowledgeScope,
    siteId: commerceSite?.id || "",
    character: promptCharacter,
    userId,
    topicHint: commerceSearchIntent.customerServiceKnowledgeRequest ? commerceSearchIntent.commerceTopic : "",
    limit: 4,
  });
  const factualContext = await resolveChatFactualContext({
    userText, jevDecision: intentTurn.decision, searchIntent: commerceSearchIntent,
    language: logContext.languageCode || promptCharacter?.profile?.language || "en",
    country: promptCharacter?.profile?.countryCode || "US",
    logContext: { requestId: logContext.requestId, sessionId: session.id, characterId, userId },
  });
  await recordCommerceDecisionLog({ searchIntent: productContext?.searchIntent || commerceSearchIntent, knowledgeContext, productContext, factualContext,
    requestId: logContext.requestId, sessionId: session.id, characterId, userId });
  // Only callers that persist an order action supply this site. Voice currently does not.
  const orderAction = !orderLookupSiteSlug || (isStorefrontGuidanceCharacter(promptCharacter) && shouldSkipOrderLookupForCheckout(commerceSearchIntent))
    ? null : await resolveTtmallOrderAction({ text: userText, siteSlug: orderLookupSiteSlug, classifyJev: intentTurn.classify,
      conversationContext: intentTurn.conversationContext });
  const feedbackActionCandidate = resolveChatFeedbackActionCandidate({
    character: promptCharacter,
    productContext,
    knowledgeContext,
    orderActionCandidate: orderAction,
    userText,
    searchIntent: commerceSearchIntent,
  });
  let discountOffersContext = null;
  try {
    discountOffersContext = commerceSearchIntent.replyBoundary?.salesAllowed === false || productContext?.candidateContext ? { offers: [] } : await resolveCharacterDiscountOffers(db, {
      userId,
      characterId,
      limit: 5,
    });
  } catch (error) {
    // Discount availability must fail closed without blocking an otherwise valid chat reply.
    discountOffersContext = { offers: [] };
    if (error?.statusCode && error.statusCode >= 500) console.warn("discount offer context unavailable", error.code || error.message);
  }
  chatImageContext = await resolveChatImageStatusContext(getDbPool(), { session, character: promptCharacter, userDisplayOrder, directive: chatImageContext });
  const promptContext = applyCheckoutSupportPromptPolicy(applyReplyBoundaryPromptPolicy(applyCommerceQuestionPromptPolicy(buildChatReplyPrompt({
    character: promptCharacter, trustedSite: commerceSite,
    recentMessages,
    userText,
    userContext,
    productContext,
    discountOffersContext,
    knowledgeContext,
    factualContext,
    feedbackActionCandidate,
    orderActionCandidate: orderAction,
    chatImageContext,
    visionInputs,
  }), commerceSearchIntent), commerceSearchIntent), commerceSearchIntent, promptCharacter);
  const generatedReplyResult = classificationFailureReply || await generateChatReply({
    deferIdentityToBoundaryReview: true,
    promptContext,
    userText,
    feedbackActionCandidate,
    logContext,
  });
  const prepareGeneratedReply = (generatedReplyResult) => {
    let replyResult = commerceSearchIntent.replyBoundary?.salesAllowed === false || productContext?.candidateContext ? generatedReplyResult : enforceDiscountOfferReplyPolicy({
      replyResult: generatedReplyResult,
      offers: discountOffersContext?.offers || [],
      userText,
      language: promptCharacter?.profile?.language || promptCharacter?.profile_json?.language || "",
      recentMessages,
      allowDiscountMention: Boolean(productContext?.products?.length),
      searchIntent: commerceSearchIntent,
    });
    const sizingGuidanceReply = resolveProductSizingGuidanceReply(productContext, {
      languageCode: logContext?.languageCode || promptCharacter?.profile?.language || promptCharacter?.profile_json?.language || "",
      userText,
    });
    if (sizingGuidanceReply && !hasReplyBoundary(commerceSearchIntent) && !commerceSearchIntent.answerRequired) {
      replyResult = {
        ...replyResult,
        text: sizingGuidanceReply,
        speechText: sizingGuidanceReply,
      };
    }
    const correctionReply = buildProductCorrectionClarificationReply(productContext?.searchIntent, {
      language: String(logContext?.languageCode || promptCharacter?.profile?.language || promptCharacter?.profile_json?.language || "en").trim().toLowerCase().split("-")[0],
    });
    if (correctionReply && !productContext?.products?.length && !hasReplyBoundary(commerceSearchIntent) && !commerceSearchIntent.answerRequired) {
      replyResult = {
        ...replyResult,
        text: correctionReply,
        speechText: correctionReply,
      };
    }
    const scopeLabel = productScopeResultLabel(commerceSearchIntent, {
      languageCode: logContext?.languageCode || promptCharacter?.profile?.language || "en",
    });
    if (scopeLabel && !String(replyResult.text || "").startsWith(scopeLabel) && !isAiTransportFallback(replyResult)) {
      replyResult = { ...replyResult, text: `${scopeLabel}\n\n${replyResult.text || ""}`,
        speechText: `${scopeLabel}\n\n${replyResult.speechText || replyResult.text || ""}` };
    }
    return replyResult;
  };
  let replyResult = prepareGeneratedReply(generatedReplyResult);
  // Read through the pool: the reply transaction may still hold an older RR snapshot.
  chatImageContext = await refreshChatImageStatusContext(getDbPool(), chatImageContext);
  replyResult = classificationFailureReply || await enforceReplyBoundary({ requireIdentityReview: true, independentLanguageQualityRequired: true, languageQualityRequired: true, factualContext, chatImageContext, replyResult, searchIntent: commerceSearchIntent, productContext, knowledgeContext, character: promptCharacter, trustedSite: commerceSite, feedbackActionCandidate, orderActionCandidate: orderAction, userText, recentMessages,
    language: logContext?.languageCode || promptCharacter?.profile?.language || "en",
    logContext: { requestId: logContext.requestId, sessionId: session.id, characterId, userId },
    refreshImageStatus: context => refreshChatImageStatusContext(getDbPool(), context),
    regenerateReply: async (previousReply, recovery = null) => {
      const recoveryPrompt = recovery?.kind === "image" ? buildImageReplyRecoveryPrompt(promptContext, recovery)
        : recovery?.kind === "purpose" ? buildReplyPurposeRecoveryPrompt(promptContext, recovery) : promptContext;
      if (!recoveryPrompt) return null;
      return prepareGeneratedReply(await generateChatReply({
        deferIdentityToBoundaryReview: true,
        promptContext: recoveryPrompt, userText, feedbackActionCandidate, logContext, regeneration: true, regenerationProvider: previousReply, regenerationUseAlternateProvider: recovery?.kind === "purpose",
      }));
    } });
  replyResult = { ...replyResult, answerRequired: replyResult.answerRequired === true || commerceSearchIntent.answerRequired === true || hasReplyBoundary(commerceSearchIntent), replyBoundary: commerceSearchIntent.replyBoundary, productRequestState: commerceSearchIntent.productRequestState, productCandidateState: commerceSearchIntent.productCandidateState };
  if (voiceMetaFallback) {
    replyResult.voiceMeta = resolveReplyVoiceMetaModel(replyResult.voiceMeta, voiceMetaFallback);
  }
  const feedbackAction = resolveChatFeedbackAction({
    character: promptCharacter,
    productContext,
    knowledgeContext,
    replyResult,
    orderActionCandidate: orderAction,
    userText,
    feedbackActionCandidate,
    searchIntent: commerceSearchIntent,
  });
  return {
    commerceSearchIntent,
    orderAction,
    userContext,
    productContext,
    knowledgeContext,
    promptContext,
    replyResult,
    feedbackAction,
  };
}

export async function persistCharacterReplyForDb(db, {
  character,
  session,
  userId,
  characterId,
  userText,
  productContext,
  replyResult,
  feedbackAction = null,
  replyTriggerMessageId = "",
  replyVoicePayloadBuilder,
}) {
  const nextOrder = await getNextMessageOrder(db, session.id);
  const selectedProducts = selectProductsForReply(productContext, replyResult);
  const selectedProduct = selectedProducts[0] || null;
  const productFollowup = selectedProduct && !isAiTransportFallback(replyResult) ? normalizeProductFollowupReply({
    preserveAnswer: productContext?.searchOutcome === "alternative" || Boolean(productContext?.candidateContext) || replyResult.answerRequired === true || productContext?.searchIntent?.answerRequired === true
      || (productContext?.sourceRef === "displayed-product-reference" && productContext.snapshotOnly === true),
    text: replyResult.text,
    speechText: replyResult.speechText,
    product: selectedProduct,
    userText,
    sourceType: replyResult.sourceType,
    protectedLiterals: replyResult.discountOfferReply === true
      ? (replyResult.verifiedDiscountOffers || []).flatMap((offer) => [offer.code, offer.offerDescription])
      : [],
  }) : null;
  if (replyResult.replyBoundary?.contactAllowed === false) feedbackAction = null;
  const replyText = appendFeedbackFollowupCopy(productFollowup?.displayText || replyResult.text, { character, feedbackAction, searchIntent: replyResult });
  const speechText = hasReplyBoundary(replyResult) || feedbackAction
    ? resolveReplySpeechText({ ...replyResult, speechText: replyText }, replyText, userText, replyResult.sourceType)
    : productFollowup?.speechText || resolveReplySpeechText(replyResult, replyText, userText, replyResult.sourceType);
  const productMessages = [];
  for (const [index, product] of selectedProducts.entries()) {
    const productMessage = await insertProductReplyMessage(db, {
      session,
      character,
      userId,
      characterId,
      product,
      displayOrder: nextOrder + index * 5,
    });
    if (productMessage) productMessages.push(productMessage);
  }
  const replyMessage = await insertMessage(db, {
    sessionId: session.id,
    characterId,
    senderType: "character",
    senderLabel: character.name,
    contentType: "text",
    text: replyText,
    productRequestState: replyResult.productRequestState,
    productCandidateState: finalizeProductCandidateState(productContext?.searchIntent?.productCandidateState || replyResult.productCandidateState,
      selectedProduct || (replyResult.candidateEvidenceVerified === true ? getCandidateConfirmationProduct(productContext) : null), {
      approvedReply: replyText, confirmationRequested: replyResult.candidateConfirmationVerified === true, evidenceVerified: replyResult.candidateEvidenceVerified === true }),
    replyRecoveryState: replyResult.replyRecoveryState,
    displayOrder: selectedProducts.length ? nextOrder + selectedProducts.length * 5 : nextOrder,
    sourceType: replyResult.sourceType,
    sourceRef: productContext?.searchOutcome === "needs_clarification"
      ? `${String(replyResult.sourceRef || "ai")}:${PRODUCT_CLARIFICATION_SOURCE_MARKER}`
      : replyResult.sourceRef,
  });
  const replyVoice = await createAiReplyVoiceAssetForDb(db, {
    messageId: replyMessage.id,
    characterId,
    userId,
    speechText,
    voiceMeta: replyResult.voiceMeta,
  });
  await attachVoiceAssetToMessage(db, {
    messageId: replyMessage.id,
    voiceAssetId: replyVoice.id,
  });
  replyMessage.voice = replyVoicePayloadBuilder(replyVoice);
  const feedbackActionSourceRef = `feedback-follow-up-action:${String(replyTriggerMessageId || "turn")}`;
  const feedbackActionMessage = feedbackAction && await canInsertFeedbackAction(db, {
    sessionId: session.id,
    sourceRef: feedbackActionSourceRef,
  }) ? await insertMessage(db, {
      sessionId: session.id,
      characterId,
      senderType: "character",
      senderLabel: character.name,
      contentType: "feedback_action",
      text: "",
      product: feedbackAction,
      displayOrder: replyMessage.displayOrder + 5,
      sourceType: "system",
      sourceRef: feedbackActionSourceRef,
    }) : null;

  await indexChatMessage(db, {
    message: replyMessage,
    session,
    userId,
    characterId,
  });
  await enqueueSummaryRefreshJobs(db, {
    userId,
    characterId,
    sessionId: session.id,
  });
  await db.execute(
    "UPDATE chat_sessions SET last_message_at = NOW(3), updated_at = NOW(3) WHERE id = ?",
    [session.id]
  );

  return {
    ok: true,
    session: mapSessionRow({
      ...session,
      last_message_at: new Date(),
    }),
    items: [...productMessages, replyMessage, feedbackActionMessage].filter(Boolean),
  };
}

async function canInsertFeedbackAction(db, { sessionId, sourceRef }) {
  const [rows] = await db.execute(
    `SELECT id
     FROM chat_messages
     WHERE session_id = ? AND source_ref = ?
     LIMIT 1`,
    [sessionId, sourceRef]
  );
  return !rows[0];
}
