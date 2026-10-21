import { SERVER_CONFIG } from "./config.js";
import { isImageGenerationConfigured, requestGeneratedImage } from "./image-generation-provider-service.js";
import { createChatImageVariation, getChatImageVariationInstruction, resolveChatImageRequestConstraints } from "./chat-image-variation-service.js";

const DEFAULT_CHAT_IMAGE_SIZE = "1024x1792";
const CHAT_IMAGE_STYLE_PROMPT = [
  "Create one vertical 9:16 photo, final composition suitable for 1024x1792 pixels.",
  "photorealistic, natural color grading, shot on 50mm f/1.4, warm tones, intimate atmosphere, editorial photography style.",
  "Maintain the same character identity from the reference image. Keep facial features, face shape, eyes, nose, lips, skin tone, hairstyle impression, and overall recognizable look consistent.",
  "The reference image establishes character identity only; preserve its recognizable facial features and overall look.",
  "Natural candid photography, realistic fabric texture, believable posture, soft background separation.",
  "One young adult or adult subject only. No minors, no childlike features.",
  "No watermark, no text, no logo, no poster design, no collage, no duplicate people, no distorted hands.",
].join("\n");

export function isRealChatImageProviderConfigured() {
  return isImageGenerationConfigured();
}

export async function generateRealChatImage({
  character = {},
  userText = "",
  promptSummary = "",
  recentMessages = [],
  latestProduct = null,
  latestUserImage = null,
  imageRequestConstraints = null,
  variation = null,
  referenceImages = [],
} = {}) {
  assertRealChatImageProviderConfigured();
  const prompt = buildChatImagePrompt({
    character,
    userText,
    promptSummary,
    recentMessages,
    latestProduct,
    latestUserImage,
    imageRequestConstraints,
    variation,
  });
  const generated = await requestGeneratedImage(prompt, {
    count: 1,
    size: SERVER_CONFIG.imageGeneration.openai.size || DEFAULT_CHAT_IMAGE_SIZE,
    filenamePrefix: "chat-image",
    referenceImages,
  });
  return {
    ...generated,
    prompt,
  };
}

export function buildChatImagePrompt({
  character = {},
  userText = "",
  promptSummary = "",
  recentMessages = [],
  latestProduct = null,
  latestUserImage = null,
  imageRequestConstraints = null,
  variation = null,
} = {}) {
  const characterName = safeText(character.name, 96);
  const roleTitle = safeText(character.role_title || character.roleTitle, 128);
  const shortBio = safeText(character.short_bio || character.shortBio, 220);
  const avatarUrl = safeText(character.avatar_url || character.avatarUrl, 260);
  const category = safeText(character.category_id || character.category, 120);
  const language = safeText(character.language || character.currentLanguage || character.default_language || character.defaultLanguage, 96);
  const persona = safeText(character.persona_prompt || character.personaPrompt, 900);
  const speakingStyle = safeText(character.speaking_style || character.speakingStyle, 360);
  const activeRequest = safeText(userText || promptSummary, 600);
  const history = normalizeRecentMessages(recentMessages);
  const constraints = imageRequestConstraints || resolveChatImageRequestConstraints({
    userText: activeRequest,
    latestProduct,
    latestUserImage,
  });
  const product = constraints.usesProductReference ? normalizeProductContext(latestProduct) : "";
  const userImage = constraints.usesUserImageReference ? normalizeUserImageContext(latestUserImage) : "";
  const resolvedVariation = variation?.code
    ? variation
    : createChatImageVariation({
      characterId: character.id || character.characterId || characterName,
      userText: activeRequest,
      constraints,
    });
  const firstPersonScene = buildFirstPersonScenePrompt({
    activeRequest,
    product: latestProduct,
    userImage: latestUserImage,
    constraints,
  });

  return [
    "Generate one English-prompted chat photo for an AI character inside a conversation.",
    "Write the image as first-person character POV: I am the character in this scene.",
    "This is not an ecommerce product image. It must feel like I naturally took a photo for the user.",
    firstPersonScene ? `Main scene prompt: ${firstPersonScene}` : "",
    characterName ? `Character name: ${characterName}.` : "",
    roleTitle ? `Role: ${roleTitle}.` : "",
    category ? `Character category: ${category}.` : "",
    language ? `Current conversation language: ${language}.` : "",
    shortBio ? `Short bio: ${shortBio}.` : "",
    avatarUrl ? `Character avatar/reference image URL: ${avatarUrl}` : "",
    persona ? `Character personality and visual cues: ${persona}` : "",
    speakingStyle ? `Mood and delivery cues: ${speakingStyle}` : "",
    activeRequest ? `User photo request: ${activeRequest}` : "",
    "Direct user requirements override the fixed variation wherever they conflict.",
    product ? `Current product context to wear or reference naturally: ${product}` : "",
    userImage ? `User uploaded image reference to use as visual material when relevant: ${userImage}` : "",
    history ? `Recent conversation mood/context:\n${history}` : "",
    getChatImageVariationInstruction(resolvedVariation),
    constraints.usesProductReference ? "Use the supplied product reference only for the requested try-on; keep its clothing design recognizable." : "",
    constraints.wantsGroupPhoto && constraints.usesUserImageReference ? "Compose the requested natural two-person photo with me and the person from the user's uploaded image reference." : "",
    "Keep it candid and social, not a catalog shot. Background should be softly blurred and secondary to the character.",
    CHAT_IMAGE_STYLE_PROMPT,
  ].filter(Boolean).join("\n\n");
}

function normalizeRecentMessages(messages = []) {
  if (!Array.isArray(messages)) return "";
  return messages
    .slice(-8)
    .map((message) => {
      const role = message?.sender_type === "user" || message?.senderType === "user" ? "User" : "Character";
      const text = safeText(message?.text_content || message?.text, 220);
      return text ? `${role}: ${text}` : "";
    })
    .filter(Boolean)
    .join("\n");
}

function normalizeProductContext(product = null) {
  if (!product || typeof product !== "object") return "";
  const parts = [
    safeText(product.name, 160),
    safeText(product.subtitle || product.summary, 240),
    safeText(product.selectedSize ? `Selected size: ${product.selectedSize}` : "", 80),
    safeText(product.imageUrl ? `Product image reference: ${product.imageUrl}` : "", 260),
    Array.isArray(product.sizes) && product.sizes.length ? `Sizes: ${product.sizes.map((size) => safeText(size?.label || size?.name || size, 24)).filter(Boolean).join(", ")}` : "",
    Array.isArray(product.attributes) && product.attributes.length ? `Attributes: ${product.attributes.map((item) => safeText(item, 80)).filter(Boolean).join(", ")}` : "",
  ].filter(Boolean);
  return parts.join("; ");
}

function normalizeUserImageContext(image = null) {
  if (!image || typeof image !== "object") return "";
  const parts = [
    safeText(image.name ? `Image name: ${image.name}` : "", 160),
    safeText(image.imageUrl ? `Image reference URL: ${image.imageUrl}` : "", 260),
    safeText(image.mimeType ? `Image type: ${image.mimeType}` : "", 80),
  ].filter(Boolean);
  return parts.join("; ");
}

function buildFirstPersonScenePrompt({ activeRequest = "", product = null, userImage = null, constraints = {} } = {}) {
  const request = safeText(activeRequest, 500);
  const productName = safeText(product?.name || product?.title, 160);
  const selectedSize = safeText(product?.selectedSize, 48);
  const hasProduct = Boolean(productName) && constraints.usesProductReference;
  const hasUserImage = Boolean(userImage?.imageUrl) && constraints.usesUserImageReference;
  const outfit = hasProduct
    ? `${productName}${selectedSize ? ` in size ${selectedSize}` : ""}`
    : constraints.usesUploadedClothing
      ? "the clothing shown in the user's uploaded image reference"
      : "a natural outfit that matches my character style";

  if (constraints.wantsGroupPhoto && hasUserImage && hasProduct) {
    return `I am wearing ${outfit} using the product reference image, standing naturally together with the person from the user's uploaded image reference.`;
  }
  if (constraints.wantsGroupPhoto && hasUserImage) {
    return "I am standing naturally together with the person from the user's uploaded image reference. Keep both people natural and recognizable from their references.";
  }
  if (hasProduct) {
    return `I am wearing ${outfit} using the product reference image as the clothing source.`;
  }
  if (constraints.usesUploadedClothing) {
    return "I am wearing the clothing from the user's uploaded image reference. Preserve its design while matching it naturally to my character appearance.";
  }
  if (constraints.wantsWear) {
    return `I am wearing ${outfit}.`;
  }
  if (hasUserImage) {
    return "I am creating a natural photo inspired by the user's uploaded image reference.";
  }
  return `I am creating a natural portrait photo. User request context: ${request || "none"}.`;
}

function assertRealChatImageProviderConfigured() {
  if (!isRealChatImageProviderConfigured()) {
    throwServiceError("图片生成服务未配置", 500);
  }
}

function safeText(value, maxLength) {
  return String(value == null ? "" : value).trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function throwServiceError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  throw error;
}
