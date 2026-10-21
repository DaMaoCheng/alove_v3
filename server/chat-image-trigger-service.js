export const CHAT_IMAGE_BLOCK_REASONS = Object.freeze({
  ACTIVE_GENERATION: "active_generation",
  QUOTA_EXHAUSTED: "quota_exhausted",
  DISALLOWED_REQUEST: "disallowed_request",
});

const MOCK_IMAGE_TRIGGER = "#mock-image";

const PHOTO_TERMS = [
  /#mock-image/i,
  /\b(take|snap|shoot|make|create|generate)\s+(a\s+)?(photo|pic|picture|image|shot)\b/i,
  /\b(photo|pic|picture|image|shot)\s+(of|with|for)\b/i,
  /\bshow\s+me\b.*\b(wear|wearing|try\s*it\s*on|try\s+on|on\s+you|fit|outfit|look)\b/i,
  /\btry\s+(this|that|it|them)\s+on\b/i,
  /\b(can\s+you\s+)?(wear|put\s+on|try\s+on)\s+(this|that|the)?\s*(kit|shirt|jersey|top|outfit)\b/i,
  /\b(wear|wearing|put\s+on|try\s+on)\b.*\b(show\s+(it\s+)?(to|for)\s+me|show\s+me)\b/i,
  /\b(try\s*it\s*on|try\s+on|wear\s+it|put\s+it\s+on|on\s+you|fit\s+pic)\b/i,
  /拍张照|拍一张|拍个照|拍照|照片|图片|生图|生成图/i,
  /穿给我看|穿上给我看|穿一下|试穿|上身|上身效果/i,
  /\b(foto|imagen|selfie|fotografía|fotografia)\b/i,
  /\b(photo|image|selfie)\b.*\b(montre|envoie|envoye|génère|genere|crée|cree|muestra|manda|envía|envia|genera|crea|mostre|mande|gere|crie|zeig|schick|generiere|erstelle)\b/i,
  /写真|画像|自撮り|見せて|送って|生成|作って|着て|試着/i,
];

const ALLOWED_ROLE_TERMS = [
  /\b(you|yourself|selfie|wear|wearing|put\s+on|try\s*it\s*on|try\s+on|on\s+you|fit\s+pic|outfit|look)\b/i,
  /\btry\s+(this|that|it|them)\s+on\b/i,
  /\b(with|in)\s+(this|that|the)?\s*(kit|shirt|jersey|top|outfit)\b/i,
  /你|妳|自己|自拍|穿给我看|穿上给我看|穿一下|试穿|上身|上身效果|穿着|搭配|球衣|衣服/i,
  /\b(ponte|póntela|pruébate|pruebate|vístete|vistete|muéstrame|muestrame|mándame|mandame|envíame|enviame)\b/i,
  /\b(vista|experimente|mostre|envie|mande|crie|gere|porte|essaie|montre|envoie|génère|genere|cré[eé]|zeig|schick|generiere|erstelle|zieh.*an|probiere)\b/i,
  /\b(genera|generar|crea|crear|gere|gerar|crie|criar|génère|genere|générer|crée|cree|créer|generiere|erstelle)\b.{0,36}\b(de\s+ti|tuya|sua|de\s+toi|von\s+dir|あなた|あなたの)\b/i,
  /着て|着てみて|試着|穿上|穿着|あなた|君|きみ/i,
];

const DISALLOWED_TERMS = [
  /\b(product|main|listing|ecommerce|white\s*background|background\s*removal|remove\s*background|ad\s*creative|advertisement|banner|poster|bulk|batch|catalog)\s+(photo|pic|picture|image|shot|creative|asset)?\b/i,
  /\b(generate|make|create)\s+(two|three|four|five|multiple|many|several|\d+)\b/i,
  /\b(white\s*bg|packshot|product\s*shot|hero\s*image)\b/i,
  /商品图|产品图|商品主图|主图|白底|去背景|抠图|广告图|广告素材|横幅|海报|批量|多张|多套|电商图|详情页图/i,
];

const IMAGE_INSPECTION_TERMS = [
  /\b(look|check|see)\s+(at\s+)?(this|that|the|my)?\s*(pic|picture|image|photo|attachment)\b/i,
  /\b(take\s+a\s+look|have\s+a\s+look)\s+(at\s+)?(this|that|the|my)?\s*(pic|picture|image|photo|attachment)?\b/i,
  /\b(what\s+is|what's|whats|describe|identify|recognise|recognize|tell\s+me\s+about)\s+(this|that|the|my)?\s*(pic|picture|image|photo|attachment)\b/i,
  /\b(pic|picture|image|photo)\s+(check|review|thoughts|opinion)\b/i,
  /看看这张图|看下这张图|看一下这张图|看这张图|帮我看看|识别一下|识别这张|分析这张图|这是什么图|这是什么图片|这张图是什么/i,
];

const EXPLICIT_GENERATION_TERMS = [
  /\b(take|snap|shoot|make|create|generate)\s+(a\s+)?(photo|pic|picture|image|shot)\b/i,
  /\b(wear|wearing|put\s+on|try\s+on|try\s*it\s*on|wear\s+it|put\s+it\s+on|on\s+you|selfie)\b/i,
  /\b(photo|pic|picture|image|shot)\s+(with|of)\s+(you|yourself|me|us)\b/i,
  /拍张照|拍一张|拍个照|拍照|生图|生成图|自拍|合照|合影|穿给我看|穿上给我看|穿一下|试穿|上身|上身效果/i,
  /\b(genera|generar|crea|crear|gere|gerar|crie|criar|génère|genere|générer|crée|cree|créer|crear|generiere|erstelle|生成|作って)\b.*\b(foto|imagen|image|photo|foto|bild|写真|画像)\b/i,
  /\b(ponte|póntela|pruébate|pruebate|vista|porte|zieh.*an|着て|試着)\b/i,
  /生成|作って|着て|試着/i,
];

export function hasChatImageVisualAction(text = "") {
  return Boolean(findMatch(String(text || ""), PHOTO_TERMS)) || hasExplicitChatImageGenerationAction(text);
}

export function hasExplicitChatImageGenerationAction(text = "") {
  return Boolean(findMatch(String(text || ""), EXPLICIT_GENERATION_TERMS))
    || /\b(?:try|put)\s+(?:(?:it|this|that)(?:\s+[\p{L}\p{N}-]+){0,3}\s+)?on\b/iu.test(String(text || ""));
}

export function isMockChatImageRequest(text = "") {
  return String(text || "").toLowerCase().includes(MOCK_IMAGE_TRIGGER);
}

export function isImageInspectionOnly(text = "") {
  const value = String(text || "").trim();
  if (!value) return false;
  if (!findMatch(value, IMAGE_INSPECTION_TERMS)) return false;
  return !findMatch(value, EXPLICIT_GENERATION_TERMS);
}

export function analyzeChatImageTrigger(text = "") {
  const value = String(text || "").trim();
  if (!value) {
    return buildResult({ hasIntent: false, allowed: false });
  }
  if (isImageInspectionOnly(value)) {
    return buildResult({ hasIntent: false, allowed: false });
  }

  const matchedBlocker = findMatch(value, DISALLOWED_TERMS);
  const matchedPhoto = findMatch(value, PHOTO_TERMS);
  const matchedAllowed = findMatch(value, ALLOWED_ROLE_TERMS);
  const hasIntent = Boolean(matchedPhoto || matchedBlocker || (matchedAllowed && looksLikeImageVerb(value)));

  if (!hasIntent) {
    return buildResult({ hasIntent: false, allowed: false });
  }
  if (matchedBlocker) {
    return buildResult({
      hasIntent: true,
      allowed: false,
      reason: CHAT_IMAGE_BLOCK_REASONS.DISALLOWED_REQUEST,
      matchedBlocker,
      matchedIntent: matchedPhoto || matchedAllowed,
    });
  }
  // A photo word without a clear role/context signal is ambiguous. Defer it
  // to the semantic classifier instead of treating everyday requests such as
  // “send me a photo” as a disallowed product-image request. Explicit
  // product/advertising requests were handled by matchedBlocker above.
  if (!matchedAllowed && !isMockChatImageRequest(value)) {
    return buildResult({ hasIntent: false, allowed: false, detectionSource: "deterministic_deferred" });
  }

  return buildResult({
    hasIntent: true,
    allowed: true,
    matchedIntent: matchedPhoto || matchedAllowed,
    intentType: inferIntentType(value, matchedAllowed),
    explicitGeneration: Boolean(findMatch(value, EXPLICIT_GENERATION_TERMS)),
    detectionSource: "deterministic",
  });
}

function buildResult({ hasIntent, allowed, reason = "", matchedIntent = "", matchedBlocker = "", intentType = "", explicitGeneration = false, detectionSource = "deterministic" }) {
  return {
    hasIntent: Boolean(hasIntent),
    allowed: Boolean(allowed),
    reason,
    matchedIntent,
    matchedBlocker,
    intentType,
    explicitGeneration: Boolean(explicitGeneration),
    detectionSource,
  };
}

function findMatch(value, patterns) {
  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match?.[0]) return match[0];
  }
  return "";
}

function looksLikeImageVerb(value) {
  return /\b(photo|pic|picture|image|shot|take|snap|shoot|create|generate|make|foto|imagen|fotografía|fotografia|imagem|photo|image|bild|foto|写真|画像|genera|generar|crea|crear|gere|gerar|crie|criar|génère|genere|générer|crée|cree|generiere|erstelle|生成|作って)\b/i.test(value) ||
    /拍|照片|图片|生图|生成图|写真|画像/.test(value);
}

function inferIntentType(value, matchedAllowed = "") {
  if (findMatch(value, EXPLICIT_GENERATION_TERMS) && /穿|试穿|上身|wear|wearing|try|put\s+on|ponte|póntela|pruébate|vista|porte|zieh|着て|試着/i.test(value)) {
    return "try_on";
  }
  return matchedAllowed ? "role_photo" : "";
}
