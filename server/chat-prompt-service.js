const RECENT_MESSAGE_LIMIT = 50;
import {
  buildBoundaryLayer,
  buildChatImageContextLayer,
  buildDiscountOffersContextLayer,
  buildExternalSourceContextLayer,
  buildKnowledgeContextLayer,
  buildPersonaLayer,
  buildProductContextLayer,
  buildRecentChatLayer,
  buildRelevantHistoryLayer,
  buildUserContextLayer,
  buildVoiceLayer,
  mapPromptMessage,
  normalizeCharacter,
  safeString,
} from "./chat-prompt-layers.js";
import { buildGlobalReplyPolicyLayer } from "./chat-global-reply-policy.js";
import { buildFactualContextLayer } from "./chat-factual-policy.js";
import { buildReplyRecoveryContextLayer } from "./chat-reply-recovery-state.js";
export function buildChatReplyPrompt({ character, trustedSite = null, recentMessages = [], userText = "", userContext = null, externalSourceContext = null, productContext = null, discountOffersContext = null, knowledgeContext = null, factualContext = null, feedbackActionCandidate = null, orderActionCandidate = null, chatImageContext = null, visionInputs = [] } = {}) {
  const normalizedCharacter = normalizeCharacter(character);
  const normalizedMessages = Array.isArray(recentMessages) ? recentMessages.slice(-RECENT_MESSAGE_LIMIT) : [];
  const normalizedUserText = mapPromptMessage({ senderType: "user", text: userText }).content;
  const normalizedVisionInputs = normalizeVisionInputs(visionInputs);
  const layers = [
    buildPersonaLayer({ ...normalizedCharacter, site_id: character?.site_id, siteId: character?.siteId }, trustedSite),
    buildVoiceLayer(normalizedCharacter),
    { id: "language_expression", title: "Language Expression", content: "Use correct spelling, word formation and natural grammar in the configured active reply language. Prefer clear familiar wording over an uncertain invented expression. Preserve the character\'s style, informal idioms, names, code and explicitly requested quotations or translations. Do not imitate spelling or grammar errors in prior assistant messages. This layer does not change persona, relationships, intent, language-selection rules, permissions or factual constraints." },
    buildGlobalReplyPolicyLayer(normalizedCharacter, { feedbackActionCandidate, orderActionCandidate }),
    buildUserContextLayer(userContext),
    buildExternalSourceContextLayer(externalSourceContext),
    userContext?.wakeUpContext ? null : buildRelevantHistoryLayer(userContext?.relevantHistory),
    buildProductContextLayer(normalizedCharacter, productContext, normalizedUserText),
    buildDiscountOffersContextLayer(discountOffersContext),
    buildKnowledgeContextLayer(knowledgeContext, { orderActionCandidate }),
    buildFactualContextLayer(factualContext),
    buildChatImageContextLayer(chatImageContext),
    buildRecentChatLayer(),
    buildReplyRecoveryContextLayer(normalizedMessages),
    buildBoundaryLayer(),
  ].filter((layer) => layer?.content).map((layer) => ({ ...layer, content: mapPromptMessage({ senderType: "system", text: layer.content }).content }));
  return {
    structuredOutput: Boolean(productContext?.candidateContext) || knowledgeContext?.customerServiceIntent === true,
    systemPrompt: layers.map((layer) => `## ${layer.title}\n${layer.content}`).join("\n\n"),
    messages: [
      ...normalizedMessages.map(mapPromptMessage),
      {
        role: "user",
        content: normalizedUserText,
      },
    ],
    visionInputs: normalizedVisionInputs,
    layers,
  };
}

function normalizeVisionInputs(visionInputs = []) {
  return (Array.isArray(visionInputs) ? visionInputs : [])
    .map((input) => ({
      name: safeString(input?.name).slice(0, 160),
      mimeType: safeString(input?.mimeType).slice(0, 80),
      dataUrl: safeString(input?.dataUrl),
    }))
    .filter((input) => input.dataUrl.startsWith("data:image/"))
    .slice(0, 3);
}
