import { parseJsonValue } from "./chat-message-payload-utils.js";
import { createChatImageVariation, resolveChatImageRequestConstraints } from "./chat-image-variation-service.js";

const CONTEXT_LIMITS = Object.freeze({
  userText: 600,
  promptSummary: 500,
  recentMessage: 220,
  characterName: 96,
  roleTitle: 128,
  shortBio: 220,
  persona: 900,
  speakingStyle: 360,
  language: 96,
  productName: 180,
  productSubtitle: 240,
  productAttribute: 120,
  productImageUrl: 360,
  attachmentName: 160,
  selectedSize: 48,
});

const SENSITIVE_KEY_PATTERN = /(token|secret|password|credential|api[_-]?key|access[_-]?token|authorization|client[_-]?secret|base[_-]?url)/i;
const SENSITIVE_VALUE_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi,
  /\bBasic\s+[A-Za-z0-9+/=-]{12,}/gi,
  /\bsk-[A-Za-z0-9_-]{16,}/g,
  /\bshpat_[A-Za-z0-9_]{12,}/g,
  /\bshpca_[A-Za-z0-9_]{12,}/g,
  /\bGOCSPX-[A-Za-z0-9_-]{12,}/g,
  /\bAIza[0-9A-Za-z_-]{20,}/g,
];

export async function buildChatImageGenerationContext(db, { assetId, messageId, imageConditions = null, productReferenceRequired = false, requiredProductReference = null } = {}) {
  const normalizedAssetId = safeText(assetId, 96);
  const normalizedMessageId = safeText(messageId, 96);
  if (!normalizedAssetId || !normalizedMessageId) {
    throw new Error("Chat image context requires assetId and messageId");
  }

  const row = await loadImageAssetContextRow(db, {
    assetId: normalizedAssetId,
    messageId: normalizedMessageId,
  });
  const recentMessages = await loadRecentChatImageMessages(db, {
    sessionId: row.session_id,
    messageId: normalizedMessageId,
  });
  const requiresProduct = productReferenceRequired === true || requiredProductReference != null;
  const latestProduct = requiresProduct
    ? validateRequiredProductReference(requiredProductReference, row)
    : findLatestProduct(recentMessages);
  const latestUserImage = findLatestUserImageAttachment(recentMessages);
  const userText = findLatestUserText(recentMessages);
  const imageRequestConstraints = resolveChatImageRequestConstraints({
    userText,
    latestProduct,
    latestUserImage,
    semanticConditions: imageConditions,
    productReferenceRequired: requiresProduct,
  });
  if (requiresProduct && !imageRequestConstraints.usesProductReference) {
    throw requiredProductReferenceError("conflicts with image request conditions");
  }
  const selectedSize = resolveSelectedSize({
    userText,
    recentMessages,
    product: latestProduct,
  });

  const context = {
    character: normalizeCharacterContext(row),
    userText: safeText(userText, CONTEXT_LIMITS.userText),
    promptSummary: safeText(row.prompt_summary, CONTEXT_LIMITS.promptSummary),
    recentMessages: normalizeRecentMessages(recentMessages),
    latestProduct: imageRequestConstraints.usesProductReference
      ? normalizeProductContext(latestProduct, { selectedSize })
      : null,
    latestUserImage: imageRequestConstraints.usesUserImageReference
      ? normalizeUserImageContext(latestUserImage)
      : null,
    imageRequestConstraints,
    variation: createChatImageVariation({
      assetId: normalizedAssetId,
      messageId: normalizedMessageId,
      characterId: row.character_id,
      userText,
      constraints: imageRequestConstraints,
    }),
  };
  return removeEmptyContext(context);
}

export function buildChatImagePromptContextPayload(context = {}) {
  return removeEmptyContext({
    character: context.character || null,
    userText: safeText(context.userText, CONTEXT_LIMITS.userText),
    promptSummary: safeText(context.promptSummary, CONTEXT_LIMITS.promptSummary),
    imageRequestConstraints: context.imageRequestConstraints || null,
    variation: context.variation?.code ? { code: safeText(context.variation.code, 64) } : null,
    selectedSize: safeText(context.latestProduct?.selectedSize, CONTEXT_LIMITS.selectedSize),
    latestProduct: context.latestProduct || null,
    latestUserImage: context.latestUserImage || null,
    recentMessages: Array.isArray(context.recentMessages) ? context.recentMessages.slice(-8) : [],
  });
}

export function sanitizeChatImagePromptContextPayload(payload = {}) {
  return sanitizeValue(payload, 0);
}

async function loadImageAssetContextRow(db, { assetId, messageId }) {
  const [rows] = await db.execute(
    `SELECT
       a.prompt_summary,
       a.session_id,
       a.character_id,
       c.name,
       c.site_id,
       c.role_title,
       c.short_bio,
       c.avatar_url,
       c.category_id,
       c.persona_prompt,
       c.speaking_style,
       c.profile_json,
       s.preferred_language
     FROM chat_image_assets a
     LEFT JOIN ai_characters c ON c.id = a.character_id
     LEFT JOIN chat_sessions s ON s.id = a.session_id
     WHERE a.id = ?
       AND a.message_id = ?
     LIMIT 1`,
    [assetId, messageId]
  );
  return rows[0] || {};
}

async function loadRecentChatImageMessages(db, { sessionId, messageId }) {
  const normalizedSessionId = safeText(sessionId, 96);
  if (!normalizedSessionId) return [];
  const [orderRows] = await db.execute(
    "SELECT display_order FROM chat_messages WHERE id = ? AND session_id = ? LIMIT 1",
    [messageId, normalizedSessionId]
  );
  const displayOrder = Number(orderRows[0]?.display_order || 0);
  if (!displayOrder) return [];
  const [rows] = await db.execute(
    `SELECT sender_type, content_type, text_content, product_payload_json, display_order
     FROM chat_messages
     WHERE session_id = ?
       AND display_order < ?
     ORDER BY display_order DESC, sent_at DESC
     LIMIT 16`,
    [normalizedSessionId, displayOrder]
  );
  return rows.reverse();
}

function normalizeCharacterContext(row = {}) {
  const profile = parseJsonValue(row.profile_json, {});
  return removeEmptyContext({
    name: safeText(row.name, CONTEXT_LIMITS.characterName),
    roleTitle: safeText(row.role_title, CONTEXT_LIMITS.roleTitle),
    shortBio: safeText(row.short_bio, CONTEXT_LIMITS.shortBio),
    avatarUrl: safePublicUrl(row.avatar_url, CONTEXT_LIMITS.productImageUrl),
    category: safeText(row.category_id, CONTEXT_LIMITS.productAttribute),
    persona: safeText(row.persona_prompt, CONTEXT_LIMITS.persona),
    speakingStyle: safeText(row.speaking_style, CONTEXT_LIMITS.speakingStyle),
    language: safeText(row.preferred_language || profile.defaultLanguageLabel || profile.language, CONTEXT_LIMITS.language),
  });
}

function normalizeRecentMessages(messages = []) {
  if (!Array.isArray(messages)) return [];
  return messages
    .slice(-8)
    .map((message) => removeEmptyContext({
      senderType: safeText(message?.sender_type, 32),
      contentType: safeText(message?.content_type, 32),
      text: safeText(message?.text_content, CONTEXT_LIMITS.recentMessage),
    }))
    .filter((message) => message.text);
}

function normalizeProductContext(product = null, { selectedSize = "" } = {}) {
  if (!product || typeof product !== "object") return null;
  const sizes = normalizeProductSizes(product.sizes);
  const imageUrls = normalizeProductImageUrls(product);
  return removeEmptyContext({
    id: safeText(product.id, 96),
    siteId: safeText(product.siteId, 96),
    name: safeText(product.name || product.title, CONTEXT_LIMITS.productName),
    subtitle: safeText(product.subtitle || product.summary, CONTEXT_LIMITS.productSubtitle),
    selectedSize: safeText(selectedSize, CONTEXT_LIMITS.selectedSize),
    imageUrl: imageUrls[0] || "",
    imageUrls,
    sizes,
    attributes: normalizeProductAttributes(product),
  });
}

function validateRequiredProductReference(product, row = {}) {
  if (!product || typeof product !== "object" || Array.isArray(product)
    || !safeText(product.id, 96) || !normalizeProductImageUrls(product).length) {
    throw requiredProductReferenceError("requires an identified product and usable image URL");
  }
  const productSiteId = safeText(product.siteId, 96);
  const characterSiteId = safeText(row.site_id, 96);
  if (!productSiteId || !characterSiteId || productSiteId !== characterSiteId) {
    throw requiredProductReferenceError("belongs to a different site");
  }
  return product;
}

function requiredProductReferenceError(reason) {
  const error = new Error(`Required product reference ${reason}`);
  error.retryable = false;
  return error;
}

function normalizeUserImageContext(attachment = null) {
  if (!attachment || typeof attachment !== "object") return null;
  return removeEmptyContext({
    kind: "image",
    name: safeText(attachment.name, CONTEXT_LIMITS.attachmentName),
    imageUrl: safePublicUrl(attachment.url, CONTEXT_LIMITS.productImageUrl),
    mimeType: safeText(attachment.mimeType, 80),
  });
}

function normalizeProductSizes(sizes = []) {
  if (!Array.isArray(sizes)) return [];
  return sizes.slice(0, 18).map((size) => removeEmptyContext({
    label: safeText(size?.label || size?.name || size, 32),
    available: typeof size?.available === "boolean" ? size.available : null,
    sku: safeText(size?.sku, 80),
  })).filter((size) => size.label);
}

function normalizeProductImageUrls(product = {}) {
  const rows = [
    product.imageUrl,
    ...(Array.isArray(product.imageUrls) ? product.imageUrls : []),
  ];
  return [...new Set(rows.map((url) => safePublicUrl(url, CONTEXT_LIMITS.productImageUrl)).filter(Boolean))].slice(0, 4);
}

function normalizeProductAttributes(product = {}) {
  const features = Array.isArray(product.features) ? product.features : [];
  const attributes = [
    product.stock ? `stock: ${product.stock}` : "",
    product.available === true ? "available: true" : product.available === false ? "available: false" : "",
    ...features,
  ];
  return attributes.map((item) => safeText(item, CONTEXT_LIMITS.productAttribute)).filter(Boolean).slice(0, 8);
}

function findLatestUserText(messages = []) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.sender_type === "user" && message?.text_content) return message.text_content;
  }
  return "";
}

function findLatestProduct(messages = []) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.content_type !== "product" || !message?.product_payload_json) continue;
    return parseJsonValue(message.product_payload_json, null);
  }
  return null;
}

function findLatestUserImageAttachment(messages = []) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.sender_type !== "user" || message?.content_type !== "attachment" || !message?.product_payload_json) continue;
    const attachment = parseJsonValue(message.product_payload_json, null);
    if (attachment?.kind === "image" && attachment?.url) return attachment;
  }
  return null;
}

function resolveSelectedSize({ userText = "", recentMessages = [], product = null } = {}) {
  const sizes = Array.isArray(product?.sizes) ? product.sizes : [];
  const labels = sizes.map((size) => safeText(size?.label || size?.name || size, 32)).filter(Boolean);
  if (!labels.length) return "";
  const candidates = [
    userText,
    ...recentMessages
      .filter((message) => message?.sender_type === "user")
      .slice(-6)
      .map((message) => message.text_content || ""),
  ];
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const matched = matchSizeLabel(candidates[index], labels);
    if (matched) return matched;
  }
  return "";
}

function matchSizeLabel(text = "", labels = []) {
  const value = String(text || "").trim();
  if (!value) return "";
  for (const label of labels) {
    const escaped = escapeRegExp(label);
    if (new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(value)) return label;
  }
  return "";
}

function sanitizeValue(value, depth) {
  if (depth > 5) return null;
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, depth + 1)).filter((item) => item != null).slice(0, 20);
  }
  if (value && typeof value === "object") {
    const clean = {};
    for (const [key, child] of Object.entries(value)) {
      if (SENSITIVE_KEY_PATTERN.test(key)) continue;
      const sanitized = sanitizeValue(child, depth + 1);
      if (sanitized == null || sanitized === "" || (Array.isArray(sanitized) && !sanitized.length)) continue;
      clean[key] = sanitized;
    }
    return Object.keys(clean).length ? clean : null;
  }
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  return redactSensitiveValue(safeText(value, 500));
}

function removeEmptyContext(value) {
  return sanitizeValue(value, 0) || {};
}

function safePublicUrl(value = "", maxLength = 360) {
  const url = safeText(value, maxLength);
  if (!url) return "";
  if (url.startsWith("/assets/") || url.startsWith("/uploads/") || url.startsWith("/api/uploads/")) return url;
  if (!/^https?:\/\//i.test(url)) return "";
  try {
    const parsed = new URL(url);
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().slice(0, maxLength);
  } catch {
    return "";
  }
}

function safeText(value = "", maxLength = 500) {
  return String(value == null ? "" : value)
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function redactSensitiveValue(value = "") {
  let text = String(value || "");
  for (const pattern of SENSITIVE_VALUE_PATTERNS) {
    text = text.replace(pattern, "[REDACTED]");
  }
  return text;
}

function escapeRegExp(value = "") {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
