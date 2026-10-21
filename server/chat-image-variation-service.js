const VARIATION_DIMENSIONS = Object.freeze({
  expression: Object.freeze([
    "a warm, relaxed half-smile",
    "a bright, friendly smile",
    "a calm, confident expression",
    "a playful, candid smile",
    "a soft, attentive expression",
  ]),
  pose: Object.freeze([
    "standing naturally with relaxed shoulders",
    "leaning lightly against a nearby surface",
    "sitting casually in a comfortable posture",
    "walking through the scene in a candid moment",
    "turning slightly toward the camera",
    "holding a natural, conversational pose",
  ]),
  camera: Object.freeze([
    "a relaxed eye-level portrait framing",
    "a candid three-quarter portrait angle",
    "a close conversational selfie-style framing",
    "a slightly wider lifestyle portrait framing",
    "a gentle over-the-shoulder candid angle",
  ]),
  scene: Object.freeze([
    "a sunlit neighborhood cafe terrace",
    "a cozy indoor lifestyle space with subtle football details",
    "a relaxed city street near golden hour",
    "a softly lit matchday concourse",
    "a calm seaside promenade",
    "a warm bookshop or record-store corner",
  ]),
  wardrobe: Object.freeze([
    "a character-appropriate casual outfit with natural texture",
    "a polished everyday outfit that feels personal rather than styled for a catalog",
    "a relaxed matchday-inspired casual outfit",
    "a light layered street-style outfit that suits the character",
  ]),
  lighting: Object.freeze([
    "soft late-afternoon natural light",
    "warm window light with gentle shadow falloff",
    "clean overcast daylight with natural skin tones",
    "subtle golden-hour backlight",
    "cozy indoor ambient light with a soft daylight accent",
  ]),
});

const VARIATION_DIMENSION_KEYS = Object.freeze(Object.keys(VARIATION_DIMENSIONS));

const NEGATED_CLOTHING_PATTERN = /\b(?:no|not|without)\s+(?:an?\s+)?(?:piece\s+of\s+)?(?:clothes|clothing|outfit)\b/i;

export function resolveChatImageRequestConstraints({ userText = "", latestProduct = null, latestUserImage = null, semanticConditions = null, productReferenceRequired = false } = {}) {
  const request = normalizeText(userText);
  const hasProduct = Boolean(latestProduct && typeof latestProduct === "object");
  const hasUserImage = Boolean(latestUserImage?.imageUrl || latestUserImage?.url);
  const wantsWear = /\b(wear|wearing|(?:try|put)\s+(?:(?:it|this|that)(?:\s+[\p{L}\p{N}-]+){0,3}\s+)?on|on[-\s]?body|style\s+(?:it|this|that))\b/iu.test(request)
    || /穿|试穿|上身|搭配|giy(?:in|er|mek|ebilir|ebilir\s*misin)?|dene(?:mek|r)?|vedd\s+fel|felvenn(?:éd|e)|viseld|próbáld\s+fel|porte(?:r|z)?|essaie(?:r|z)?/i.test(request);
  const negated = NEGATED_CLOTHING_PATTERN.test(request);
  const wantsGroupPhoto = /\b(together|with me|with us|group|couple|photo together|same photo)\b/i.test(request)
    || /合影|一起|同框|birlikte|benimle|ikimiz|együtt|velem|közös\s*(?:kép|fotó)|ensemble|avec moi/i.test(request);
  const referencesProduct = hasProduct && requestReferencesCurrentProduct(request, latestProduct);
  const referencesUserImage = hasUserImage && requestReferencesUploadedImage(request);
  const wants_no_clothing = semanticConditions ? semanticConditions.wants_no_clothing === true : negated;
  const wants_clothing = semanticConditions
    ? semanticConditions.wants_clothing === true && !wants_no_clothing
    : Boolean(wantsWear) && !wants_no_clothing;
  const usesProductReference = hasProduct && wants_clothing && (productReferenceRequired === true || referencesProduct);
  const usesUploadedClothing = hasUserImage && wants_clothing && referencesUserImage && !wantsGroupPhoto && !usesProductReference;
  const usesUserImageReference = hasUserImage && (wantsGroupPhoto || usesUploadedClothing || referencesUserImage);

  return {
    wantsWear: wants_clothing,
    wants_no_clothing,
    wants_clothing,
    wantsGroupPhoto,
    usesProductReference,
    productReferenceRequired: productReferenceRequired === true,
    usesUploadedClothing,
    usesUserImageReference,
    conditions: semanticConditions || { wants_no_clothing, wants_clothing },
  };
}

function requestReferencesCurrentProduct(request = "", product = {}) {
  if (/\b(it|this|that|the\s+(?:product|shirt|jersey|kit|outfit))\b|\b(?:this|that)\s+(?:[\p{L}\p{N}-]+\s+){0,3}(?:product|shirt|jersey|kit|outfit)\b/iu.test(request)
    || /这件|这个|该款|它|bu\s+(?:forma(?:yı|yi|yı|ya|dan|nın)?|tişört(?:ü|üme|ü)?|ürün(?:ü|ü)?)|onu|ezt\s+a\s+(?:mezt|pólót)|ezt|azt|ce\s+(?:maillot|produit)|cette\s+(?:tenue|pièce)|le\s+maillot/i.test(request)) {
    return true;
  }
  const productName = normalizeText(product?.name || product?.title).toLowerCase();
  if (!productName) return false;
  const nameTokens = productName.match(/[\p{L}\p{N}]{4,}/gu) || [];
  const requestLower = request.toLowerCase();
  return nameTokens.filter((token) => requestLower.includes(token)).length >= 2;
}

function requestReferencesUploadedImage(request = "") {
  return /\b(this|that)\s+(?:photo|picture|image|jacket|clothing|outfit|shirt|jersey|kit|item)|\b(?:use|reference)\s+(?:this|that|the)\s+(?:photo|picture|image)|\b(?:use|reference)\s+it\b/i.test(request)
    || /这张|这个图片|这幅图|这件(?:衣服|球衣)|参考(?:图|这)|用这(?:张|个)|bu\s+(?:fotoğraf|resim|görsel|ceket|forma)|bu\s+referans|ezt\s+a\s+(?:képet|fotót|mezt|kabátot)|ez\s+a\s+kép|referenci(?:a|ának)|cette\s+(?:photo|image|tenue|veste)|utilise(?:r)?\s+(?:cette|la)\s+(?:photo|image)|référence/i.test(request);
}

export function createChatImageVariation({ assetId = "", messageId = "", characterId = "", userText = "", constraints = {} } = {}) {
  const random = createSeededRandom([assetId, messageId, characterId, userText].filter(Boolean).join("|"));
  const indexes = {};
  for (const key of VARIATION_DIMENSION_KEYS) {
    indexes[key] = Math.floor(random() * VARIATION_DIMENSIONS[key].length) + 1;
  }
  const variation = {
    code: VARIATION_DIMENSION_KEYS.map((key) => indexes[key]).join("-"),
    ...Object.fromEntries(VARIATION_DIMENSION_KEYS.map((key) => [key, VARIATION_DIMENSIONS[key][indexes[key] - 1]])),
  };
  // 否定命中时跳过随机 wardrobe 维度，避免 prompt 冒出矛盾服装段
  if (constraints.wants_no_clothing) {
    variation.wardrobe = "";
  }
  return applyRequiredReferenceOverrides(variation, constraints);
}

export function getChatImageVariationInstruction(variation = {}) {
  if (!variation?.code) return "";
  return [
    `Fixed variation code: ${variation.code}.`,
    "For every visual dimension not directly specified by the user, use this exact configuration:",
    `Expression: ${variation.expression}.`,
    `Pose: ${variation.pose}.`,
    `Camera: ${variation.camera}.`,
    `Scene: ${variation.scene}.`,
    variation.wardrobe ? `Wardrobe: ${variation.wardrobe}.` : "",
    `Lighting: ${variation.lighting}.`,
    "Do not invent another random pose, expression, camera, scene, wardrobe, or lighting choice.",
  ].filter(Boolean).join("\n");
}

function applyRequiredReferenceOverrides(variation, constraints = {}) {
  if (constraints.usesProductReference) {
    return {
      ...variation,
      wardrobe: "wear exactly the requested product using its supplied product reference image as the clothing source",
    };
  }
  if (constraints.usesUploadedClothing) {
    return {
      ...variation,
      wardrobe: "wear the clothing from the user's uploaded image reference and preserve its recognizable design",
    };
  }
  return variation;
}

function createSeededRandom(seedText) {
  let state = hashSeed(seedText) || 1;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(value = "") {
  let hash = 2166136261;
  for (const character of String(value || "")) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function normalizeText(value = "") {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 600);
}
