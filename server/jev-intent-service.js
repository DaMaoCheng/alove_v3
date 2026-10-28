import { SUPPORTED_CHARACTER_LANGUAGES } from "../shared/language-library.js";
import { SERVER_CONFIG } from "./config.js";
import { evaluateJevQuestions } from "./jev-evaluation-service.js";
export { evaluateJevQuestions } from "./jev-evaluation-service.js";
import { normalizeChatProductRoutingContext } from "./chat-product-routing-context-service.js";
import { normalizeUnansweredUserQuestion } from "./chat-reply-recovery-state.js";

const MIN_ROUTE_CONFIDENCE = 0.72;
const MIN_PRODUCT_ACTION_CONFIDENCE = 0.72;

const ROUTE_CRITERIA = Object.freeze({
  daily_chat: "Normal conversation, a general question, a compliment, or a comment about an earlier character image or message that does not ask the system to perform a specialized action. Product mentions used as comments such as 'Bonito bikini', 'Nice shirt', or a bare team name belong here.",
  character_photo: "Wants to see or receive existing character photos or several character images. Use this route for generic or plural requests such as 'show me your photos' or 'send some pictures' when no new-scene or creation request is present; this route uses the existing image library first.",
  new_image: "Wants one new image or explicitly asks the character or system to create, generate, make, render, take, or compose a new image or photo. A standalone request such as 'send me one picture' counts as a new-image request; do not use this route when the user asks to see existing character photos.",
  try_on: "Wants the character to wear, try on, or model a product or outfit, including asking the character to wear an item shown in an earlier image or message. This route has priority over image inspection.",
  group_photo: "Wants a new image showing the character together with the user or another person.",
  image_inspection: "Wants the system to inspect, describe, identify, or understand an uploaded image.",
  product_request: "Wants to find, recommend, compare, price, size, or check availability of a merchandise product.",
  order_lookup: "Wants to inspect an existing order, shipment, delivery status, or tracking reference.",
  web_search: "Needs independently requested public-world facts that require external research, including public events, results, news or records. A current-site catalogue task such as choosing merchandise, checking price, size, customization or availability is not public web research by itself.",
  unsupported_request: "Clearly asks for a specialized action that the current character or site cannot provide.",
  unclear: "The request is ambiguous and cannot be routed safely.",
});

export async function classifyJevIntent({
  userText = "",
  capabilities = {},
  conversationContext = null,
  cacheKey = "",
  forceRefresh = false,
  fetchImpl = fetch,
  configOverride = null,
  logContext = {},
} = {}) {
  const text = normalizeText(userText);
  if (!text || text.length > 1200) return unavailableDecision("invalid_input");
  const config = configOverride || SERVER_CONFIG.typeSafe;
  if (!config.enabled || !config.apiKey) return unavailableDecision("missing_api_key");

  const normalizedConversationContext = normalizeConversationContext(conversationContext);
  const result = await evaluateJevQuestions({
    state: { message: text, capabilities: normalizeCapabilities(capabilities), conversation_context: normalizedConversationContext },
    questions: buildQuestions(capabilities), configOverride: config, fetchImpl, forceRefresh, logContext,
    // Existing primary callers and older fixtures omit optional secondary answers.
    // A missing/malformed primary route is a protocol failure, not uncertainty.
    validatePayload: validPrimaryPayload,
  });
  if (!result.ok) return { ...unavailableDecision(result.fallbackReason), ...failureMeta(result) };
  return { ...normalizeJevResponse(result.payload, capabilities, normalizedConversationContext),
    attempts: result.attempts, exhausted: false, llmFallbackAllowed: false, ...(result.cached ? { cached: true } : {}) };
}

function failureMeta(result) {
  return { attempts: result.attempts, exhausted: result.exhausted, llmFallbackAllowed: result.llmFallbackAllowed };
}

function validPrimaryPayload(payload) {
  const answer = payload?.answers?.route;
  return isPlainObject(answer) && Object.hasOwn(ROUTE_CRITERIA, answer.choice)
    && typeof answer.confidence === "number" && Number.isFinite(answer.confidence)
    && answer.confidence >= 0 && answer.confidence <= 1;
}


export function buildQuestions() {
  return {
    route: {
      type: "choice",
      instructions: "What is the user's primary requested action? First distinguish an action request from a comment or compliment. Comments such as 'Bonito bikini', 'Nice shirt', or a bare team name are daily_chat even when they mention a product. Generic or plural requests to see existing character photos go to character_photo and use the existing library first. A standalone request for one picture counts as new_image even without the word generate. Requests to wear or try on an item from an earlier image go to try_on and override image inspection. Use unsupported_request when the user clearly asks for an unavailable specialized function. Use unclear only when the meaning is genuinely ambiguous.",
      criteria: ROUTE_CRITERIA,
    },
    reply_language: {
      type: "choice",
      instructions: "Independently identify whether the CURRENT message explicitly directs the assistant to communicate in one supported language. Interpret meaning in every language, including native names and inflections. This is output-language preference only, never an action permission. A language merely used by the user, a product/country mention, a negated instruction, quoted dialogue, discussion of a language, or translation of a quoted fragment is not a switch. An explicit request to explain the answer in a language does qualify. If multiple output languages are requested, the target is ambiguous or unsupported, choose none. Do not inherit requests from history. Return the target supported code only when explicit; otherwise none.",
      criteria: { none: "No unambiguous current instruction to change the assistant output language.", ...Object.fromEntries(SUPPORTED_CHARACTER_LANGUAGES.map(language => [language.code, `Explicitly requests the assistant output in ${language.label}.`])) },
    },
    reply_language_scope: {
      type: "choice",
      instructions: "For the CURRENT explicit reply-language instruction, identify its scope without changing any action route. turn means this answer only, including explaining this answer in a language. session means continuing this conversation in that language without a lasting account preference; use session when a switch has no explicit duration. persistent requires an explicit enduring/default preference for future conversations. A translation of a quoted fragment does not change the overall reply language. Negation, quotation, mere mention, unsupported/ambiguous language and no switch mean none.",
      criteria: { none: "No unambiguous reply-language switch.", turn: "Only the current answer.", session: "This conversation.", persistent: "Explicit enduring/default preference beyond this conversation." },
    },
    wants_character_image: {
      type: "noul",
      instructions: "Does the user want to see, receive, or get an image of the AI character?",
    },
    explicit_generation: {
      type: "noul",
      instructions: "Does the user ask for one new image, or explicitly ask to create, generate, make, render, take, or compose a new image, selfie, group photo, or try-on result? A generic or plural request to see existing photos is not new-image generation.",
    },
    image_inspection: {
      type: "noul",
      instructions: "Is the user asking the system to inspect or describe an image they provided?",
    },
    product_request: {
      type: "noul",
      instructions: "Does the user want to find, compare, price, size, or check availability of a merchandise product?",
    },
    product_action: {
      type: "noul",
      instructions: "Is the user actively asking the system to find, recommend, compare, price, check size, or check availability of a merchandise product? A compliment, opinion, description, bare product mention, or bare team name is not an action. Examples that are not an action: 'Bonito bikini', 'Nice shirt', 'Real Madrid'.",
    },
    order_lookup: {
      type: "noul",
      instructions: "Does the user want to inspect an existing order, shipment, delivery status, or tracking reference?",
    },
    web_search: {
      type: "noul",
      instructions: "Does the user independently ask for public-world facts such as actual events, results, news, public identities or records that require external research? Finding or choosing merchandise, product specifications, price, size, customization, stock and store policies are catalogue or store tasks, not public web research by themselves, even when product names mention a player, team or event. Mark false when fresh information is needed only for those catalogue/store tasks. If the user ALSO asks an independent public-world question, mark true even when the primary route is product_request or another action. Do not confuse a request for help selecting products with asking for public facts.",
    },
    image_wants_no_clothing: {
      type: "noul",
      instructions: "For an image/photo/try-on request, does the user explicitly ask that the character wear no clothing? Judge purely by meaning, any language, do not rely on a keyword list. A plain photo request or an outfit / try-on request is false.",
    },
    image_wants_clothing: {
      type: "noul",
      instructions: "For an image/photo/try-on request, does the user explicitly want the character wearing or trying on clothing/a kit/a product/their own uploaded item? Do not infer clothing from generic photo wording; only true when the user asks to wear/try on/put on something or names an outfit to wear.",
    },
  };
}

export function normalizeJevResponse(payload = {}, capabilities = {}, conversationContext = {}) {
  const answers = payload?.answers || {};
  const routeAnswer = answers.route || {};
  const primaryIntent = normalizeRoute(routeAnswer.choice);
  const confidence = clamp01(routeAnswer.confidence);
  const imageInspection = readNoul(answers.image_inspection);
  const wantsCharacterImage = readNoul(answers.wants_character_image);
  const explicitGeneration = readNoul(answers.explicit_generation);
  const productRequest = readNoul(answers.product_request);
  const productActionAnswer = readNoul(answers.product_action);
  // Older Jev responses do not contain product_action. Preserve their behavior
  // by using the existing product_request score only when the route itself is
  // explicitly product_request; new responses use the stricter action signal.
  const productAction = Object.prototype.hasOwnProperty.call(answers, "product_action")
    ? productActionAnswer
    : (primaryIntent === "product_request" ? productRequest : 0);
  const orderLookup = readNoul(answers.order_lookup);
  const webSearch = readNoul(answers.web_search);
  const wantsNoClothing = readNoul(answers.image_wants_no_clothing) >= 0.7;
  const wantsClothing = readNoul(answers.image_wants_clothing) >= 0.7;
  const imageIntent = resolveImageIntent({ primaryIntent, imageInspection, wantsCharacterImage, explicitGeneration, conversationContext });
  const productIntent = ["product_request", "try_on"].includes(primaryIntent)
    && productAction >= MIN_PRODUCT_ACTION_CONFIDENCE
    ? "search"
    : "none";
  const orderIntent = primaryIntent === "order_lookup" || orderLookup >= 0.7 ? "lookup" : "none";
  const supported = resolveSupport({ primaryIntent, imageIntent, productIntent, orderIntent, capabilities });
  return {
    ok: true,
    source: "jev",
    primaryIntent,
    confidence,
    confident: confidence >= MIN_ROUTE_CONFIDENCE,
    imageIntent,
    productIntent,
    productAction,
    orderIntent,
    webSearchIntent: webSearch >= 0.7 || primaryIntent === "web_search",
    webSearchScore: webSearch,
    languageDecision: normalizeReplyLanguageDecision(answers),
    unsupported: supported.unsupported,
    unsupportedIntent: supported.intent,
    imageConditions: { wants_no_clothing: wantsNoClothing, wants_clothing: wantsClothing },
    probabilities: isPlainObject(routeAnswer.probabilities) ? routeAnswer.probabilities : {},
    model: String(payload?.model || SERVER_CONFIG.typeSafe.model),
  };
}

export function mapJevImageIntent(decision = {}) {
  if (!decision?.ok || !decision.confident) return null;
  if (decision.imageIntent === "image_inspection") return { hasIntent: false, intentType: "image_inspection" };
  if (!["library_photo", "explicit_generation", "try_on", "group_photo"].includes(decision.imageIntent)) return null;
  return {
    hasIntent: true,
    allowed: !decision.unsupported,
    confidence: decision.confidence,
    intentType: decision.imageIntent,
    explicitGeneration: ["explicit_generation", "try_on", "group_photo"].includes(decision.imageIntent),
    conditions: decision.imageConditions || null,
    detectionSource: "jev",
  };
}

function resolveImageIntent({ primaryIntent, imageInspection, wantsCharacterImage, explicitGeneration, conversationContext = {} }) {
  if (primaryIntent === "try_on") return "try_on";
  if (primaryIntent === "group_photo") return "group_photo";
  if (primaryIntent === "new_image") return "explicit_generation";
  if (imageInspection >= 0.7 || primaryIntent === "image_inspection") return "image_inspection";
  if (primaryIntent === "character_photo" || wantsCharacterImage >= 0.7) {
    return explicitGeneration >= 0.7 ? "explicit_generation" : "library_photo";
  }
  return "none";
}

function resolveSupport({ primaryIntent, imageIntent, productIntent, orderIntent, capabilities = {} }) {
  if (productIntent !== "none" && capabilities.canRecommendProducts === false) return { unsupported: true, intent: "product_request" };
  if (orderIntent !== "none" && capabilities.canLookupOrder === false) return { unsupported: true, intent: "order_lookup" };
  if (imageIntent !== "none" && imageIntent !== "image_inspection" && capabilities.canGenerateImage === false) return { unsupported: true, intent: "image_request" };
  if (primaryIntent === "web_search" && capabilities.canSearchWeb === false) return { unsupported: true, intent: "web_search" };
  return { unsupported: false, intent: "" };
}

function normalizeCapabilities(value = {}) {
  return {
    canGenerateImage: value.canGenerateImage !== false,
    canRecommendProducts: value.canRecommendProducts !== false,
    canLookupOrder: value.canLookupOrder === true,
    canSearchWeb: value.canSearchWeb !== false,
  };
}

export function normalizeConversationContext(value = {}) {
  const productContext = normalizeChatProductRoutingContext(value?.productContext);
  const unansweredUserQuestion = normalizeUnansweredUserQuestion(value?.unansweredUserQuestion);
  return {
    hasRecentImage: value?.hasRecentImage === true,
    hasRecentUserImage: value?.hasRecentUserImage === true,
    hasRecentProductImage: value?.hasRecentProductImage === true,
    hasRecentCharacterImage: value?.hasRecentCharacterImage === true,
    hasRecentProductContext: value?.hasRecentProductContext === true || Boolean(productContext),
    recentImageCount: Math.max(0, Math.min(50, Number(value?.recentImageCount || 0))),
    ...(productContext ? { productContext } : {}),
    ...(unansweredUserQuestion ? { unansweredUserQuestion } : {}),
  };
}

function normalizeRoute(value) {
  const route = String(value || "").trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(ROUTE_CRITERIA, route) ? route : "unclear";
}

function normalizeReplyLanguageDecision(answers) {
  const target = answers.reply_language, duration = answers.reply_language_scope;
  if (!SUPPORTED_CHARACTER_LANGUAGES.some(language => language.code === target?.choice)
    || !['turn', 'session', 'persistent'].includes(duration?.choice)
    || ![target?.confidence, duration?.confidence].every(value => typeof value === 'number' && Number.isFinite(value) && value >= .8 && value <= 1)) return null;
  return { targetCode: target.choice, scope: duration.choice, confidence: Math.min(target.confidence, duration.confidence) };
}

function readNoul(answer = {}) {
  return clamp01(answer?.noul);
}

function clamp01(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : 0;
}

function unavailableDecision(reason) {
  return {
    ok: false,
    source: "jev_unavailable",
    attempts: 0, exhausted: false, llmFallbackAllowed: false,
    fallbackReason: String(reason || "unavailable"),
    primaryIntent: "",
    confidence: 0,
    confident: false,
    imageIntent: "none",
    productIntent: "none",
    productAction: 0,
    orderIntent: "none",
    webSearchIntent: false,
    webSearchScore: 0,
    languageDecision: null,
    unsupported: false,
    unsupportedIntent: "",
    probabilities: {},
  };
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}
