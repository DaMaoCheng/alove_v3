import { resolveCommerceSearchIntent } from "./commerce-routing-service.js";
import { buildProductSearchIntent, buildRecentProductContext } from "./product-intent-service.js";
import { listRecentMessagesBeforeOrder } from "./chat-message-store.js";
import { resolveProductRecommendationSite } from "./product-recommendation-site-service.js";
import { normalizeConversationContext } from "./jev-intent-service.js";
import { resolvePrimaryChatIntent } from "./resolve-primary-chat-intent-service.js";
import { buildChatProductRoutingContext } from "./chat-product-routing-context-service.js";
import { analyzeChatImageTrigger, isMockChatImageRequest } from "./chat-image-trigger-service.js";
import { classifyChatImageIntent, isProductCapableCharacter } from "./chat-image-intent-classifier-service.js";
import { resolveRecentImageConversationContext } from "./chat-image-conversation-context-service.js";
import { buildUnansweredUserQuestionContext } from "./chat-reply-recovery-state.js";

// Request-local reuse only. Different legacy inputs intentionally remain different
// requests: changing a capability or image context can change Jev's decision.
export function createChatIntentTurn({ classify = resolvePrimaryChatIntent, logContext = {} } = {}) {
  const requests = new Map();
  const references = new Map();
  let commerceRequest = null;
  let nextReference = 0;
  const referenceId = (value) => {
    if (!value) return "default";
    if (!references.has(value)) references.set(value, ++nextReference);
    return references.get(value);
  };
  return {
    decision: null,
    conversationContext: null,
    commerceSearchIntent: null,
    async resolveCommerce(options = {}) {
      commerceRequest ||= resolveCommerceSearchIntent({ ...options, logContext: { ...logContext, ...options.logContext }, jevDecision: options.jevDecision || this.decision });
      this.commerceSearchIntent = await commerceRequest;
      return this.commerceSearchIntent;
    },
    async classify(options = {}) {
      // Keep the original options for the provider. Only the reuse key is normalized.
      const c = options.capabilities || {};
      const x = options.conversationContext || {};
      const key = JSON.stringify([
        String(options.userText || "").replace(/\s+/g, " ").trim(),
        [c.canGenerateImage !== false, c.canRecommendProducts !== false, c.canLookupOrder === true, c.canSearchWeb !== false],
        normalizeConversationContext(x),
        referenceId(options.fetchImpl), referenceId(options.configOverride),
      ]);
      if (options.forceRefresh || !requests.has(key)) {
        requests.set(key, Promise.resolve().then(() => classify(classify === resolvePrimaryChatIntent
          ? { ...options, logContext: { ...logContext, ...options.logContext } } : options)).then((value) => freezeDecision(value)));
      }
      return requests.get(key);
    },
  };
}

export async function prepareChatIntentTurn(db, { session = {}, character = {}, userText = "", userDisplayOrder = 0, classify, recentMessages = null, siteId = "", siteSlug = "", userId = "", productTrigger = "", classifyCommerce, commerceBeforeDisplayOrder = userDisplayOrder, commerceForImageOnly = false, classifyImage = classifyChatImageIntent, logContext = {} } = {}) {
  const turn = createChatIntentTurn({ classify, logContext: { sessionId: session.id, characterId: character.id || session.character_id, userId: userId || session.internal_uid || session.internalUid, ...logContext } });
  turn.conversationContext = await resolveRecentImageConversationContext(db, {
    sessionId: session.id,
    beforeDisplayOrder: userDisplayOrder,
  });
  if (isProductCapableCharacter(character)) {
    turn.recentMessages = recentMessages || (commerceBeforeDisplayOrder ? await listRecentMessagesBeforeOrder(db, { sessionId: session.id, beforeDisplayOrder: commerceBeforeDisplayOrder }) : []);
    turn.commerceSite = siteId ? { id: siteId, slug: siteSlug } : await resolveProductRecommendationSite(db, { character, userId: userId || session.internal_uid || session.internalUid || "" });
    const productContext = buildChatProductRoutingContext(turn.recentMessages, { siteId: turn.commerceSite?.id || "", characterId: character.id || session.character_id || "" });
    if (productContext) turn.conversationContext = { ...turn.conversationContext, hasRecentProductContext: true, productContext };
    const unansweredUserQuestion = buildUnansweredUserQuestionContext(turn.recentMessages, { characterId: character.id || session.character_id || "" });
    if (unansweredUserQuestion) turn.conversationContext = { ...turn.conversationContext, unansweredUserQuestion };
  }
  // This is the existing image adapter's input contract, not a union of permissions.
  // Consumers needing a different legacy contract use turn.classify themselves.
  turn.decision = await turn.classify({
    userText: String(userText || "").replace(/\s+/g, " ").trim(),
    capabilities: { canGenerateImage: true, canRecommendProducts: isProductCapableCharacter(character), canLookupOrder: false, canSearchWeb: true },
    conversationContext: turn.conversationContext,
  });
  if (isProductCapableCharacter(character) && commerceForImageOnly) {
    const deterministic = analyzeChatImageTrigger(userText);
    if (isMockChatImageRequest(userText)) return turn;
    turn.imageDecision = await classifyImage(userText, { character, jevDecision: turn.decision,
      conversationContext: turn.conversationContext, forceTargetVerification: deterministic.hasIntent,
      logContext: { sessionId: session.id, characterId: character.id || session.character_id, ...logContext } });
    if (!turn.imageDecision.hasIntent || !turn.imageDecision.allowed) return turn;
  }
  if (isProductCapableCharacter(character)) {
    const history = turn.recentMessages;
    const site = turn.commerceSite;
    await turn.resolveCommerce({ userText, recentMessages: history,
      searchIntent: buildProductSearchIntent(userText, productTrigger, { recentProductContext: buildRecentProductContext(history) }),
      ...(classifyCommerce ? { classifyCommerce } : {}), enrichAllTurns: true, explicitTrigger: Boolean(productTrigger), siteId: site?.id || "", siteSlug: site?.slug || "", characterId: character.id || session.character_id || "" });
  }
  return turn;
}

function freezeDecision(value) {
  if (!value || typeof value !== "object") return value;
  const clone = structuredClone(value);
  const freeze = (node) => {
    for (const child of Object.values(node)) if (child && typeof child === "object") freeze(child);
    return Object.freeze(node);
  };
  return freeze(clone);
}
