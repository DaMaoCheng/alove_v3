import { registerChatImageInitialReplyForDb } from "./chat-image-failure-reply-job-service.js";
import { resolveFeedbackConversationHistory, attachFeedbackSubmissionContext, applyFeedbackSubmissionPrompt, isSubmittedFeedbackFollowup } from './chat-feedback-submission-service.js';
import { projectChildSizingUpdatePrompt } from './product-sizing-guidance-service.js';
import { buildCommerceClassificationFailureReply } from "./commerce-classification-failure-service.js";
import { finalizeProductCandidateState } from "./product-candidate-state-service.js";
import { getCandidateConfirmationProduct } from './product-candidate-confirmation-service.js';
import { productScopeResultLabel } from "./product-request-scope-copy.js";
import { shouldSkipOrderLookupForCheckout } from "./checkout-support-guidance.js";
import { buildProductSearchIntent, buildRecentProductContext } from "./product-intent-service.js";
import { prepareChatIntentTurn } from "./chat-intent-turn-service.js";
import { applyReplyBoundaryToProductContext, applyReplyBoundaryPromptPolicy, applyCheckoutSupportPromptPolicy, enforceReplyBoundary, hasReplyBoundary } from "./chat-reply-boundary-service.js";
import { getDbPool, withTransaction } from "./db.js";
import {
  attachVoiceAssetToMessage,
  getNextMessageOrder,
  insertMessage,
  listRecentMessagesBeforeOrder,
} from "./chat-message-store.js";
import { buildChatReplyPrompt } from "./chat-prompt-service.js";
import { generateChatReply } from "./ai-reply-service.js";
import { buildImageReplyRecoveryPrompt } from "./chat-image-reply-recovery-service.js";
import { buildReplyPurposeRecoveryPrompt } from "./chat-reply-purpose-service.js";
import { isAiTransportFallback } from "./ai-reply-fallback-service.js";
import { applyCommerceQuestionPromptPolicy, resolveCommerceSearchIntent, resolveCommerceKnowledgeScope } from "./commerce-routing-service.js";
import { recordCommerceDecisionLog } from "./ai-reply-log-service.js";
import { retrieveChatKnowledgeSections } from "./knowledge-retrieval-service.js";
import { resolveChatFactualContext } from "./chat-factual-context-service.js";
import { createPublicError } from "./public-error-utils.js";
import {
  applyGuestProductClarificationPromptPolicy,
  applyGuestPromptPolicy,
  normalizeGuestReplyText,
} from "./guest-chat-output-policy.js";
import { resolveGuestProductRecommendation } from "./guest-chat-product-service.js";
import { resolveGuestCurrentProductImageCardContext } from "./guest-chat-product-service.js";
import { selectProductsForMessage, selectProductsForReply, suppressRepeatedProductCards } from "./chat-product-reply-service.js";
import { maybeCreateGuestChatImagePlaceholder } from "./chat-image-generation-service.js";
import { reserveAiReplyVoiceAssetForDb } from "./chat-voice-asset-service.js";
import { resolveReplySpeechText } from "./chat-reply-speech-service.js";
import { listGuestAttachmentsForRequest } from "./guest-chat-attachment-service.js";
import { collectVisionInputsForAttachments } from "./chat-vision-input-service.js";
import {
  guestSessionForImage,
  guestVoiceMeta,
  loadGuestCharacter,
  requireGuestCharacter,
  requireGuestCharacterForDb,
} from "./guest-session-service.js";
import { resolveGuestTurnStartDisplayOrder, resolveStoredGuestTurnText } from "./guest-turn-service.js";
import { appendFeedbackFollowupCopy, resolveChatFeedbackAction, resolveChatFeedbackActionCandidate } from "./chat-feedback-action-service.js";
import { applySessionLanguagePreference } from "./chat-language-preference-service.js";
import { resolveReviewedReplyVoiceLanguage } from "./chat-language-clarification-policy.js";
import { PRODUCT_CLARIFICATION_SOURCE_MARKER } from "./product-search-decision-service.js";
import { resolveTtmallOrderAction } from "./chat-order-intent-service.js";
import { parseExternalSourceContext } from "./external-source-context-service.js";
import { resolveChatImageStatusContext, refreshChatImageStatusContext, withChatImageReplySnapshot } from "./chat-image-status-context-service.js";
import { buildGuestBenefitContext, appendGuestBenefitGuide, isGuestBenefitReplyReviewed } from "./guest-benefit-guidance-service.js";

export async function prepareStoredGuestReply({
  token,
  messageId,
  expectedSourceRef = "voice-asr",
  characterId = "",
  networkHash = "",
}) {
  const normalizedMessageId = String(messageId || "").trim();
  const normalizedSourceRef = expectedSourceRef === "guest-call" ? "guest-call" : "voice-asr";
  if (!normalizedMessageId) throw createPublicError("Guest message not found.", 404);

  const guest = await requireGuestCharacter(token, characterId);
  const [rows] = await getDbPool().execute(
    `SELECT id, text_content, display_order, content_type, client_message_id, source_ref
     FROM chat_messages
     WHERE id = ? AND session_id = ? AND guest_session_id = ? AND sender_type = 'user'
       AND content_type = 'text' AND source_ref = ? AND client_message_id IS NOT NULL
     LIMIT 1`,
    [normalizedMessageId, guest.chat_session_id, guest.id, normalizedSourceRef]
  );
  const message = rows[0] || null;
  if (!message) throw createPublicError("Guest message not found.", 404);
  const turnAttachments = message.client_message_id
    ? await listGuestAttachmentsForRequest(getDbPool(), {
        guestSessionId: guest.id,
        requestKey: message.client_message_id,
      })
    : [];
  const turnText = await resolveStoredGuestTurnText(getDbPool(), {
    guest,
    requestKey: message.client_message_id,
    primaryMessage: message,
    attachments: turnAttachments,
  });
  const character = await loadGuestCharacter(guest);
  const promptBeforeDisplayOrder = await resolveGuestTurnStartDisplayOrder(getDbPool(), {
    guest,
    requestKey: message.client_message_id,
    primaryMessage: message,
  });
  const currentProductImageContext = await resolveGuestCurrentProductImageCardContext(getDbPool(), {
    guest,
    userText: turnText,
    recentMessages: await listRecentMessagesBeforeOrder(getDbPool(), {
      sessionId: guest.chat_session_id,
      beforeDisplayOrder: promptBeforeDisplayOrder,
    }),
  });
  const intentTurn = await prepareChatIntentTurn(getDbPool(), { session: guestSessionForImage(guest), character, siteId: guest.site_id, siteSlug: guest.site_slug, userText: turnText, userDisplayOrder: Number(message.display_order), logContext: { requestId: message.id }, commerceBeforeDisplayOrder: promptBeforeDisplayOrder, commerceForImageOnly: true });
  const languagePreference = await applySessionLanguagePreference(getDbPool(), { character, session: guestSessionForImage(guest), userText: turnText, jevDecision: intentTurn.decision });
  const imageResult = await maybeCreateGuestChatImagePlaceholder(getDbPool(), {
    guest,
    session: { ...guestSessionForImage(guest), replyLanguageCode: languagePreference.languageCode },
    character: languagePreference.character,
    userText: turnText,
    userMessage: { id: message.id, displayOrder: Number(message.display_order || 0) },
    requestKey: message.client_message_id,
    networkHash,
    skipImageGeneration: Boolean(currentProductImageContext),
    jevDecision: intentTurn.decision,
    conversationContext: intentTurn.conversationContext,
    commerceIntent: intentTurn.commerceSearchIntent,
    commerceSiteId: intentTurn.commerceSite?.id || "",
    imageDecision: intentTurn.imageDecision,
    recentMessages: intentTurn.recentMessages,
  });
  return {
    guest,
    message,
    text: turnText,
    attachments: turnAttachments,
    duplicate: true,
    intentTurn,
    languagePreference,
    imageResult,
    promptBeforeDisplayOrder,
  };
}

// Internal command: callers must hold the guest reply advisory lock across this function.
export async function ensureGuestReply({ token, prepared, voiceModelMode = "" }) {
  const replyRef = `guest-reply:${prepared.message.id}`;
  const clarificationReplyRef = `${replyRef}:${PRODUCT_CLARIFICATION_SOURCE_MARKER}`;
  const [existing] = await getDbPool().execute(
    `SELECT id, voice_asset_id FROM chat_messages
     WHERE session_id = ? AND sender_type = 'character' AND content_type = 'text' AND source_ref IN (?, ?)
     ORDER BY (source_ref = ?) DESC, display_order ASC, id ASC LIMIT 1`,
    [prepared.guest.chat_session_id, replyRef, clarificationReplyRef, replyRef]
  );
  if (existing[0]) return existing[0].voice_asset_id || "";

  const character = await loadGuestCharacter(prepared.guest);
  const [[session]] = await getDbPool().execute(
    "SELECT id, character_id, preferred_language FROM chat_sessions WHERE id = ? AND guest_session_id = ? LIMIT 1",
    [prepared.guest.chat_session_id, prepared.guest.id]
  );
  let languagePreference = prepared.languagePreference || await applySessionLanguagePreference(getDbPool(), {
    character,
    session,
    userText: prepared.text, resolveOnly: true,
  });
  let promptCharacter = languagePreference.character;
  const recentMessages = await listRecentMessagesBeforeOrder(getDbPool(), {
    sessionId: prepared.guest.chat_session_id,
    beforeDisplayOrder: prepared.promptBeforeDisplayOrder,
  });
  const intentTurn = prepared.intentTurn || await prepareChatIntentTurn(getDbPool(), { session: guestSessionForImage(prepared.guest), character: promptCharacter, userText: prepared.text, userDisplayOrder: prepared.message.display_order, logContext: { requestId: prepared.message.id }, siteId: prepared.guest.site_id, siteSlug: prepared.guest.site_slug });
  if (!prepared.languagePreference) languagePreference = await applySessionLanguagePreference(getDbPool(), { character, session, userText: prepared.text, jevDecision: intentTurn.decision });
  promptCharacter = languagePreference.character;
  const feedbackHistory = await resolveFeedbackConversationHistory(getDbPool(), { sessionId: prepared.guest.chat_session_id,
    character: promptCharacter, siteId: prepared.guest.site_id, guestSessionId: prepared.guest.id,
    beforeDisplayOrder: prepared.promptBeforeDisplayOrder || prepared.message.display_order });
  const commerceRecentMessages = feedbackHistory?.entries?.length
    ? [...recentMessages, ...feedbackHistory.entries].sort((a, b) => Number(a.displayOrder || 0) - Number(b.displayOrder || 0)) : recentMessages;
  const precomputedSearchIntent = await (intentTurn.resolveCommerce?.bind(intentTurn) || resolveCommerceSearchIntent)({ userText: prepared.text, recentMessages: commerceRecentMessages,
    searchIntent: buildProductSearchIntent(prepared.text, "", { recentProductContext: buildRecentProductContext(recentMessages) }),
    enrichAllTurns: true, jevDecision: intentTurn.decision, siteId: prepared.guest.site_id, characterId: promptCharacter.id,
    logContext: { requestId: prepared.message.id, sessionId: prepared.guest.chat_session_id, characterId: promptCharacter.id } });
  const productStartedAt = Date.now();
  const productRecommendation = await resolveGuestProductRecommendation(getDbPool(), {
    guest: prepared.guest,
    userText: prepared.text,
    intentTurn,
    precomputedSearchIntent,
    recentMessages,
  });
  const productContext = applyReplyBoundaryToProductContext(suppressRepeatedProductCards(productRecommendation.context, {
    recentMessages,
    userText: prepared.text,
  }), productRecommendation.searchIntent);
  const productMs = Date.now() - productStartedAt;
  const parsedExternalSourceContext = parseExternalSourceContext(prepared.guest.external_source_context_json);
  const externalSourceContext = parsedExternalSourceContext?.mascotCharacterId === prepared.guest.mascot_character_id
    ? parsedExternalSourceContext
    : null;
  const classificationFailureReply = buildCommerceClassificationFailureReply(productRecommendation.searchIntent, { userText: prepared.text, language: languagePreference.languageCode || "en" });
  const knowledgeStartedAt = Date.now();
  let knowledgeContext = await retrieveChatKnowledgeSections({
    query: prepared.text,
    logContext: { requestId: prepared.message.id, sessionId: prepared.guest.chat_session_id, characterId: promptCharacter.id },
    knowledgeQuery: productRecommendation.searchIntent?.knowledgeQuery,
    knowledgeScope: resolveCommerceKnowledgeScope(productRecommendation.searchIntent, { classificationFailed: Boolean(classificationFailureReply) }),
    character: promptCharacter,
    siteId: prepared.guest.site_id,
    topicHint: productRecommendation.searchIntent?.customerServiceKnowledgeRequest ? productRecommendation.searchIntent?.commerceTopic : "",
    limit: 4,
  });
  knowledgeContext = attachFeedbackSubmissionContext(knowledgeContext, feedbackHistory, {
    searchIntent: productRecommendation.searchIntent, userText: prepared.text });
  const knowledgeMs = Date.now() - knowledgeStartedAt;
  const factualContext = await resolveChatFactualContext({
    userText: prepared.text, jevDecision: intentTurn.decision, searchIntent: productRecommendation.searchIntent,
    language: languagePreference.languageCode || promptCharacter?.profile?.language || "en",
    country: promptCharacter?.profile?.countryCode || "US",
    logContext: { requestId: prepared.message.id, sessionId: prepared.guest.chat_session_id, characterId: promptCharacter.id },
  });
  await recordCommerceDecisionLog({
    searchIntent: productRecommendation.searchIntent, knowledgeContext, productContext, factualContext, stageDurations: { productMs, knowledgeMs },
    requestId: prepared.message.id, sessionId: prepared.guest.chat_session_id, characterId: promptCharacter.id,
  });
  const resolvedOrderAction = (shouldSkipOrderLookupForCheckout(productRecommendation.searchIntent) || isSubmittedFeedbackFollowup(knowledgeContext, productRecommendation.searchIntent, prepared.text)) ? null : await resolveTtmallOrderAction({ text: prepared.text, siteSlug: prepared.guest.site_slug, classifyJev: intentTurn.classify,
    conversationContext: intentTurn.conversationContext });
  const orderAction = resolvedOrderAction ? { ...resolvedOrderAction, status: "login_required", label: "Sign in to check order" } : null;
  const feedbackActionCandidate = resolveChatFeedbackActionCandidate({
    character: promptCharacter,
    productContext,
    knowledgeContext,
    orderActionCandidate: orderAction,
    userText: prepared.text,
    searchIntent: productRecommendation.searchIntent,
  });
  const skipProductClarification = Boolean(
    productRecommendation.searchIntent?.customerServiceKnowledgeRequest
    || productRecommendation.searchIntent?.customizationRequest
    || knowledgeContext?.customerServiceIntent
  );
  const visionInputs = prepared.attachments?.length
    ? await collectVisionInputsForAttachments(prepared.attachments)
    : [];
  const voiceLogContext = guestVoiceLogContext(promptCharacter, voiceModelMode, languagePreference);
  const guestBenefitContext = buildGuestBenefitContext({ searchIntent: productRecommendation.searchIntent,
    userText: prepared.text, languageCode: languagePreference.languageCode || "en", isGuest: true });
  let chatImageContext = await resolveChatImageStatusContext(getDbPool(), {
    session: guestSessionForImage(prepared.guest), character: promptCharacter,
    userDisplayOrder: Number(prepared.message.display_order || prepared.message.displayOrder || 0),
    directive: prepared.imageResult?.directive || null, currentImageMessageId: prepared.imageResult?.message?.id || "",
  });
  const sizeUpdatePrompt = projectChildSizingUpdatePrompt({ searchIntent: productRecommendation.searchIntent, productContext, recentMessages });
  let promptContext = applyCheckoutSupportPromptPolicy(applyReplyBoundaryPromptPolicy(applyCommerceQuestionPromptPolicy(buildChatReplyPrompt({
      character: promptCharacter, trustedSite: { id: prepared.guest.site_id, slug: prepared.guest.site_slug, name: prepared.guest.site_name, identity_mascot_character_id: prepared.guest.site_mascot_character_id },
      recentMessages: sizeUpdatePrompt.recentMessages,
      userText: prepared.text,
      userContext: null,
      externalSourceContext,
      productContext: sizeUpdatePrompt.productContext,
      knowledgeContext,
      factualContext,
      feedbackActionCandidate,
      orderActionCandidate: orderAction,
      chatImageContext,
      visionInputs,
    }), productRecommendation.searchIntent, { userText: prepared.text, recentMessages }), productRecommendation.searchIntent), productRecommendation.searchIntent, promptCharacter);
  promptContext = applyFeedbackSubmissionPrompt(promptContext, knowledgeContext);
  const guestPromptContext = applyGuestPromptPolicy(applyGuestProductClarificationPromptPolicy(promptContext, {
    productRequested: productRecommendation.requested,
    product: productContext?.products?.[0] || null,
    searchIntent: productRecommendation.searchIntent,
    skipProductClarification,
  }), { guestBenefitContext });
  const generationLogContext = {
    guestSessionId: prepared.guest.id,
    sessionId: prepared.guest.chat_session_id,
    characterId: promptCharacter.id,
    ...voiceLogContext,
  };
  let reply = classificationFailureReply || await generateChatReply({
    deferIdentityToBoundaryReview: true,
    promptContext: guestPromptContext,
    userText: prepared.text,
    logContext: generationLogContext,
  });

  chatImageContext = await refreshChatImageStatusContext(getDbPool(), chatImageContext);
  const replyNormalizationContext = (reply) => {
    const previewProducts = isAiTransportFallback(reply) || productRecommendation.searchIntent?.replyBoundary?.salesAllowed === false ? [] : selectProductsForMessage(productContext);
    const normalizationOptions = {
        guestBenefitContext, chatImageContext,
        product: previewProducts[0] || (!isAiTransportFallback(reply) ? selectProductsForMessage({ ...productContext, cardAllowed: true, suppressedProductKeys: [] })[0] : null),
        productCardShown: previewProducts.length > 0,
        productRequested: productRecommendation.requested,
        productSearchIntent: productRecommendation.searchIntent,
        orderActionCandidate: orderAction,
        productContextSourceRef: productContext?.sourceRef || "",
        productSearchOutcome: productContext?.searchOutcome || "",
        productSourceErrorCode: productContext?.sourceErrorCode || "",
        sizingProduct: productContext?.sizingProduct || null,
        requestedSizes: productContext?.requestedSizes || productContext?.searchIntent?.requestedSizes || [],
        languageCode: languagePreference.languageCode || "",
        skipProductClarification,
        imageReason: prepared.imageResult?.reason || "",
        imageTaskCreated: prepared.imageResult?.taskCreated === true,
        imageDeliveryType: prepared.imageResult?.message?.contentType || "",
        userText: prepared.text,
        sourceType: reply.sourceType || "ai",
        aiTransportFallback: isAiTransportFallback(reply),
      };
    return { previewProducts, normalizationOptions };
  };
  const prepareGeneratedReply = (reply) => {
    const { normalizationOptions } = replyNormalizationContext(reply);
    // A validated guest request must be assessed before any broad coupon cleanup.
    // The review alone can grant permission to preserve its exact safe answer.
    const normalizedReplyText = guestBenefitContext || chatImageContext?.imageStatus || hasReplyBoundary(productRecommendation.searchIntent)
      ? reply.text : normalizeGuestReplyText({ ...normalizationOptions, text: reply.text });
    // A policy transform must not leave the previous offer in the speech channel.
    // Preserve expressive speech when its visible content already matches.
    const normalizedSpeechText = normalizedReplyText === reply.text
      ? reply.speechText || normalizedReplyText
      : resolveReplySpeechText({ ...reply, speechText: normalizedReplyText }, normalizedReplyText, prepared.text, reply.sourceType || "ai");
    const scopeLabel = productScopeResultLabel(productRecommendation.searchIntent, { languageCode: languagePreference.languageCode || "en" });
    const scopedText = scopeLabel && !String(normalizedReplyText).startsWith(scopeLabel) && !isAiTransportFallback(reply)
      ? `${scopeLabel}\n\n${normalizedReplyText}` : normalizedReplyText;
    const scopedReply = { ...reply, text: scopedText, displayText: scopedText,
      speechText: scopedText !== normalizedReplyText ? `${scopeLabel}\n\n${normalizedSpeechText}` : normalizedSpeechText };
    return scopedReply;
  };
  const scopedReply = prepareGeneratedReply(reply);
  reply = classificationFailureReply || await enforceReplyBoundary({ requireIdentityReview: true, independentLanguageQualityRequired: true, languageQualityRequired: true, factualContext, guestBenefitContext, chatImageContext, replyResult: scopedReply, searchIntent: productRecommendation.searchIntent, productContext, knowledgeContext, character: promptCharacter, trustedSite: { id: prepared.guest.site_id, slug: prepared.guest.site_slug, name: prepared.guest.site_name, identity_mascot_character_id: prepared.guest.site_mascot_character_id }, feedbackActionCandidate, orderActionCandidate: orderAction, userText: prepared.text, recentMessages, language: languagePreference.languageCode || "en",
    logContext: { requestId: prepared.message.id, sessionId: prepared.guest.chat_session_id, characterId: promptCharacter.id },
    refreshImageStatus: context => refreshChatImageStatusContext(getDbPool(), context),
    regenerateReply: async (previousReply, recovery = null) => {
      const recoveryPrompt = recovery?.kind === "image" ? buildImageReplyRecoveryPrompt(guestPromptContext, recovery)
        : recovery?.kind === "purpose" ? buildReplyPurposeRecoveryPrompt(guestPromptContext, recovery) : guestPromptContext;
      if (!recoveryPrompt) return null;
      return prepareGeneratedReply(await generateChatReply({
        deferIdentityToBoundaryReview: true,
        promptContext: recoveryPrompt, userText: prepared.text, logContext: generationLogContext, regeneration: true, regenerationProvider: previousReply, regenerationUseAlternateProvider: recovery?.kind === "purpose",
      }));
    } });
  if (classificationFailureReply) reply = withChatImageReplySnapshot(reply, chatImageContext);
  const { normalizationOptions } = replyNormalizationContext(reply);

  if (guestBenefitContext && isGuestBenefitReplyReviewed(guestBenefitContext, reply.text)) {
    const normalizedBenefitBody = normalizeGuestReplyText({ ...normalizationOptions, text: reply.text });
    const text = appendGuestBenefitGuide(normalizedBenefitBody, guestBenefitContext);
    reply = { ...reply, text, displayText: text, speechText: text };
  }

  return withTransaction(async (db) => {
    const guest = await requireGuestCharacterForDb(db, token, {
      characterId: prepared.guest.mascot_character_id,
      lock: true,
    });
    const [already] = await db.execute(
      `SELECT id, voice_asset_id FROM chat_messages
       WHERE session_id = ? AND sender_type = 'character' AND content_type = 'text' AND source_ref IN (?, ?)
       ORDER BY (source_ref = ?) DESC, display_order ASC, id ASC LIMIT 1`,
      [guest.chat_session_id, replyRef, clarificationReplyRef, replyRef]
    );
    if (already[0]) return already[0].voice_asset_id || "";
    const selectedProducts = selectProductsForReply(productContext, reply);
    const nextOrder = await getNextMessageOrder(db, guest.chat_session_id);
    for (const [index, product] of selectedProducts.entries()) {
      await insertMessage(db, {
        sessionId: guest.chat_session_id,
        guestSessionId: guest.id,
        characterId: character.id,
        senderType: "character",
        senderLabel: character.name,
        contentType: "product",
        text: product.name,
        product,
        displayOrder: nextOrder + index * 5,
        sourceType: "guest",
        sourceRef: `guest-product:${prepared.message.id}`,
      });
    }
    const feedbackAction = resolveChatFeedbackAction({
      character: promptCharacter,
      productContext,
      knowledgeContext,
      orderActionCandidate: orderAction,
      replyResult: reply,
      userText: prepared.text,
      feedbackActionCandidate,
      searchIntent: productRecommendation.searchIntent,
    });
    const replyText = appendFeedbackFollowupCopy(reply.text, { character: promptCharacter, languageCode: resolveReviewedReplyVoiceLanguage(reply, languagePreference).languageCode, feedbackAction, searchIntent: productRecommendation.searchIntent });
    const replyMessage = await insertMessage(db, {
      sessionId: guest.chat_session_id,
      guestSessionId: guest.id,
      characterId: promptCharacter.id,
      senderType: "character",
      senderLabel: promptCharacter.name,
      contentType: "text",
      text: replyText,
      productRequestState: productRecommendation.searchIntent?.productRequestState,
      productCandidateState: finalizeProductCandidateState(productRecommendation.searchIntent?.productCandidateState,
        selectedProducts[0] || (reply.candidateEvidenceVerified === true ? getCandidateConfirmationProduct(productContext) : null), {
        approvedReply: replyText, confirmationRequested: reply.candidateConfirmationVerified === true, evidenceVerified: reply.candidateEvidenceVerified === true }),
      replyRecoveryState: reply.replyRecoveryState,
      displayOrder: selectedProducts.length ? nextOrder + selectedProducts.length * 5 : nextOrder,
      sourceType: reply.sourceType || "ai",
      sourceRef: productContext?.searchOutcome === "needs_clarification"
        ? `${replyRef}:${PRODUCT_CLARIFICATION_SOURCE_MARKER}`
        : replyRef,
    });
    const feedbackActionSourceRef = `guest-feedback-follow-up-action:${prepared.message.id}`;
    const [existingFeedbackAction] = feedbackAction ? await db.execute(
      "SELECT id FROM chat_messages WHERE session_id = ? AND source_ref = ? LIMIT 1",
      [guest.chat_session_id, feedbackActionSourceRef]
    ) : [[]];
    if (feedbackAction && !existingFeedbackAction[0]) {
      await insertMessage(db, {
        sessionId: guest.chat_session_id,
        guestSessionId: guest.id,
        characterId: character.id,
        senderType: "character",
        senderLabel: character.name,
        contentType: "feedback_action",
        text: "",
        product: feedbackAction,
        displayOrder: replyMessage.displayOrder + 5,
        sourceType: "system",
        sourceRef: feedbackActionSourceRef,
      });
    }
    const orderActionSourceRef = `guest-order-action:${prepared.message.id}`;
    const [existingOrderAction] = orderAction ? await db.execute(
      "SELECT id FROM chat_messages WHERE session_id = ? AND source_ref = ? LIMIT 1",
      [guest.chat_session_id, orderActionSourceRef]
    ) : [[]];
    if (orderAction && !existingOrderAction[0]) {
      await insertMessage(db, {
        sessionId: guest.chat_session_id,
        guestSessionId: guest.id,
        characterId: character.id,
        senderType: "character",
        senderLabel: character.name,
        contentType: "order_action",
        text: "Please sign in and bind your account to check an order.",
        product: orderAction,
        displayOrder: replyMessage.displayOrder + 10,
        sourceType: "system",
        sourceRef: orderActionSourceRef,
      });
    }
    const replyVoice = await reserveAiReplyVoiceAssetForDb(db, {
      messageId: replyMessage.id,
      characterId: promptCharacter.id,
      speechText: resolveReplySpeechText({ speechText: replyText }, replyText, prepared.text, reply.sourceType || "ai"),
      voiceMeta: guestVoiceMeta(promptCharacter, voiceModelMode, {
        ...(reply.voiceMeta || {}),
        ...resolveReviewedReplyVoiceLanguage(reply, languagePreference),
      }),
      deterministic: true,
    });
    await attachVoiceAssetToMessage(db, {
      messageId: replyMessage.id,
      voiceAssetId: replyVoice.id,
    });
    await db.execute(
      "UPDATE chat_sessions SET last_message_at = NOW(3), updated_at = NOW(3) WHERE id = ?",
      [guest.chat_session_id]
    );
    await registerChatImageInitialReplyForDb(db, { snapshot: reply._imageDeliveryReply, replyMessage, triggerMessageId: prepared.message.id });
    return replyVoice.id;
  });
}

function guestVoiceLogContext(character = {}, voiceModelMode = "", languagePreference = {}) {
  const meta = guestVoiceMeta(character, voiceModelMode, {
    languageCode: languagePreference.languageCode,
    languageLabel: languagePreference.languageLabel,
  });
  return {
    languageCode: meta.languageCode,
    languageLabel: meta.languageLabel,
    voiceProvider: meta.provider,
    voiceModel: meta.model,
    voiceId: meta.voiceId,
  };
}
