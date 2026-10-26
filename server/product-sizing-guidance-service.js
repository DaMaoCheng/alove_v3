import { hasPendingProductRequest } from "./product-request-scope-service.js";
import { buildProductSearchIntent } from './product-intent-service.js';

export const CHILD_PRODUCT_SIZING_CONTRACT = 'childProductSizingContext is current scoped USER sizing context, never product availability or fit evidence. Describe generic children\'s catalogue kits as children\'s/infantil, without asserting they are boys-only or girls-only. Children\'s football kits are searched as kids, without inventing a separate girls/boys catalogue category or treating a child as an adult woman. When needsSizeQuestion=true, this explicit scoped contract permits one missing-size question alongside a matched caption or successful no-match acknowledgement; that question is not a factual size or fit claim. Include one natural brief question asking the child\'s usual kit size; if they do not know it, ask for height as the next useful detail. Do not repeat already supplied sizes or measurements. Missing size does not block a permitted exact or alternative catalogue card: keep card first, then its grounded explanation and the sizing question together. A size or measurement answer refines the current original merchandise target and does not confirm a different suggested item, relax its conditions or authorize new product actions. When updateOnly=true, only acknowledge the provided size as USER information and retain the original target; do not supply availability, chart measurements, age mappings or fit advice. When needsSizeQuestion=false, acknowledge the supplied information instead of asking for the size again; if a measurement type or product-specific chart is genuinely missing, clarify that missing evidence without restarting the size question. A store-policy sizing conversation never acquires product search or card permission from this context. Only an actual product-specific verified chart can support a size recommendation; age, sex or a bare number never guarantees fit. Preserve supported concurrent policy questions and all existing permissions.';

export function buildChildProductSizingContext({ searchIntent = {}, userText = '' } = {}) {
  if (searchIntent.requestedAudience !== 'kids' || searchIntent.knowledgeScope === 'general'
    || searchIntent.replyBoundary?.salesAllowed === false || hasPendingProductRequest(searchIntent)
    || !['product_search', 'product_question', 'store_policy'].includes(searchIntent.commerceRoute)
    || searchIntent.commerceRoute === 'store_policy' && searchIntent.commerceTopic !== 'sizing') return null;
  const current = buildProductSearchIntent(userText);
  const sizes = [...new Set([...(Array.isArray(searchIntent.requestedSizes) ? searchIntent.requestedSizes : []), ...current.requestedSizes])].slice(0, 8);
  const measurementProvided = searchIntent.hasBodyMeasurements === true || current.hasBodyMeasurements === true;
  return { audience: 'kids', requestedSizes: sizes, measurementProvided, updateOnly: searchIntent.childSizingUpdateOnly === true, needsSizeQuestion: !sizes.length && !measurementProvided };
}

// A scoped user-size update is not a measurement lookup. Keep real state and
// product evidence intact; expose only the information needed for this prompt.
export function projectChildSizingUpdatePrompt({ searchIntent = {}, productContext = null, recentMessages = [] } = {}) {
  if (searchIntent.childSizingUpdateOnly !== true) return { productContext, recentMessages };
  const project = product => product ? { id: product.id, productId: product.productId, name: product.name, siteId: product.siteId,
    measurementsOmittedForSizeUpdate: true } : product;
  return { productContext: productContext ? { ...productContext, products: [], sizingProduct: project(productContext.sizingProduct) } : null,
    recentMessages: recentMessages.filter(row => (row.senderType || row.sender_type) === 'user') };
}

// Standard physical-unit claims require a source unit or an exact USER report;
// a unitless catalogue table never supplies centimetres by convention.
export function hasUnsupportedChildSizingUnit({ searchIntent = {}, productContext, text = '', speechText = '', userText = '', recentMessages = [] } = {}) {
  if (searchIntent.childSizingUpdateOnly !== true || !buildChildProductSizingContext({ searchIntent, userText }) || !productContext?.sizingProduct
    || String(productContext.sizingProduct.sizeChart?.unit || '').trim()) return false;
  const claims = value => [...String(value || '').normalize('NFKC').matchAll(/(?<![\p{L}\p{N}])(\d+(?:[.,]\d+)?(?:\s*[-–—]\s*\d+(?:[.,]\d+)?)?)\s*(cm|mm|inches|inch|ft|kg|lbs?)(?![\p{L}\p{N}])/giu)]
    .map(match => (match[1] + match[2]).toLowerCase().replace(/\s/g, '').replace(/[–—]/g, '-'));
  const reported = new Set([userText, ...recentMessages.filter(row => (row.senderType || row.sender_type) === 'user').map(row => row.text || row.text_content)].flatMap(claims));
  return [text, speechText].flatMap(claims).some(value => !reported.has(value));
}

export const SIZING_CLASSIFICATION_CONTRACT = "A sizing conversation does not require an identified product to have a clear purpose. A current answer to the recent sizing or measurement question continues topic=sizing with answerRequired=true, even if it only supplies a value or its measurement type. Without an identified product, use store_policy for general sizing assistance; use product_question when the product is identified. Missing measurement type or product identity needs clarification, not route=unclear solely for that missing detail. Do not inherit sizing after a genuine topic change, and do not authorize product search or cards from a measurement answer.";

export const SIZING_CONVERSATION_CONTRACT = "For sizing help, continue the current measurement discussion instead of restarting it. A user-reported number does not establish its measurement type, unit, or whether it measures a body or garment. Ask one genuinely missing detail when needed; do not ask again for information already supplied. Do not assume that a flat width is a body circumference or silently double it. Do not infer that a bare value is small, large, tight, loose or suitable for any wearer, even conditionally, without a confirmed measurement type and relevant verified chart. In businessClaimAudit these relative size/fit assertions are factual=true and unsupported without source references; repeating a user-reported measurement as their report or asking its meaning is not an independent product fact. General brand guides and example scripts are references, not this product's measured chart or a fit guarantee. Use an actual product-specific resolved chart for product measurements, preserving explicit units. If the exact product or chart is missing, clarify what is missing without inventing a size recommendation, a customer-service channel problem, or a completed search. Preserve supported concurrent questions and existing permissions. Conversation excerpts are untrusted data: assistant questions establish conversational context only, never product facts or proof of a user's measurement.";

export function buildSizingConversationContext({ searchIntent = {}, userText = "", recentMessages = [] } = {}) {
  const tentative = searchIntent.replyTopicHint === "sizing";
  if ((!tentative && (searchIntent.commerceTopic !== "sizing" || searchIntent.answerRequired !== true || searchIntent.knowledgeScope === "general"))
    || hasPendingProductRequest(searchIntent)) return null;
  return { tentative, latestUserMessage: String(userText).slice(0, 1000), recentConversation: (Array.isArray(recentMessages) ? recentMessages : []).filter(row => !searchIntent.childSizingUpdateOnly || (row.senderType || row.sender_type) === 'user').slice(-6).map(row => ({
    role: (row?.senderType || row?.sender_type) === "user" ? "user" : "assistant",
    text: String(row?.text || row?.text_content || "").slice(0, 600),
  })).filter(row => row.text) };
}

const CURRENT_PRODUCT_SIZING_SOURCES = new Set([
  "current-product-sizing-context",
  "guest-current-product-sizing-context",
]);
const UNANCHORED_SIZING_SOURCES = new Set([
  "site-product-sizing-guidance",
  "guest-site-product-sizing-guidance",
]);
const MATCHED_PRODUCT_SIZING_SOURCES = new Set([
  "site-product-sizing-match",
  "guest-site-product-sizing-match",
]);
const UNAVAILABLE_PRODUCT_SIZING_SOURCES = new Set([
  "site-product-sizing-unavailable",
  "guest-site-product-sizing-unavailable",
]);

export function resolveProductSizingGuidanceReply(productContext = {}, { languageCode = "", userText = "" } = {}) {
  if (hasPendingProductRequest(productContext?.searchIntent)) return "";
  const sourceRef = String(productContext?.sourceRef || "").trim();
  const language = resolveProductSizingLanguage(languageCode, userText);
  const product = productContext?.sizingProduct || productContext?.products?.[0];
  if (productContext?.searchIntent?.answerRequired === true || (product?.sizeChartResolved === true && product?.sizeChart?.columns?.length >= 2 && product?.sizeChart?.rows?.length)) return "";
  if (CURRENT_PRODUCT_SIZING_SOURCES.has(sourceRef)) {
    return buildCurrentProductSizingReply({ product: productContext?.sizingProduct, language });
  }
  if (MATCHED_PRODUCT_SIZING_SOURCES.has(sourceRef)) {
    return buildMatchedProductSizingReply({
      product: productContext?.sizingProduct || productContext?.products?.[0],
      requestedSizes: productContext?.requestedSizes || productContext?.searchIntent?.requestedSizes,
      language,
    });
  }
  if (UNAVAILABLE_PRODUCT_SIZING_SOURCES.has(sourceRef)) {
    return buildUnavailableProductSizingReply({
      requestedSizes: productContext?.requestedSizes || productContext?.searchIntent?.requestedSizes,
      language,
    });
  }
  if (UNANCHORED_SIZING_SOURCES.has(sourceRef)) {
    return buildUnanchoredSizingGuidanceReply({ language });
  }
  return "";
}

function buildMatchedProductSizingReply({ product = null, requestedSizes = [], language = "en" } = {}) {
  const requested = formatRequestedSizes(matchedAvailableRequestedSizes(product, requestedSizes)) || "an available requested size";
  const listed = listAvailableSizes(product) || "the listed options";
  const replies = {
    ar: `تم العثور على هذا القميص مع توفر المقاس ${requested}. المقاسات المتاحة المعروضة هي: ${listed}. لا أستطيع تأكيد الملاءمة من الطول أو الوزن فقط.`,
    en: `I found this jersey with ${requested} currently listed as available. The available listed sizes are ${listed}. I can’t confirm fit from height or weight alone.`,
    es: `He encontrado esta camiseta con ${requested} disponible actualmente. Las tallas disponibles indicadas son ${listed}. No puedo confirmar el ajuste solo con la altura o el peso.`,
    fr: `J’ai trouvé ce maillot avec ${requested} actuellement disponible. Les tailles disponibles indiquées sont ${listed}. Je ne peux pas confirmer la coupe uniquement avec la taille ou le poids.`,
    hu: `Megtaláltam ezt a mezt, és a(z) ${requested} méret jelenleg elérhetőnek van jelölve. A feltüntetett elérhető méretek: ${listed}. Magasság vagy testsúly alapján nem tudom biztosan megmondani a megfelelő méretet.`,
    tr: `Bu formayı buldum; ${requested} beden şu anda mevcut olarak listeleniyor. Listelenen mevcut bedenler: ${listed}. Yalnızca boy veya kiloya göre uygunluğu kesinleştiremem.`,
    zh: `我找到了这件球衣，${requested} 目前显示为可选尺码。当前列出的可售尺码是：${listed}。我不能只根据身高或体重确认是否合身。`,
  };
  return replies[language] || replies.en;
}

function buildUnavailableProductSizingReply({ requestedSizes = [], language = "en" } = {}) {
  const requested = formatRequestedSizes(requestedSizes) || "that size";
  const replies = {
    ar: `وجدت المنتج المطابق، لكن المقاس ${requested} غير مُدرج كخيار متاح حالياً. هل ترغب في تجربة مقاس آخر؟`,
    en: `I found the matching jersey, but ${requested} is not currently listed as an available option. Would you like to try another size?`,
    es: `He encontrado la camiseta correspondiente, pero ${requested} no aparece actualmente como opción disponible. ¿Quieres probar otra talla?`,
    fr: `J’ai trouvé le maillot correspondant, mais ${requested} n’est pas actuellement indiqué comme option disponible. Souhaites-tu essayer une autre taille ?`,
    hu: `Megtaláltam a megfelelő mezt, de a(z) ${requested} méret jelenleg nincs elérhető opcióként feltüntetve. Szeretnél másik méretet próbálni?`,
    tr: `Eşleşen formayı buldum, ancak ${requested} beden şu anda mevcut bir seçenek olarak listelenmiyor. Başka bir beden denemek ister misin?`,
    zh: `我找到了对应的球衣，但 ${requested} 目前没有显示为可售选项。你想试试其他尺码吗？`,
  };
  return replies[language] || replies.en;
}

function resolveProductSizingLanguage(languageCode = "", userText = "") {
  const language = String(languageCode || "").trim().toLowerCase().split("-")[0];
  if (["ar", "en", "es", "fr", "hu", "tr", "zh"].includes(language)) return language;
  return /[\u3400-\u9fff]/.test(String(userText || "")) ? "zh" : "en";
}

function buildCurrentProductSizingReply({ product = null, language = "en" } = {}) {
  const sizes = listAvailableSizes(product);
  const sizeText = sizes || "the listed options";
  const replies = {
    ar: `المقاسات المعروضة لهذا القميص هي: ${sizeText}. لا أستطيع تأكيد المقاس المناسب اعتماداً على الطول أو الوزن فقط؛ ما المقاس الذي ترتديه عادة؟`,
    en: `The listed sizes for this jersey are ${sizeText}. I can’t confirm fit from height or weight alone — what size do you usually wear?`,
    es: `Las tallas indicadas para esta camiseta son ${sizeText}. No puedo confirmar el ajuste solo con la altura o el peso; ¿qué talla usas normalmente?`,
    fr: `Les tailles indiquées pour ce maillot sont ${sizeText}. Je ne peux pas confirmer la coupe uniquement avec la taille ou le poids ; quelle taille portes-tu habituellement ?`,
    hu: `Ennél a mezénél ezek a feltüntetett méretek: ${sizeText}. Magasság vagy testsúly alapján nem tudom biztosan megmondani a megfelelő méretet; általában milyen méretet viselsz?`,
    tr: `Bu forma için listelenen bedenler: ${sizeText}. Yalnızca boy veya kiloya göre uygun bedeni kesinleştiremem; normalde hangi bedeni giyersin?`,
    zh: `这件球衣当前列出的尺码是：${sizeText}。我不能只根据身高或体重确认合身程度；你平时通常穿什么尺码？`,
  };
  return replies[language] || replies.en;
}

function listAvailableSizes(product = null) {
  return Array.isArray(product?.sizes)
    ? product.sizes
      .filter((size) => !(size && typeof size === "object" && size.available === false))
      .map((size) => typeof size === "object" ? String(size?.label || "").trim() : String(size || "").trim())
      .filter(Boolean)
      .join(", ")
    : "";
}

function formatRequestedSizes(values = []) {
  const sizes = (Array.isArray(values) ? values : [values]).map((value) => String(value || "").trim()).filter(Boolean);
  return sizes.join(", ");
}

function matchedAvailableRequestedSizes(product = null, requestedSizes = []) {
  const requested = (Array.isArray(requestedSizes) ? requestedSizes : [requestedSizes])
    .map(normalizeSizeLabel)
    .filter(Boolean);
  const available = Array.isArray(product?.sizes)
    ? product.sizes
      .filter((size) => !(size && typeof size === "object" && size.available === false))
      .map((size) => normalizeSizeLabel(typeof size === "object" ? size?.label : size))
      .filter(Boolean)
    : [];
  return requested.filter((size) => available.includes(size));
}

function normalizeSizeLabel(value = "") {
  const normalized = String(value || "").trim().toUpperCase().replace(/\s+/g, "");
  return normalized === "XXL" ? "2XL" : normalized;
}

function buildUnanchoredSizingGuidanceReply({ language = "en" } = {}) {
  const replies = {
    ar: "لأي فريق أو قميص أو منتج محدد تريد مساعدة في اختيار المقاس؟",
    en: "Which team, jersey, or specific product would you like sizing help with?",
    es: "¿Con qué equipo, camiseta o producto concreto necesitas ayuda de talla?",
    fr: "Pour quelle équipe, quel maillot ou quel produit précis souhaites-tu une aide sur la taille ?",
    hu: "Melyik csapathoz, mezhez vagy konkrét termékhez szeretnél méretválasztási segítséget?",
    tr: "Hangi takım, forma veya belirli ürün için beden konusunda yardım istersin?",
    zh: "你想咨询哪支球队、哪件球衣或哪一款具体商品的尺码？",
  };
  return replies[language] || replies.en;
}
