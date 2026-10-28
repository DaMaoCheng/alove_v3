import {
  resolveLocalProductAgeRangeRequirement,
  resolveNearestLocalProductAgeRequirement,
} from "./product-size-chart-catalog.js";
import { EDITION_FEATURE_DEFINITIONS, requestedProductEdition, resolveCanonicalProductEdition } from "./product-edition-service.js";
import { evaluateProductAttributeMatch, extractRequestedPrinting } from "./product-attribute-evidence-service.js";
import { CHILD_PRODUCT_SIZE_LABELS } from './product-requirement-fields.js';
import {
  countRecentProductClarifications,
  mergeProductRequirement,
  resolveProductSearchReadiness,
  resolveProductSearchState,
} from "./product-search-decision-service.js";

export { resolveProductSearchState } from "./product-search-decision-service.js";

export const PRODUCT_TRIGGER_QUICK = "quick_product";

const PRODUCT_TRIGGER_PATTERNS = Object.freeze([
  /商品|产品|衣服|上衣|短袖|购买|买|下单|链接|价格|多少钱|库存|现货|缺货|补货|推荐|折扣|优惠|促销|活动|便宜|低价|划算|尺码|尺寸|球衣|队服|训练服|周边|球迷版|球员版|印号|印字|定制|主场|客场|第三客场|俱乐部|球队|球星/i,
  /\b(product|products|clothes|clothing|top|tee|t-shirt|buy|shop|order|checkout|link|price|cost|stock|available|availability|sold out|restock|recommend|recommendation|discount|deal|promo|offer|sale|cheap|budget|affordable|size|sizing|fit|fitting|kit|kits|jersey|jerseys|shirt|shirts|strip|strips|trikot|fussballtrikot|fußballtrikot|voetbalshirt|training top|merch|merchandise|custom|nameset|home kit|away kit|third kit|club|team|player|drop|drops|looking for|camiseta|camisetas|equipacion|equipación|disponible|tuvieran|busco|encontrar|formalari|forma|formaları|forma|mevcut|cocuk|çocuk|cocuklar|çocuklar|var mı|varmi|satın|linki)\b/iu,
]);
const BUDGET_PATTERNS = Object.freeze([/便宜|低价|划算|折扣|优惠|促销|特价/i, /\b(cheap|budget|affordable|discount|deal|promo|offer|sale)\b/i]);
const POPULAR_PATTERNS = Object.freeze([/热销|爆款|畅销|热门|人气/i, /\b(popular|best\s?sellers?|best\s?selling|hot\s?sellers?|hot\s?selling|top\s?sellers?|trending)\b/i]);
const SIZE_PATTERNS = Object.freeze([
  /尺码|尺寸|大小|合身|版型/i,
  /\b(?:size|sizing|fit|fitting|beden|olcu|ölçü|kalip|kalıp|meret|méret|talla|taille)\b/iu,
  /(?:مقاس|قياس)/u,
]);
const SIZE_PROFILE_ALIASES = Object.freeze([
  ["plus_size", ["plus size", "plus-size", "extended size", "extended sizes", "big size", "big sizes", "大码", "加大码", "大尺码"]],
]);
const BODY_MEASUREMENT_PATTERN = /\b\d{2,3}\s*(?:cm|kg|lb|lbs|kilograms?)\b|\b\d{1,2}\s*(?:ft|feet)\b|(?:身高|体重|الطول|الوزن)|\b(?:boy|kilo|magasság|testsúly|altura|peso|taille|poids)\b.{0,12}\d/iu;
const STANDARD_SIZE_LABELS = Object.freeze(["5XL", "4XL", "3XL", "2XL", "XXL", "XL", "XXS", "XS", "S", "M", "L"]);
const STOCK_PATTERNS = Object.freeze([/库存|现货|缺货|补货|有货/i, /\b(stock|available|availability|sold out|restock)\b/i]);
const CUSTOMER_SERVICE_KNOWLEDGE_PATTERNS = Object.freeze([
  /(?:authentic|fake|counterfeit|genuine|original|legit|official(?:ly)?\s+licensed|正品|假冒|仿品|真假|真伪)/i,
  /(?:refund|return|exchange|cancel(?:lation)?|wrong item|damaged|退货|退款|换货|取消订单|发错|破损)/i,
  /(?:shipping|delivery|tracking|parcel|dispatch|customs|duty|tax|物流|发货|配送|快递|包裹|追踪|海关|关税)/i,
  /(?:customer service|support|complaint|whatsapp|e-?mail|客服|售后|投诉|联系)/i,
]);
const COLOR_ALIASES = Object.freeze([
  ["black", ["black", "黑色", "黑"]],
  ["white", ["white", "白色", "白"]],
  ["red", ["red", "红色", "红"]],
  ["blue", ["blue", "蓝色", "蓝"]],
  ["green", ["green", "verde", "yeşil", "yesil", "绿色", "绿"]],
  ["yellow", ["yellow", "黄色", "黄"]],
  ["pink", ["pink", "粉色", "粉"]],
  ["purple", ["purple", "紫色", "紫"]],
  ["orange", ["orange", "橙色", "橙"]],
  ["grey", ["grey", "gray", "灰色", "灰"]],
]);
const ALTERNATIVE_PRODUCT_PATTERNS = Object.freeze([
  /换一个|换一件|另一个|另一件|别的|其他款|其他的|还有别的吗|不要这个|不是这个|不想要这个|重新推荐/i,
  /\b(another one|another|something else|different one|different kit|different shirt|not this|no this|show another|any other|else)\b/i,
]);
const TEAM_ALIASES = Object.freeze([
  ["AC Milan", ["ac milan", "acmilan", "a.c. milan", "rossoneri"]],
  ["Arsenal", ["arsenal"]],
  ["Manchester United", ["manchester united", "man united", "man utd"]],
  ["Manchester City", ["manchester city", "man city", "manchester c"]],
  ["Inter Milan", ["inter milan", "internazionale"]],
  ["Real Madrid", ["real madrid"]],
  ["Barcelona", ["barcelona", "barca", "barça"]],
  ["Liverpool", ["liverpool"]],
  ["Chelsea", ["chelsea"]],
  ["Tottenham", ["tottenham", "spurs"]],
  ["Juventus", ["juventus", "juve"]],
  ["Bayern Munich", ["bayern munich", "bayern"]],
  ["Paris Saint-Germain", ["paris saint-germain", "psg"]],
  ["Argentina", ["argentina"]],
  ["England", ["england"]],
  ["Spain", ["spain", "spanish", "españa", "espana", "西班牙"]],
  ["Italy", ["italy", "italia", "italien", "意大利"]],
  ["Sporting CP", ["sporting cp", "sporting clube de portugal", "sporting club de portugal", "sporting lisbon", "sporting portugal"]],
  ["Al Nassr", ["al nassr", "al-nassr", "alnassr"]],
  ["Portugal", ["portugal", "葡萄牙"]],
  ["Tigres", ["tigres", "tigres uanl"]],
]);
const AUDIENCE_ALIASES = Object.freeze([
  ["adult", ["adult", "adults", "men", "mens", "men's", "male", "grown up", "adult size", "成人", "男款", "男士", "男子", "男装"]],
  ["kids", ["kid", "kids", "kid's", "child", "children", "childrens", "children's", "youth", "junior", "boy", "boys", "girl", "girls", "nino", "niño", "niños", "ninos", "nina", "niña", "niñas", "ninas", "infantil", "juvenil", "cocuk", "çocuk", "cocuklar", "çocuklar", "儿童", "童装", "童款", "男童", "女童", "小孩", "青少年"]],
  ["women", ["women", "womens", "women's", "female", "ladies", "女款", "女装", "女士"]],
]);
const PRODUCT_FEATURE_DEFINITIONS = Object.freeze([
  {
    id: "goalkeeper",
    aliases: ["goalkeeper", "goal keeper", "goalie", "keeper", "门将", "守门员"],
  },
  {
    id: "long_sleeve",
    aliases: ["long sleeve", "long sleeves", "long-sleeve", "manga larga", "mangas largas", "uzun kollu", "长袖"],
  },
  {
    id: "sleeveless",
    aliases: ["sleeveless", "without sleeves", "sin mangas", "sin manga", "kolsuz", "无袖"],
  },
  {
    id: "short_sleeve",
    aliases: ["short sleeve", "short sleeves", "short-sleeve", "manga corta", "mangas cortas", "短袖"],
  },
  {
    id: "full_kit",
    aliases: ["full kit", "full kits", "complete kit", "jersey shorts", "整套", "全套"],
  },
  ...EDITION_FEATURE_DEFINITIONS,
  {
    id: "training",
    aliases: ["training", "training top", "training shirt", "entreno", "entrenamiento", "training jersey", "训练服", "训练款"],
  },
]);
const PRODUCT_STOP_WORDS = Object.freeze(new Set([
  "有没有", "有", "什么", "推荐", "想要", "一件", "一个", "产品", "商品", "衣服", "球衣", "队服", "购买", "价格", "多少钱", "便宜", "折扣", "优惠", "尺码",
    "can", "you", "do", "does", "have", "has", "in", "with", "about", "tell", "show", "see", "find", "pick", "help", "know", "recommend", "product", "products", "want", "need", "buy", "shirt", "shirts", "jersey", "jerseys", "kit", "kits", "strip", "strips", "trikot", "fussballtrikot", "fußballtrikot", "voetbalshirt", "football", "soccer", "club", "team", "cheap", "budget", "price", "stock", "size", "gift", "any", "anything", "something", "another", "one", "else", "different", "a", "an", "the", "what", "for", "me", "please", "fresh", "new", "popular", "best", "seller", "sellers", "selling", "bestseller", "bestselling", "hot", "trending", "adult", "adults", "men", "mens", "male", "kids", "kid", "children", "youth", "junior", "women", "womens", "female", "ladies", "and", "or",
  "looking", "am", "im", "searching",
  "quiero", "quisiera", "gustaria", "comprar", "una", "uno", "para", "del", "de", "la", "el", "los", "las", "segunda", "equipacion", "camiseta", "camisetas",
  "long", "short", "sleeve", "sleeves",
  "when", "will", "would", "could", "should", "but", "be", "is", "are", "was", "were", "of", "from", "at", "on", "my", "your", "their", "its", "it", "this", "that", "these", "those", "fc", "season", "seasons", "year", "years", "coming", "next", "latest", "current", "release", "released", "launch", "launching", "available", "availability", "ft", "feet", "height", "weight",
  "month", "months", "mos",
  "hi", "hello", "hey", "millie", "how", "doing", "good", "thanks", "thank", "got", "have", "world", "cup", "top",
  "normal", "plain", "standard",
  "no", "not", "wrong", "actually", "instead", "without", "said", "mean", "meant", "yes", "yeah", "yep", "yup", "correct", "right", "exactly",
  "just", "number", "printing", "printed", "customize", "customized", "customise", "customised", "customization", "customisation",
]));
// Only high-confidence, catalogue-relevant corrections belong here.  We do not
// run a general spell checker: proper names and player names must never be
// silently rewritten before the user confirms the suggestion.
const PRODUCT_CORRECTION_ALIASES = Object.freeze(new Map([
  ["golie", "goalie"],
  ["goaly", "goalie"],
  ["goaliee", "goalie"],
  ["bacelona", "barcelona"],
]));
const PRODUCT_CORRECTION_CONTEXT_PATTERN = /\b(?:kit|kits|jersey|jerseys|shirt|shirts|strip|strips|trikot|football|soccer|goalkeeper|goalie)\b|球衣|队服|门将|守门员/i;
const PRODUCT_CORRECTION_CONFIRMATION_PATTERN = /^(?:yes|yeah|yep|yup|ja|jawohl|correct|right|that's right|that is right|exactly|对|是的?|没错|正确|就是)$/i;

export function normalizeProductTrigger(value = "") {
  return safeString(value) === PRODUCT_TRIGGER_QUICK ? PRODUCT_TRIGGER_QUICK : "";
}

export function buildProductSearchIntent(userText = "", productTrigger = "", { recentProductContext = null } = {}) {
  const explicitProductTrigger = productTrigger === PRODUCT_TRIGGER_QUICK;
  const text = safeString(userText);
  const nonShoppingReason = resolveNonShoppingReason(text);
  const currentCorrectionSuggestion = extractProductCorrectionSuggestion(text);
  const recentCorrectionSuggestion = recentProductContext?.correctionSuggestion || null;
  const correctionConfirmed = Boolean(
    recentCorrectionSuggestion?.corrected
    && PRODUCT_CORRECTION_CONFIRMATION_PATTERN.test(normalizeLooseText(text))
  );
  const customerServiceKnowledgeRequest = isCustomerServiceKnowledgeRequest(text);
  const isContextualFollowup = isProductContextFollowup(text);
  const confirmationFollowup = Boolean(
    PRODUCT_CORRECTION_CONFIRMATION_PATTERN.test(normalizeLooseText(text))
    && hasPendingProductConstraints(recentProductContext)
  );
  const currentRequestedTeam = extractRequestedTeam(text);
  const currentRequirement = {
    requestedTeam: currentRequestedTeam,
    requestedVariants: extractRequestedVariants(text),
    requestedProductType: extractRequestedProductType(text),
    requestedAudience: extractRequestedAudience(text),
    requestedAgeRange: extractRequestedAgeRange(text),
    requestedSizeProfile: extractRequestedSizeProfile(text),
    requestedColor: extractRequestedColor(text),
    requestedSeason: extractRequestedSeason(text, { requestedTeam: currentRequestedTeam }),
    requestedFeatures: extractRequestedFeatures(text),
    customizationRequest: resolveCustomizationRequest(text),
    requestedPrinting: extractRequestedPrinting(text),
    requestedSizes: extractRequestedSizes(text),
    hasBodyMeasurements: BODY_MEASUREMENT_PATTERN.test(text),
    clearFields: extractRequirementClearFields(text),
  };
  if (currentRequirement.requestedAgeRange && !currentRequirement.requestedAudience) currentRequirement.requestedAudience = "kids";
  currentRequirement.requestedPrintNumber = extractRequestedPrintNumber(text, {
    customizationRequest: currentRequirement.customizationRequest,
  });
  if (currentRequirement.clearFields.includes("customizationRequest")) currentRequirement.customizationRequest = "";
  if (currentRequirement.clearFields.includes("requestedPrintNumber")) currentRequirement.requestedPrintNumber = "";
  currentRequirement.requestedKeywords = extractRequestedKeywords(text, {
    ...currentRequirement,
    customizationRequest: currentRequirement.customizationRequest,
    requestedSizes: currentRequirement.requestedSizes,
  });
  if (explicitProductTrigger && !PRODUCT_TRIGGER_PATTERNS.some((pattern) => pattern.test(text))) {
    currentRequirement.requestedKeywords = [];
  }
  const currentCatalogueAnchor = requirementCatalogueAnchor(currentRequirement);
  const recentCatalogueAnchor = requirementCatalogueAnchor(recentProductContext);
  const switchesCatalogueAnchor = Boolean(
    currentCatalogueAnchor
    && recentCatalogueAnchor
    && currentCatalogueAnchor !== recentCatalogueAnchor
    && (
      (currentRequestedTeam
        && recentProductContext?.requestedTeam
        && normalizeLooseText(currentRequestedTeam) !== normalizeLooseText(recentProductContext.requestedTeam))
      || currentRequirement.requestedProductType
      || hasProductAvailabilityPhrase(text)
      || isTeamCatalogRequest(text)
      || isCorrectionText(text)
    )
  );
  const resolvesPendingProductContext = Boolean(
    currentCatalogueAnchor
    && !recentCatalogueAnchor
    && hasPendingProductConstraints(recentProductContext)
  );
  const selfContainedCatalogueRequest = !currentRequirement.clearFields.length
    && isSelfContainedCatalogueRequest(text, currentRequirement);
  const shouldReuseRecentConstraints = (
    (isContextualFollowup && !selfContainedCatalogueRequest)
    || (currentRequestedTeam && hasPendingProductConstraints(recentProductContext) && !selfContainedCatalogueRequest)
    || resolvesPendingProductContext
    || correctionConfirmed
    || confirmationFollowup
  ) && !switchesCatalogueAnchor;
  const mergedRequirement = mergeProductRequirement(currentRequirement, recentProductContext, {
    reuseRecent: shouldReuseRecentConstraints,
  });
  if (correctionConfirmed) {
    mergedRequirement.requestedKeywords = normalizeRequestedKeywords(
      mergedRequirement.requestedKeywords.map((keyword) => keyword === recentCorrectionSuggestion.original
        ? recentCorrectionSuggestion.corrected
        : keyword)
    );
  }
  const requestedTeam = mergedRequirement.requestedTeam;
  const requestedVariants = mergedRequirement.requestedVariants;
  const requestedVariant = requestedVariants[0] || "";
  const requestedSeason = mergedRequirement.requestedSeason;
  const requestedProductType = mergedRequirement.requestedProductType
    || (requestedTeam && (hasProductAvailabilityPhrase(text) || isTeamCatalogRequest(text) || requestedSeason) ? "shirt" : "");
  const requestedAgeRange = mergedRequirement.requestedAgeRange;
  const requestedSizeProfile = mergedRequirement.requestedSizeProfile;
  const requestedAudience = mergedRequirement.requestedAudience;
  const requestedColor = mergedRequirement.requestedColor;
  const requestedFeatures = mergedRequirement.requestedFeatures;
  const customizationRequest = mergedRequirement.customizationRequest;
  const requestedPrinting = mergedRequirement.requestedPrinting;
  const requestedPrintNumber = mergedRequirement.requestedPrintNumber;
  const requestedKeywords = mergedRequirement.requestedKeywords;
  // A size applies to this turn only. Reusing an older size would constrain a
  // new product request without the user asking for it.
  const requestedSizes = currentRequirement.requestedSizes;
  const hasBodyMeasurements = currentRequirement.hasBodyMeasurements;
  const explicitSizingProductSearch = Boolean(
    (requestedSizes.length || hasBodyMeasurements)
    && (currentRequirement.requestedTeam || currentRequirement.requestedKeywords.length)
  );
  const excludeTeams = extractExcludedTeams(text);
  const contextSource = !currentCatalogueAnchor && requirementCatalogueAnchor(mergedRequirement)
    ? "recent_product_context"
    : "current_message";
  const isCorrection = isCorrectionText(text);
  const detectedIntent = detectProductIntent(text, { requestedSizes, hasBodyMeasurements });
  const query = buildStructuredProductQuery({
    requestedTeam,
    requestedVariant,
    requestedVariants,
    requestedProductType,
    requestedAudience,
    requestedAgeRange,
    requestedSizeProfile,
    requestedColor,
    requestedSeason,
    requestedFeatures,
    requestedKeywords,
    requestedSizes,
    hasBodyMeasurements,
    explicitSizingProductSearch,
    fallbackText: explicitProductTrigger && !PRODUCT_TRIGGER_PATTERNS.some((pattern) => pattern.test(text)) ? "" : text,
  });
  const intent = {
    query: query || "recommended",
    intent: explicitProductTrigger && detectedIntent === "recommendation" && query === "recommended" ? PRODUCT_TRIGGER_QUICK : detectedIntent,
    requestedTeam,
    requestedVariant,
    requestedVariants,
    requestedProductType,
    requestedAudience,
    requestedAgeRange,
    requestedSizeProfile,
    requestedColor,
    requestedSeason,
    requestedFeatures,
    requestedKeywords,
    requestedSizes,
    hasBodyMeasurements,
    explicitSizingProductSearch,
    excludeTeams,
    isCorrection,
    contextSource,
    explicitProductTrigger,
    customerServiceKnowledgeRequest,
    nonShoppingReason,
    customizationRequest,
    requestedPrinting,
    requestedPrintNumber,
    genericRecommendationRequest: isGenericProductRecommendationRequest(text),
    productCustomizationRequest: customizationRequest === "jersey",
    ambiguousCustomizationRequest: customizationRequest === "ambiguous",
  };
  const result = {
    ...intent,
    clarificationCount: Math.max(0, Number(recentProductContext?.clarificationCount || 0)),
    correctionSuggestion: correctionConfirmed ? null : currentCorrectionSuggestion || recentCorrectionSuggestion,
    shouldLoadProductContext: !nonShoppingReason && (explicitProductTrigger
      || correctionConfirmed
      || Boolean(currentCorrectionSuggestion)
      || (!customerServiceKnowledgeRequest && (
        shouldLoadProductContext(text, intent)
        || confirmationFollowup
        || Boolean(currentRequestedTeam && hasPendingProductConstraints(recentProductContext))
      ))),
  };
  return {
    ...result,
    searchState: resolveProductSearchReadiness(result),
  };
}

export function isCustomerServiceKnowledgeRequest(userText = "") {
  const text = safeString(userText);
  return Boolean(text) && CUSTOMER_SERVICE_KNOWLEDGE_PATTERNS.some((pattern) => pattern.test(text));
}

// Task exclusions precede catalogue keyword triggers. They do not change chat replies.
export function resolveNonShoppingReason(userText = "") {
  const text = normalizeLooseText(userText);
  if (/\b(?:sponsorship|sponsoring|patrocinio|patrocinar|collaborate|collaborating|colaborar)\b|商务合作|寻求赞助|品牌合作/.test(text)) return "business_contact";
  if (/\b(?:collaboration|colaboracion(?:es)?)\b/.test(text)
    && /\b(?:project|proyecto|business|negocio|content|contenido|partnership|partner|contact|contactar)\b/.test(text)) return "business_contact";
  const notificationAction = /\b(?:notify|notification|alert me|remind me|avisar\w*|avisa\w*|avisen\w*)\b|到货通知|上架通知|通知我|到货.*提醒|补货.*提醒/.test(text);
  const futureStock = /\b(?:restock|back in stock|available again|when|vuelva|vuelvan|cuando|ponen a la venta)\b|补货|到货|上架/.test(text);
  if (notificationAction || (/\blet me know\b/.test(text) && futureStock)) return "stock_notification";
  if (/\b(?:do not|dont|don t|not interested in|no quiero|no deseo).{0,25}\b(?:buy|shop|purchase|comprar|comprando)\b|不(?:想|要|需要)?(?:买|购买|购物)|别推荐|不要推荐/.test(text)) return "declined_shopping";
  return "";
}

export function normalizeProductQueryTeamAlias(value = "", { requestedTeam = "" } = {}) {
  let normalized = normalizeLooseText(value);
  const canonicalTeam = safeString(requestedTeam);
  if (!normalized || !canonicalTeam) return normalized;
  const aliases = TEAM_ALIASES.find(([canonical]) => canonical === canonicalTeam)?.[1] || [];
  for (const alias of aliases) {
    const aliasText = normalizeLooseText(alias);
    if (!aliasText || aliasText === normalizeLooseText(canonicalTeam)) continue;
    normalized = normalized.replace(new RegExp(`(?:^|\\s)${escapeRegExp(aliasText)}(?=\\s|$)`, "gi"), ` ${canonicalTeam}`);
  }
  return normalized.replace(/\s+/g, " ").trim();
}

export function buildRecentProductContext(messages = []) {
  const rows = Array.isArray(messages) ? messages : [];
  const userContext = {};
  let boundaryTeam = "";
  const clearedFields = new Set();
  for (let index = rows.length - 1, checkedUsers = 0; index >= 0 && checkedUsers < 6; index -= 1) {
    const message = rows[index] || {};
    if (!isUserAuthoredMessage(message)) continue;
    checkedUsers += 1;
    const text = safeString(message.text || message.text_content);
    if (!text) continue;
    const correctionSuggestion = extractProductCorrectionSuggestion(text);
    const requestedTeam = extractRequestedTeam(text);
    if (requestedTeam && boundaryTeam && normalizeLooseText(requestedTeam) !== normalizeLooseText(boundaryTeam)) break;
    if (requestedTeam && !boundaryTeam) boundaryTeam = requestedTeam;
    const requestedAgeRange = extractRequestedAgeRange(text);
    const requestedSizeProfile = extractRequestedSizeProfile(text);
    const requestedAudience = extractRequestedAudience(text) || (requestedAgeRange ? "kids" : "");
    const requestedVariants = extractRequestedVariants(text);
    const requestedVariant = requestedVariants[0] || "";
    const requestedProductType = extractRequestedProductType(text);
    const requestedColor = extractRequestedColor(text);
    const requestedFeatures = extractRequestedFeatures(text);
    let customizationRequest = resolveCustomizationRequest(text);
    const requestedPrinting = extractRequestedPrinting(text);
    let requestedPrintNumber = extractRequestedPrintNumber(text, { customizationRequest });
    const clearFields = extractRequirementClearFields(text);
    if (clearFields.includes("customizationRequest")) customizationRequest = "";
    if (clearFields.includes("requestedPrintNumber")) requestedPrintNumber = "";
    for (const field of clearFields) clearedFields.add(field);
    const requestedKeywords = extractRequestedKeywords(text, {
      requestedTeam,
      requestedVariants,
      requestedColor,
      requestedFeatures,
      customizationRequest,
    });
    const hasStructuredRequirement = Boolean(
      requestedTeam
      || requestedAudience
      || requestedAgeRange
      || requestedSizeProfile
      || requestedVariant
      || requestedProductType
      || requestedColor
      || requestedFeatures.length
      || customizationRequest
      || requestedPrinting
      || requestedPrintNumber
    );
    if (!hasStructuredRequirement && requestedKeywords.length && Object.keys(userContext).length) {
      if (!clearedFields.has("requestedKeywords")) userContext.requestedKeywords = requestedKeywords;
      if (isCorrectionText(text)) {
        for (const field of [
          "requestedTeam",
          "requestedAudience",
          "requestedAgeRange",
          "requestedSizeProfile",
          "requestedColor",
          "requestedSeason",
          "requestedFeatures",
          "customizationRequest",
          "requestedPrintNumber",
        ]) clearedFields.add(field);
      }
      break;
    }
    if (!hasStructuredRequirement && !clearFields.length) continue;
    if (requestedTeam && !hasProductAvailabilityPhrase(text) && !requestedProductType && !requestedVariant && !customizationRequest && !requestedPrintNumber && !requestedSizeProfile) continue;
    mergeRecentProductContext(userContext, {
      requestedTeam,
      requestedVariant,
      requestedVariants,
      requestedProductType: requestedProductType || "shirt",
      requestedAudience,
      requestedAgeRange,
      requestedSizeProfile,
      requestedColor,
      requestedSeason: extractRequestedSeason(text, { requestedTeam }),
      requestedFeatures,
      requestedKeywords,
      customizationRequest,
      requestedPrinting,
      requestedPrintNumber,
      correctionSuggestion,
      clearFields,
    }, clearedFields);
  }
  const recentProduct = findRecentProductMessage(messages);
  const storedContext = recentProduct?.searchIntent || null;
  const clarificationCount = countRecentProductClarifications(rows);
  if (!Object.keys(userContext).length) {
    return storedContext
      ? { ...storedContext, clarificationCount }
      : (clarificationCount ? { clarificationCount } : storedContext);
  }
  // Product cards only fill gaps; user constraints survive assistant/card messages.
  const mergedContext = { ...userContext };
  mergeRecentProductContext(mergedContext, storedContext || {}, clearedFields);
  if (!mergedContext.correctionSuggestion && storedContext?.correctionSuggestion) {
    mergedContext.correctionSuggestion = storedContext.correctionSuggestion;
  }
  mergedContext.clarificationCount = clarificationCount;
  return mergedContext;
}

export function extractProductCorrectionSuggestion(text = "") {
  const raw = safeString(text);
  if (!raw || !PRODUCT_CORRECTION_CONTEXT_PATTERN.test(raw)) return null;
  const match = raw.match(/\b([a-z][a-z0-9'-]*)\b/gi)?.find((token) => PRODUCT_CORRECTION_ALIASES.has(token.toLowerCase())) || "";
  if (!match || match[0] !== match[0].toLowerCase()) return null;
  const corrected = PRODUCT_CORRECTION_ALIASES.get(match.toLowerCase());
  if (!corrected) return null;
  const replaced = normalizeLooseText(raw.replace(new RegExp(`\\b${escapeRegExp(match)}\\b`, "i"), corrected));
  const phrase = replaced
    .replace(/^(?:do you have|have you got|can i get|i want|i need|looking for|show me|find me|please|any)\s+/i, "")
    .replace(/^(?:im|i m)\s+(?:whats|what is)\s+the\s+/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .split(/\s+/)
    .slice(0, 6)
    .join(" ");
  return {
    original: match.toLowerCase(),
    corrected,
    correctedText: phrase || corrected,
  };
}

export function isProductCorrectionConfirmation(text = "") {
  return PRODUCT_CORRECTION_CONFIRMATION_PATTERN.test(normalizeLooseText(text));
}

export function buildProductCorrectionClarificationReply(searchIntent = {}, { language = "en" } = {}) {
  const phrase = safeString(searchIntent?.correctionSuggestion?.correctedText)
    || safeString(searchIntent?.correctionSuggestion?.corrected);
  if (!phrase) return "";
  const normalizedLanguage = safeString(language).toLowerCase();
  if (normalizedLanguage === "zh" || normalizedLanguage.startsWith("zh-") || normalizedLanguage.includes("chinese") || normalizedLanguage.includes("中文")) {
    return `你是指“${phrase}”吗？`;
  }
  return `Did you mean “${phrase}”?`;
}

export function findRecentProductMessage(messages = []) {
  const rows = Array.isArray(messages) ? messages : [];
  for (let index = rows.length - 1, checked = 0; index >= 0 && checked < 12; index -= 1, checked += 1) {
    const message = rows[index] || {};
    const product = message.product && typeof message.product === "object" ? message.product : null;
    if (!product?.name) continue;
    const searchIntent = normalizeStoredProductIntent(product.searchIntent);
    return { product, searchIntent, messageIndex: index };
  }
  return null;
}

export function isProductImageCardRequest(userText = "") {
  const text = normalizeLooseText(userText);
  if (!text) return false;
  if (/\b(?:yourself|selfie|your (?:photo|pic|picture|image|face)|of you|de ti|tu (?:foto|cara)|tus fotos)\b|你的(?:照片|图片|脸)|自拍|看看你|给我看你/.test(text)) return false;
  return /\b(?:send|show|share)\s+(?:me\s+)?(?:(?:a|the)\s+)?(?:photo|pic|picture|image)\b/i.test(text)
    || /(?:发|给我|看看|看下).{0,8}(?:图片|照片|商品图|产品图)/.test(text);
}

export function isRecentProductConversationActive(messages = [], userText = "") {
  const recent = findRecentProductMessage(messages);
  if (!recent) return false;
  const currentText = normalizeLooseText(userText);
  if (isProductImageCardRequest(userText)
    && /\b(?:that|same|previous|last)\s+(?:jersey|shirt|kit|product)|\b(?:esa|misma)\s+(?:camiseta|equipacion)|刚才|之前|那件|同款/.test(currentText)) return true;
  return messages.slice(recent.messageIndex + 1).every((message) => {
    if (!isUserAuthoredMessage(message)) return true;
    const text = safeString(message.text || message.text_content);
    if (/^(?:thanks?|thank you|gracias|ok(?:ay)?|yes|si|好的|谢谢)[.!\s]*$/i.test(normalizeLooseText(text))) return true;
    const intent = buildProductSearchIntent(text);
    return !intent.nonShoppingReason && (intent.shouldLoadProductContext || /\b(?:precio|price|cost|talla|size|pesos?|currency)\b/i.test(text));
  });
}

export function isAlternativeProductRequest(userText = "") {
  const text = safeString(userText);
  if (!text) return false;
  return ALTERNATIVE_PRODUCT_PATTERNS.some((pattern) => pattern.test(text));
}

// Candidate identity keeps all hard catalogue constraints; uncertain labels
// and print/sleeve/edition facts are checked separately as match/unknown/mismatch.
export function buildProductCandidateConstraintIntent(intent = {}) {
  return { ...intent, requestedKeywords: [], requestedPrinting: "", requestedEdition: "",
    correctionSuggestion: null, customizationRequest: intent.requestedPrinting === "none" ? "" : intent.customizationRequest,
    requestedFeatures: (intent.requestedFeatures || []).filter(feature => !["short_sleeve", "long_sleeve", "sleeveless", "authentic", "fan_version"].includes(feature)) };
}

export function filterProductsByIntent(products = [], searchIntent = {}, { allowNearestAgeFallback = false } = {}) {
  const rows = Array.isArray(products) ? products.filter((item) => item?.name) : [];
  const excludeTeams = Array.isArray(searchIntent.excludeTeams) ? searchIntent.excludeTeams : [];
  const requestedTeam = safeString(searchIntent.requestedTeam);
  const requestedVariants = normalizeRequestedVariants(searchIntent);
  const requestedProductType = safeString(searchIntent.requestedProductType);
  const requestedAudience = safeString(searchIntent.requestedAudience);
  const requestedColor = safeString(searchIntent.requestedColor);
  const requestedSeason = safeString(searchIntent.requestedSeason);
  const requestedFeatures = normalizeRequestedFeatures(searchIntent);
  let candidates = rows.filter((product) => !excludeTeams.some((team) => productMatchesTeam(product, team)));

  if (requestedTeam) {
    candidates = candidates.filter((product) => productMatchesTeam(product, requestedTeam));
  }
  if (requestedVariants.length) {
    candidates = candidates.filter((product) => requestedVariants.some((variant) => productMatchesVariant(product, variant)));
  }
  if (requestedProductType) {
    candidates = candidates.filter((product) => productMatchesProductType(product, requestedProductType));
  }
  if (requestedAudience) {
    candidates = candidates.filter((product) => productMatchesAudience(product, requestedAudience));
  }
  if (safeString(searchIntent.requestedAgeRange)) {
    const exactAgeMatches = candidates.filter((product) => productMatchesAgeRange(product, searchIntent.requestedAgeRange));
    candidates = exactAgeMatches.length || !allowNearestAgeFallback
      ? exactAgeMatches
      : attachNearestAgeFallback(candidates, searchIntent.requestedAgeRange);
  }
  if (requestedColor) {
    candidates = candidates.filter((product) => productMatchesColor(product, requestedColor));
  }
  if (requestedSeason) {
    candidates = candidates.filter((product) => productMatchesSeason(product, requestedSeason));
  }
  if (requestedFeatures.length) {
    candidates = candidates.filter((product) => requestedFeatures.filter((feature) => !["authentic", "fan_version", "short_sleeve", "long_sleeve", "sleeveless"].includes(feature)).every((feature) => productMatchesFeature(product, feature)));
  }
  candidates = candidates.filter((product) => evaluateProductAttributeMatch(product, searchIntent).status === "match");
  const edition = requestedProductEdition(searchIntent);
  const existingItemFacts = searchIntent.commerceRoute === "product_question" && searchIntent.cardAllowed === false;
  if (edition && !existingItemFacts) candidates = candidates.filter((product) => edition !== "conflict" && resolveCanonicalProductEdition(product) === edition);
  return candidates;
}

export function normalizeLooseText(value = "") {
  return safeString(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/ı/g, "i")
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function includesLoosePhrase(text = "", phrase = "") {
  const haystack = normalizeLooseText(text);
  const needle = normalizeLooseText(phrase);
  if (!haystack || !needle) return false;
  return new RegExp(`(?:^|\\s)${escapeRegExp(needle)}(?:\\s|$)`, "i").test(haystack);
}

function shouldLoadProductContext(userText = "", intent = {}) {
  const text = safeString(userText);
  if (!text) return false;
  if (intent.customizationRequest) return true;
  if (intent.explicitSizingProductSearch) return true;
  if (isAlternativeProductRequest(text)) return true;
  if (intent.requestedTeam && intent.requestedSeason) return true;
  if (intent.requestedTeam && hasProductAvailabilityPhrase(text)) return true;
  if (intent.requestedTeam && (intent.requestedVariant || intent.requestedProductType)) return true;
  if (intent.contextSource === "recent_product_context" && (intent.requestedVariant || intent.requestedProductType)) return true;
  if (intent.isCorrection && (intent.requestedTeam || intent.excludeTeams?.length)) return true;
  if (intent.contextSource === "recent_product_context" && intent.requestedTeam && hasPendingProductConstraints(intent)) return true;
  return PRODUCT_TRIGGER_PATTERNS.some((pattern) => pattern.test(text));
}

export function buildStructuredProductQuery({
  requestedTeam = "",
  requestedVariant = "",
  requestedVariants = [],
  requestedProductType = "",
  requestedColor = "",
  requestedFeatures = [],
  requestedKeywords = [],
  fallbackText = "",
} = {}) {
  const productQuery = buildProductQuery(fallbackText);
  const variants = Array.isArray(requestedVariants) && requestedVariants.length ? requestedVariants : (requestedVariant ? [requestedVariant] : []);
  // Shopify Admin title search treats multiple words as an exact title phrase. Use the canonical team
  // as the source query, then apply colour, type, audience and variant filters against the returned set.
  if (requestedTeam) return requestedTeam;
  const catalogueAnchors = normalizeRequestedKeywords(requestedKeywords);
  if (catalogueAnchors.length) return catalogueAnchors.join(" ");
  if (!requestedTeam && !variants.length && !requestedColor) return productQuery || requestedProductType || "";
  // Shopify title queries cannot match both "home" and "away" in a single title. Fetch the team shirt set,
  // then deterministically retain and rank the requested variants locally.
  const variantForQuery = variants.length === 1 ? variants[0] : "";
  const parts = [
    ...normalizeRequestedFeatures({ requestedFeatures }),
    variantForQuery,
    requestedColor,
    requestedProductType,
  ].filter(Boolean);
  if (parts.length) return parts.join(" ");
  return productQuery;
}

function extractRequestedTeam(text = "") {
  const value = normalizeLooseText(text);
  if (!value) return "";
  for (const [canonical, aliases] of TEAM_ALIASES) {
    if (aliases.some((alias) => includesLoosePhrase(value, alias))) return canonical;
  }
  return "";
}

function extractExcludedTeams(text = "") {
  const value = normalizeLooseText(text);
  if (!value) return [];
  const teams = [];
  for (const [canonical, aliases] of TEAM_ALIASES) {
    if (aliases.some((alias) => {
      const phrase = escapeRegExp(normalizeLooseText(alias));
      return new RegExp(`\\b(?:no|not|wrong|不是|不要|别要|不要是)\\s+${phrase}\\b|\\b${phrase}\\s+(?:no|not|wrong)\\b`, "i").test(value);
    })) {
      teams.push(canonical);
    }
  }
  return [...new Set(teams)];
}

function extractRequestedVariants(text = "") {
  const value = normalizeLooseText(text);
  const variants = [];
  if (hasPositiveRequirementPhrase(value, ["home", "de local", "主场"])) variants.push("home");
  if (hasPositiveRequirementPhrase(value, ["away", "segunda equipacion", "segunda camiseta", "客场"])) variants.push("away");
  if (hasPositiveRequirementPhrase(value, ["third", "3rd", "第三客场", "第三球衣", "第三款", "第三"])) variants.push("third");
  if (hasPositiveRequirementPhrase(value, ["retro", "复古", "经典"])) variants.push("retro");
  return variants;
}

function extractRequestedVariant(text = "") {
  return extractRequestedVariants(text)[0] || "";
}

function extractRequestedColor(text = "") {
  const value = normalizeLooseText(text);
  if (!value) return "";
  const matches = [];
  for (const [canonical, aliases] of COLOR_ALIASES) {
    for (const alias of aliases) {
      const normalizedAlias = normalizeLooseText(alias);
      if (!normalizedAlias || !includesLoosePhrase(value, normalizedAlias) || isNegatedRequirementPhrase(value, normalizedAlias)) continue;
      matches.push({ canonical, index: value.lastIndexOf(normalizedAlias) });
    }
  }
  return matches.sort((left, right) => right.index - left.index)[0]?.canonical || "";
}

function hasPositiveRequirementPhrase(value = "", aliases = []) {
  return aliases.some((alias) => {
    const normalizedAlias = normalizeLooseText(alias);
    return normalizedAlias
      && includesLoosePhrase(value, normalizedAlias)
      && !isNegatedRequirementPhrase(value, normalizedAlias);
  });
}

function isNegatedRequirementPhrase(value = "", phrase = "") {
  const normalizedValue = normalizeLooseText(value);
  const normalizedPhrase = normalizeLooseText(phrase);
  if (!normalizedValue || !normalizedPhrase) return false;
  return new RegExp(`(?:^|\\s)(?:no|not|without|不要|不是|别要)\\s+${escapeRegExp(normalizedPhrase)}(?:\\s|$)`, "i").test(normalizedValue);
}

function extractRequestedFeatures(text = "") {
  const value = normalizeLooseText(text);
  return PRODUCT_FEATURE_DEFINITIONS
    .filter((definition) => definition.aliases.some((alias) => (
      // An authenticity adjective is not an explicit player-edition request.
      alias !== "authentic" && includesLoosePhrase(value, alias) && !isNegatedRequirementPhrase(value, alias)
    )))
    .map((definition) => definition.id);
}

export function extractRequirementClearFields(text = "") {
  const value = normalizeLooseText(text);
  if (!value) return [];
  const fields = [];
  const negatedFeature = PRODUCT_FEATURE_DEFINITIONS.some((definition) => (
    definition.aliases.some((alias) => alias !== "authentic" && isNegatedRequirementPhrase(value, alias))
  ));
  if (negatedFeature || /\b(?:normal|plain|standard)\s+(?:shirt|jersey|kit)\b|普通款|普通球衣/.test(value)) {
    fields.push("requestedFeatures");
  }
  const negatedVariant = ["home", "away", "third", "retro", "主场", "客场", "第三", "复古"]
    .some((variant) => isNegatedRequirementPhrase(value, variant));
  if (negatedVariant && !extractRequestedVariants(value).length) fields.push("requestedVariants");
  const negatedColor = COLOR_ALIASES.some(([, aliases]) => aliases.some((alias) => isNegatedRequirementPhrase(value, alias)));
  if (negatedColor && !extractRequestedColor(value)) fields.push("requestedColor");
  const rejectsCustomization = (
    /(?:^|\s)(?:no|not|without)\s+(?:customi[sz](?:e|ed|ing|ation)?|personali[sz](?:e|ed|ing|ation)?|printing?|printed|nameset)(?:\s|$)/i.test(value)
    || /\b(?:plain|standard)\s+(?:shirt|jersey|kit)\b/i.test(value)
    || /(?:不要|不需要|不用|没有)(?:定制|印字|印号|印刷)/.test(value)
  );
  const rejectsPrintNumber = (
    rejectsCustomization
    || /(?:^|\s)(?:no|not|without)\s+(?:shirt\s+)?(?:number|no)(?:\s|$)/i.test(value)
    || /(?:不要|不需要|不用|没有)(?:号码|号数|印号)/.test(value)
  );
  if (rejectsCustomization) fields.push("customizationRequest");
  if (rejectsPrintNumber) fields.push("requestedPrintNumber");
  return [...new Set(fields)];
}

function extractRequestedSeason(text = "", { requestedTeam = "" } = {}) {
  const value = safeString(text).toLowerCase();
  if (!value) return "";
  const pair = value.match(/\b(\d{4}|\d{2})\s*(?:\/|[-–—~～]|to|and|\s)\s*(\d{4}|\d{2})\b/i);
  if (pair) {
    const start = normalizeSeasonYear(pair[1]);
    const end = normalizeSeasonYear(pair[2], start);
    if (start && end > start && end <= start + 2) return `${start}/${String(end).slice(-2)}`;
  }
  const hasTeam = Boolean(safeString(requestedTeam) || extractRequestedTeam(value));
  if (!hasTeam || isCompetitionYearRequest(value) || isSizeRequest(value) || /#\s*\d{1,3}\b/.test(value)) return "";
  const currentSeason = currentFootballSeason();
  const shortYears = [String(currentSeason.startYear), String(currentSeason.endYear), String(currentSeason.startYear).slice(-2), String(currentSeason.endYear).slice(-2)];
  if (shortYears.some((year) => new RegExp(`\\b${year}\\b`).test(value))) return currentSeason.value;
  // Preserve current-season inference; only recover otherwise lost historical years.
  const historicalYear = value.match(/\b((?:19|20)\d{2})\b/);
  if (historicalYear && Number(historicalYear[1]) < currentSeason.startYear) return historicalYear[1];
  return "";
}

function extractRequestedKeywords(text = "", {
  requestedTeam = "",
  requestedVariants = [],
  requestedColor = "",
  requestedSeason = "",
  requestedFeatures = [],
  customizationRequest = "",
  requestedSizes = [],
} = {}) {
  // A requested back name or shirt number identifies a customization request,
  // not an already printed product title. Keep those free-form values out of
  // the catalogue ranking query so they cannot pull an unrelated player shirt.
  if (customizationRequest) return [];
  const ignored = new Set([
    ...teamAliasesFor(requestedTeam).flatMap((alias) => [alias, ...alias.split(" ")]),
    ...PRODUCT_FEATURE_DEFINITIONS.flatMap(({ id, aliases }) => [
      id,
      ...aliases.flatMap((alias) => {
        const normalizedAlias = normalizeLooseText(alias);
        return [normalizedAlias, ...normalizedAlias.split(" ")];
      }),
    ]),
    ...COLOR_ALIASES.flatMap(([canonical, aliases]) => [
      canonical,
      ...aliases.flatMap((alias) => normalizeLooseText(alias).split(" ")),
    ]),
    ...AUDIENCE_ALIASES.flatMap(([canonical, aliases]) => [
      canonical,
      ...aliases.flatMap((alias) => normalizeLooseText(alias).split(" ")),
    ]),
    "home", "away", "third", "3rd", "retro", "主场", "客场", "第三", "复古",
    ...(hasPositiveRequirementPhrase(normalizeLooseText(text), ["de local"]) ? ["local"] : []),
    ...normalizeRequestedVariants({ requestedVariants }),
    safeString(requestedColor).toLowerCase(),
    ...normalizeRequestedFeatures({ requestedFeatures }),
    ...safeString(requestedSeason).split(/[^0-9]+/),
    ...normalizeRequestedSizes(requestedSizes),
    "size", "sizing", "fit", "fitting", "beden", "olcu", "kalip", "meret", "talla", "taille",
    "cm", "kg", "lb", "lbs", "boy", "kilo", "magassag", "testsuly", "altura", "peso", "poids",
    "would", "could", "should", "ok", "okay", "fit", "fitting", "usual", "normally",
  ].filter(Boolean));
  return [...new Set(buildProductQuery(text)
    .split(/\s+/)
    .map((token) => safeString(token).toLowerCase())
    .filter((token) => token.length >= 3)
    .filter((token) => !isSizingMeasurementToken(token))
    .filter((token) => !ignored.has(token)))].slice(0, 6);
}

export function extractRequestedSizes(text = "") {
  const raw = safeString(text);
  if (!raw) return [];
  const hasSizingCue = SIZE_PATTERNS.some((pattern) => pattern.test(raw));
  const sizes = [];
  const add = (value) => {
    const normalized = normalizeRequestedSize(value);
    if (normalized && !sizes.includes(normalized)) sizes.push(normalized);
  };
  // Numeric child sizes require an explicit size cue; a shirt number, year,
  // age, height or weight alone never becomes a catalogue size.
  const childSizePattern = new RegExp(`(?:\\b(?:size|talla|beden|méret|meret)\\b|尺码|尺寸)\\s*[:#-]?\\s*(${CHILD_PRODUCT_SIZE_LABELS.join('|')})(?![\\p{L}\\p{N}])`, 'giu');
  for (const match of raw.matchAll(childSizePattern)) add(match[1]);
  const standalonePattern = /(?<![\p{L}\p{N}])(?:5XL|4XL|3XL|2XL|XXL|XL|XXS|XS|S|M|L)(?![\p{L}\p{N}])/giu;
  for (const match of raw.matchAll(standalonePattern)) {
    const value = String(match[0] || "");
    if (hasSizingCue || value.length > 1 || value === value.toUpperCase()) add(value);
  }
  if (hasSizingCue || /\b(?:XS|S|M|L|XL|XXL|2XL|3XL|4XL|5XL){2,}\b/.test(raw)) {
    for (const match of raw.matchAll(/\b(?:5XL|4XL|3XL|2XL|XXL|XL|XXS|XS|S|M|L){2,}\b/giu)) {
      let remaining = String(match[0] || "").toUpperCase();
      for (const label of STANDARD_SIZE_LABELS) {
        while (remaining.startsWith(label)) {
          add(label);
          remaining = remaining.slice(label.length);
        }
      }
    }
  }
  return sizes.slice(0, 8);
}

export function extractRequestedSizeProfile(text = "") {
  const value = normalizeLooseText(text);
  if (!value) return "";
  for (const [profile, aliases] of SIZE_PROFILE_ALIASES) {
    if (aliases.some((alias) => includesLoosePhrase(value, alias))) return profile;
  }
  return "";
}

export function filterProductsByRequestedSizes(products = [], requestedSizes = []) {
  const requested = normalizeRequestedSizes(requestedSizes);
  const rows = Array.isArray(products) ? products.filter((product) => product?.name) : [];
  if (!requested.length) return rows;
  return rows.filter((product) => {
    if (product.available === false) return false;
    const sizes = Array.isArray(product.sizes) ? product.sizes : [];
    return sizes.some((size) => {
      if (size && typeof size === "object" && size.available === false) return false;
      const label = typeof size === "object" ? size.label : size;
      return requested.some((requestedSize) => productSizeLabelIncludes(label, requestedSize));
    });
  });
}

export function isExplicitProductSizingSearch(searchIntent = {}) {
  // `intent` drives ranking and response tone and may legitimately be `budget`
  // or `popular`. The explicit anchor flag is the only safe decision boundary
  // for the sellable-size filter.
  return searchIntent?.explicitSizingProductSearch === true;
}

function normalizeRequestedSizes(values = []) {
  const rows = Array.isArray(values) ? values : [values];
  return [...new Set(rows.map(normalizeRequestedSize).filter(Boolean))];
}

function normalizeRequestedSize(value = "") {
  const normalized = safeString(value).toUpperCase().replace(/\s+/g, "");
  if (normalized === "XXL") return "2XL";
  if (normalized === "XXS") return "XXS";
  return STANDARD_SIZE_LABELS.includes(normalized) || CHILD_PRODUCT_SIZE_LABELS.includes(normalized) ? normalized : "";
}

function productSizeLabelIncludes(value = "", requestedSize = "") {
  const label = safeString(value).toUpperCase().replace(/XXL/g, "2XL");
  const needle = escapeRegExp(normalizeRequestedSize(requestedSize));
  return Boolean(needle) && new RegExp(`(?:^|[^A-Z0-9])${needle}(?=$|[^A-Z0-9])`, "i").test(label);
}

function isSizingMeasurementToken(token = "") {
  const value = safeString(token).toLowerCase();
  return /^(?:\d{1,3}(?:cm|kg|lb|lbs|ft|feet)|\d{2,3}|[0-9]+x{1,4}l)$/.test(value)
    || /^(?:5xl|4xl|3xl|2xl|xxl|xl|xxs|xs|s|m|l){2,}$/.test(value)
    || normalizeRequestedSize(value) !== "";
}

// Shared canonical garment vocabulary: query parsing and catalogue filtering
// must agree without depending on the team or the conversation language.
const EXPLICIT_SHIRT_GARMENT_PATTERN = /\b(?:shirts?|jerseys?|trikot|fussballtrikot|fußballtrikot|voetbalshirt|camisetas?|mez|mezek)\b|球衣|队服/;
const SHIRT_GARMENT_PATTERN = new RegExp(`${EXPLICIT_SHIRT_GARMENT_PATTERN.source}|\\b(?:kits?|strips?|equipacion(?:es)?)\\b`);
const NON_SHIRT_GARMENT_PATTERN = /\b(?:shorts?|pants|trousers|jacket|windbreaker|socks?|nadrag|rovidnadrag|zokni|kabat)\b|短裤|长裤|夹克/;

function extractRequestedProductType(text = "") {
  const value = normalizeLooseText(text);
  if (SHIRT_GARMENT_PATTERN.test(value)) return "shirt";
  if (/\b(?:training top|top|tee|t-shirt)\b|训练服|短袖|上衣/.test(value)) return "top";
  if (/\bmerch(?:andise)?\b|周边/.test(value)) return "merch";
  return "";
}

function extractRequestedAudience(text = "") {
  const value = normalizeLooseText(text);
  if (!value) return "";
  for (const [canonical, aliases] of AUDIENCE_ALIASES) {
    if (aliases.some((alias) => matchesAudienceAlias(value, alias))) return canonical;
  }
  return "";
}

function matchesAudienceAlias(text, alias) {
  return /[\u4e00-\u9fff]/.test(alias) ? normalizeLooseText(text).includes(alias) : includesLoosePhrase(text, alias);
}

function extractRequestedAgeRange(text = "") {
  const value = safeString(text);
  const monthRange = value.match(/\b(\d{1,2})\s*(?:months?|mos?)?\s*(?:to|[-–—])\s*(\d{1,2})\s*(?:months?|mos?)\b/i);
  if (monthRange) return `${Number(monthRange[1])}-${Number(monthRange[2])} months`;
  const yearRange = value.match(/\b(\d{1,2})\s*(?:years?|yrs?)?\s*(?:to|[-–—])\s*(\d{1,2})\s*(?:years?|yrs?)\b/i);
  if (yearRange) return `${Number(yearRange[1])}-${Number(yearRange[2])} years`;
  const singleYear = value.match(/\b(?:aged?\s*)?(\d{1,2})\s*(?:years?|yrs?)\s*(?:old)?\b/i) || value.match(/(\d{1,2})\s*岁/);
  return singleYear ? `${Number(singleYear[1])} year` : "";
}

function resolveCustomizationRequest(text = "") {
  const value = normalizeLooseText(text);
  if (!value) return "";
  if (extractRequestedPrinting(text) === "none") return "";
  const jerseyReference = /\b(?:jersey|shirt|kit|kits|strip|strips|nameset|player|name|number|back|patch(?:es)?)\b|(?:球衣|队服|印号|印字|姓名|号码|臂章|徽章)/i.test(value);
  const printNumber = extractRequestedPrintNumber(text);
  const customization = /\b(?:customi[sz](?:e|ed|ing|ation)?|personali[sz](?:e|ed|ing|ation)?|nameset|print(?:ed|ing)?)\b|(?:定制|印号|印字|姓名|号码|臂章|徽章)/i.test(value) || Boolean(printNumber && jerseyReference);
  const nameAndNumber = /\b(?:player\s+)?name\b.*\b(?:number|no)\b|\b(?:number|no)\b.*\b(?:player\s+)?name\b/i.test(value);
  if (!customization && !nameAndNumber) return "";
  return jerseyReference ? "jersey" : "ambiguous";
}

function extractRequestedPrintNumber(text = "", { customizationRequest = "" } = {}) {
  const value = safeString(text);
  const explicit = value.match(/(?:\b(?:number|no\.?|shirt\s*number)\s*#?\s*|#\s*)(\d{1,3})\b/i) || value.match(/(\d{1,3})\s*号/);
  if (!explicit) return "";
  const hasJerseyReference = /\b(?:jersey|shirt|kit|kits|strip|strips|back|print(?:ed|ing)?|name|number|nameset)\b|(?:球衣|队服|背后|印号|印字|号码)/i.test(value);
  return customizationRequest === "jersey" || hasJerseyReference ? String(Number(explicit[1])) : "";
}

function hasPendingProductConstraints(context = null) {
  return Boolean(
    safeString(context?.requestedAudience)
    || safeString(context?.requestedAgeRange)
    || safeString(context?.requestedSizeProfile)
    || safeString(context?.requestedProductType)
    || safeString(context?.requestedColor)
    || safeString(context?.requestedSeason)
    || safeString(context?.customizationRequest)
    || safeString(context?.requestedPrintNumber)
    || normalizeRequestedVariants(context).length
    || normalizeRequestedFeatures(context).length
    || normalizeRequestedKeywords(context?.requestedKeywords).length
  );
}

function isProductContextFollowup(text = "") {
  const value = normalizeLooseText(text);
  if (!value) return false;
  return Boolean(
    extractRequestedVariant(value)
    || extractRequestedProductType(value)
    || extractRequestedColor(value)
    || extractRequestedFeatures(value).length
    || extractRequestedAudience(value)
    || extractRequestedAgeRange(value)
    || extractRequestedSizeProfile(value)
    || resolveCustomizationRequest(value)
    || extractRequestedSeason(value, { requestedTeam: extractRequestedTeam(value) })
    || extractRequirementClearFields(value).length
    || SIZE_PATTERNS.some((pattern) => pattern.test(value))
  );
}

function isSelfContainedCatalogueRequest(text = "", requirement = {}) {
  if (!requirementCatalogueAnchor(requirement)) return false;
  const namesProduct = Boolean(
    safeString(requirement.requestedProductType)
    || normalizeRequestedVariants(requirement).length
    || safeString(requirement.requestedAgeRange)
    || safeString(requirement.requestedSizeProfile)
    || safeString(requirement.requestedColor)
    || safeString(requirement.requestedSeason)
    || normalizeRequestedFeatures(requirement).length
    || safeString(requirement.customizationRequest)
    || safeString(requirement.requestedPrintNumber)
  );
  if (!namesProduct) return false;
  const value = normalizeLooseText(text);
  return hasProductAvailabilityPhrase(value)
    || isTeamCatalogRequest(value)
    || /\b(?:shirt|shirts|jersey|jerseys|kit|kits|strip|strips|top|tee|t-shirt)\b|球衣|队服|训练服|上衣/.test(value);
}

function isTeamCatalogRequest(text = "") {
  const value = normalizeLooseText(text);
  if (!value) return false;
  if (/\b(?:game|match|fixture|kickoff|score|result|table|standings?)\b|比赛|赛程|比分|积分/.test(value)) return false;
  return /\b(?:club|team|football club|do you do|show me|find me)\b|俱乐部|球队/.test(value);
}

function hasProductAvailabilityPhrase(text = "") {
  const value = normalizeLooseText(text);
  return /\b(?:do you have|have you got|you got|got|sell|stock|available|looking for|want|need|can i get|any)\b|有没有|有卖|有货|想要|我要|买/.test(value);
}

function isCorrectionText(text = "") {
  const value = normalizeLooseText(text);
  return /\b(?:no|not|wrong|actually|instead|i want|i said|i mean|i meant)\b|不是|不要|错了|我要/.test(value);
}

function isGenericProductRecommendationRequest(text = "") {
  const value = normalizeLooseText(text);
  if (!value) return false;
  return /\b(?:recommend|suggest|pick|choose)\b.{0,30}\b(?:product|shirt|jersey|kit)\b|\b(?:product|shirt|jersey|kit)\b.{0,30}\b(?:recommendation|suggestion)\b|推荐.{0,12}(?:商品|产品|球衣|队服)/i.test(value);
}

function requirementCatalogueAnchor(requirement = null) {
  if (!requirement || typeof requirement !== "object") return "";
  const team = normalizeLooseText(requirement.requestedTeam);
  if (team) return `team:${team}`;
  const keywords = normalizeRequestedKeywords(requirement.requestedKeywords);
  return keywords.length ? `keywords:${keywords.join(" ")}` : "";
}

function detectProductIntent(text, { requestedSizes = [], hasBodyMeasurements = false } = {}) {
  if (POPULAR_PATTERNS.some((pattern) => pattern.test(text))) return "popular";
  if (BUDGET_PATTERNS.some((pattern) => pattern.test(text))) return "budget";
  if (SIZE_PATTERNS.some((pattern) => pattern.test(text)) || requestedSizes.length || hasBodyMeasurements) return "sizing";
  if (STOCK_PATTERNS.some((pattern) => pattern.test(text))) return "stock";
  return "recommendation";
}

function buildProductQuery(text) {
  const normalized = safeString(text)
    .replace(/^(?:hi|hello|hey|good\s+(?:morning|afternoon|evening))\s+[a-z][a-z0-9_-]{1,32}[,，!！.]?\s*/i, "")
    .replace(/(?:有没有|有什么|可以|能不能|请问|麻烦|帮我|给我|看看|看下|寻找|查找|推荐吗?|想要|需要|一件|一个|商品|产品|球衣|队服|衣服|购买|价格|多少钱|便宜|折扣|优惠|尺码)/g, " ")
    .replace(/[?？!！,，.。;；:：()（）[\]【】"'“”‘’]/g, " ");
  const tokens = normalized.match(/[\p{Script=Han}]{2,}|[a-z0-9][a-z0-9-]{1,}/giu) || [];
  const keywords = tokens
    .map((token) => token.toLowerCase())
    .filter((token) => !PRODUCT_STOP_WORDS.has(token))
    .filter((token) => {
      const normalized = normalizeLooseText(token);
      return SHIRT_GARMENT_PATTERN.exec(normalized)?.[0] !== normalized;
    })
    .filter((token) => !/^(?:19|20)\d{2}$/.test(token))
    .filter((token) => !/^\d{2}$/.test(token))
    .filter((token) => !/^\d{2,4}-\d{2,4}$/.test(token))
    .slice(0, 8);
  return keywords.join(" ");
}

function productMatchesTeam(product = {}, team = "") {
  const normalizedTeam = normalizeTeamName(team);
  if (!normalizedTeam) return false;
  const text = productSearchText(product);
  const aliases = teamAliasesFor(normalizedTeam);
  return aliases.some((alias) => includesLoosePhrase(text, alias));
}

export function productMatchesVariant(product = {}, variant = "") {
  const normalizedVariant = safeString(variant).toLowerCase();
  if (!normalizedVariant) return false;
  return productSearchFields(product).some(value => {
    // A third-away designation names the third kit, not a second away kit.
    // Keep independent source fields and explicit option separators intact.
    const text = normalizedVariant === "away" ? safeString(value)
      .replace(/(?<![\p{L}\p{N}])(?:third|3rd)[\s_\p{Pd}]+away(?![\p{L}\p{N}])/giu, "third") : value;
    return includesLoosePhrase(text, normalizedVariant)
      || normalizedVariant === "third" && includesLoosePhrase(text, "3rd");
  });
}

// Narrow evidence gate for automatic alternatives; ordinary catalogue matching stays unchanged.
export function hasExplicitProductTypeEvidence(product = {}, productType = "") {
  if (productType !== "shirt") return productMatchesProductType(product, productType);
  const title = normalizeLooseText([product.name, product.title].filter(Boolean).join(" "));
  return EXPLICIT_SHIRT_GARMENT_PATTERN.test(title) && !NON_SHIRT_GARMENT_PATTERN.test(title)
    && !/\b(?:sets?|conjunto|miniconjunto|complete kit|full kit)\b|套装|整套|全套/.test(title);
}

function productMatchesProductType(product = {}, productType = "") {
  const normalizedType = safeString(productType).toLowerCase();
  if (!normalizedType) return false;
  const text = productSearchText(product);
  if (normalizedType === "shirt") {
    const title = normalizeLooseText([product.name, product.title, product.subtitle].filter(Boolean).join(" "));
    const isNonShirtGarment = NON_SHIRT_GARMENT_PATTERN.test(title);
    const isExplicitShirt = EXPLICIT_SHIRT_GARMENT_PATTERN.test(title);
    if (isNonShirtGarment && !isExplicitShirt) return false;
    return SHIRT_GARMENT_PATTERN.test(text);
  }
  if (normalizedType === "top") return /\b(?:top|tee|t shirt|training)\b|短袖|上衣|训练服/.test(text);
  if (normalizedType === "merch") return /\bmerch(?:andise)?\b|周边/.test(text);
  return includesLoosePhrase(text, normalizedType);
}

function productMatchesColor(product = {}, color = "") {
  const normalizedColor = safeString(color).toLowerCase();
  if (!normalizedColor) return false;
  const aliases = COLOR_ALIASES.find(([canonical]) => canonical === normalizedColor)?.[1] || [normalizedColor];
  const text = productSearchText(product);
  return aliases.some((alias) => includesLoosePhrase(text, alias));
}

function productMatchesFeature(product = {}, feature = "") {
  const normalizedFeature = safeString(feature).toLowerCase();
  const text = productSearchText(product);
  const definition = PRODUCT_FEATURE_DEFINITIONS.find((item) => item.id === normalizedFeature);
  const aliases = definition?.aliases || [normalizedFeature.replace(/_/g, " ")];
  return aliases.some((alias) => includesLoosePhrase(text, alias));
}

function productMatchesAudience(product = {}, audience = "") {
  const normalizedAudience = safeString(audience).toLowerCase();
  if (!normalizedAudience) return false;
  const text = productSearchText(product);
  if (normalizedAudience === "adult") {
    return !productMatchesAudience(product, "kids")
      && !productMatchesAudience(product, "women")
      && !/\b(?:women|womens|female|ladies|girl|girls)\b|女款|女装|女士/i.test(text);
  }
  if (normalizedAudience === "kids") {
    return AUDIENCE_ALIASES.find(([audience]) => audience === 'kids')[1].some(alias => matchesAudienceAlias(text, alias))
      || /\b(?:years?|age)\b/i.test(text);
  }
  if (normalizedAudience === "women") {
    return !productMatchesAudience(product, 'kids') && /\b(?:women|womens|female|ladies)\b|女款|女装|女士/i.test(text);
  }
  return includesLoosePhrase(text, normalizedAudience);
}

function productMatchesAgeRange(product = {}, requestedAgeRange = "") {
  const normalizedRequest = normalizeAgeRange(requestedAgeRange);
  if (!normalizedRequest) return false;
  const sizes = Array.isArray(product.sizes) ? product.sizes : [];
  if (sizes.some((size) => normalizeAgeRange(size?.label || size?.name || "") === normalizedRequest)) return true;
  const requirement = resolveLocalProductAgeRangeRequirement(product, normalizedRequest);
  if (!requirement?.sizeLabel) return false;
  return sizes.some((size) => size?.available !== false && matchesProductSizeLabel(size?.label || size?.name || "", requirement.sizeLabel));
}

function attachNearestAgeFallback(products = [], requestedAgeRange = "") {
  return products.map((product) => {
    const requirement = resolveNearestLocalProductAgeRequirement(product, requestedAgeRange);
    return requirement ? { ...product, ageSizeFallback: requirement } : null;
  }).filter(Boolean);
}

function matchesProductSizeLabel(value = "", expectedLabel = "") {
  const actual = safeString(value).replace(/\s+/g, " ");
  const expected = safeString(expectedLabel).replace(/\s+/g, " ");
  if (!actual || !expected) return false;
  return new RegExp(`(?:^|\\s)${escapeRegExp(expected)}(?:\\s|$)`, "i").test(actual);
}

function isUserAuthoredMessage(message = {}) {
  const senderType = safeString(message.senderType || message.sender_type).toLowerCase();
  return !senderType || senderType === "user";
}

function mergeRecentProductContext(target = {}, source = {}, clearedFields = new Set()) {
  for (const field of Array.isArray(source.clearFields) ? source.clearFields : []) {
    clearedFields.add(field);
    if (field === "requestedVariants") {
      target.requestedVariants = [];
      target.requestedVariant = "";
    } else if (field === "requestedFeatures") {
      target.requestedFeatures = [];
    } else if (field === "requestedKeywords") {
      target.requestedKeywords = [];
    } else {
      target[field] = "";
    }
  }
  for (const field of [
    "requestedTeam",
    "requestedVariant",
    "requestedProductType",
    "requestedAudience",
    "requestedAgeRange",
    "requestedSizeProfile",
    "requestedColor",
    "requestedSeason",
    "customizationRequest",
    "requestedPrintNumber",
    "requestedPrinting",
  ]) {
    if (!clearedFields.has(field) && !safeString(target[field]) && safeString(source[field])) target[field] = source[field];
  }
  if (!target.correctionSuggestion && source.correctionSuggestion && typeof source.correctionSuggestion === "object") {
    target.correctionSuggestion = source.correctionSuggestion;
  }
  if (!clearedFields.has("requestedVariants") && (!Array.isArray(target.requestedVariants) || !target.requestedVariants.length)) {
    const variants = normalizeRequestedVariants(source);
    if (variants.length) {
      target.requestedVariants = variants;
      target.requestedVariant = variants[0] || "";
    }
  }
  if (!clearedFields.has("requestedFeatures") && (!Array.isArray(target.requestedFeatures) || !target.requestedFeatures.length)) {
    const features = normalizeRequestedFeatures(source);
    if (features.length) target.requestedFeatures = features;
  }
  if (!clearedFields.has("requestedKeywords") && !Array.isArray(target.requestedKeywords) && Array.isArray(source.requestedKeywords) && source.requestedKeywords.length) {
    target.requestedKeywords = source.requestedKeywords;
  }
  target.clearFields = [...clearedFields];
}

function normalizeAgeRange(value = "") {
  const text = safeString(value);
  const match = text.match(/\b(\d{1,2})\s*(?:months?|mos?)?\s*(?:to|[-–—])\s*(\d{1,2})\s*(?:months?|mos?)\b/i);
  if (match) return `${Number(match[1])}-${Number(match[2])} months`;
  const yearRange = text.match(/\b(\d{1,2})\s*(?:years?|yrs?)?\s*(?:to|[-–—])\s*(\d{1,2})\s*(?:years?|yrs?)\b/i);
  if (yearRange) return `${Number(yearRange[1])}-${Number(yearRange[2])} years`;
  const singleYear = text.match(/^\s*(\d{1,2})\s*(?:years?|yrs?)\s*$/i);
  return singleYear ? `${Number(singleYear[1])} year` : "";
}

function productMatchesSeason(product = {}, requestedSeason = "") {
  if (/^(?:19|20)\d{2}$/.test(safeString(requestedSeason))) {
    const year = Number(requestedSeason);
    return productMatchesSeason(product, `${year - 1}/${String(year).slice(-2)}`)
      || productMatchesSeason(product, `${year}/${String(year + 1).slice(-2)}`)
      || new RegExp(`\\b${year}\\b`).test(productSearchText(product));
  }
  const match = safeString(requestedSeason).match(/^(\d{4})\/(\d{2})$/);
  if (!match) return false;
  const text = productSearchText(product);
  const start = match[1];
  const end = `${start.slice(0, 2)}${match[2]}`;
  return includesLoosePhrase(text, `${start} ${match[2]}`)
    || includesLoosePhrase(text, `${start} ${end}`);
}

function productSearchText(product = {}) {
  return normalizeLooseText(productSearchFields(product).join(" "));
}

function productSearchFields(product = {}) {
  return [
    product.name,
    product.subtitle,
    product.summary,
    product.tag,
    product.type,
    product.category,
    ...(Array.isArray(product.sizes) ? product.sizes.map((size) => size?.label || size?.name || "") : []),
    ...(Array.isArray(product.features) ? product.features : []),
  ].filter(Boolean);
}

function normalizeStoredProductIntent(value = null) {
  if (!value || typeof value !== "object") return null;
  const requestedTeam = safeString(value.requestedTeam);
  const requestedVariant = safeString(value.requestedVariant);
  const requestedVariants = normalizeRequestedVariants(value);
  const requestedProductType = safeString(value.requestedProductType);
  const requestedAudience = safeString(value.requestedAudience);
  const requestedAgeRange = safeString(value.requestedAgeRange);
  const requestedSizeProfile = safeString(value.requestedSizeProfile);
  const requestedColor = safeString(value.requestedColor);
  const requestedSeason = safeString(value.requestedSeason);
  const requestedFeatures = normalizeRequestedFeatures(value);
  const requestedKeywords = normalizeRequestedKeywords(value.requestedKeywords);
  const customizationRequest = safeString(value.customizationRequest);
  const requestedPrintNumber = safeString(value.requestedPrintNumber);
  const query = safeString(value.query);
  if (!query && !requestedTeam && !requestedVariant && !requestedVariants.length && !requestedProductType && !requestedAudience && !requestedAgeRange && !requestedSizeProfile && !requestedColor && !requestedSeason && !requestedFeatures.length) return null;
  return {
    query: query || [requestedTeam, requestedVariant, requestedColor, requestedProductType].filter(Boolean).join(" ") || "recommended",
    intent: safeString(value.intent) || "recommendation",
    requestedTeam,
    requestedVariant,
    requestedVariants,
    requestedProductType,
    requestedAudience,
    requestedAgeRange,
    requestedSizeProfile,
    requestedColor,
    requestedSeason,
    requestedFeatures,
    requestedKeywords,
    customizationRequest,
    requestedPrintNumber,
    searchState: safeString(value.searchState),
  };
}

function normalizeRequestedKeywords(value = []) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map((item) => safeString(item).toLowerCase())
    .filter((item) => item.length >= 3))].slice(0, 6);
}

function normalizeSeasonYear(value = "", previousYear = 0) {
  const text = safeString(value);
  if (/^\d{4}$/.test(text)) return Number(text);
  if (!/^\d{2}$/.test(text)) return 0;
  const shortYear = Number(text);
  if (previousYear) return Math.floor(previousYear / 100) * 100 + shortYear;
  return shortYear <= 50 ? 2000 + shortYear : 1900 + shortYear;
}

function currentFootballSeason(now = new Date()) {
  const year = now.getUTCFullYear();
  const startYear = now.getUTCMonth() >= 6 ? year : year - 1;
  const endYear = startYear + 1;
  return { startYear, endYear, value: `${startYear}/${String(endYear).slice(-2)}` };
}

function isCompetitionYearRequest(value = "") {
  return /\b(?:world cup|fifa|euro|uefa|olympic(?:s)?|champions league|ucl)\b/i.test(value);
}

function isSizeRequest(value = "") {
  return /\b(?:size|sizing|fit|fitting)\s*[:#-]?\s*\d{1,3}\b|尺码\s*\d{1,3}/i.test(value);
}

function normalizeRequestedVariants(intent = {}) {
  const values = Array.isArray(intent?.requestedVariants) ? intent.requestedVariants : [intent?.requestedVariant];
  return [...new Set(values.map((value) => safeString(value).toLowerCase()).filter(Boolean))];
}

function normalizeRequestedFeatures(intent = {}) {
  const values = Array.isArray(intent?.requestedFeatures) ? intent.requestedFeatures : [];
  return [...new Set(values.map((value) => safeString(value).toLowerCase()).filter(Boolean))];
}

function normalizeTeamName(team = "") {
  const normalized = normalizeLooseText(team);
  if (!normalized) return "";
  for (const [canonical, aliases] of TEAM_ALIASES) {
    if (normalizeLooseText(canonical) === normalized || aliases.some((alias) => normalizeLooseText(alias) === normalized)) return canonical;
  }
  return safeString(team);
}

function teamAliasesFor(team = "") {
  const normalizedTeam = normalizeTeamName(team);
  const row = TEAM_ALIASES.find(([canonical]) => canonical === normalizedTeam);
  return (row ? [row[0], ...row[1]] : [normalizedTeam]).map(normalizeLooseText).filter(Boolean);
}

function escapeRegExp(value = "") {
  return safeString(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function safeString(value) {
  return String(value == null ? "" : value).trim();
}
