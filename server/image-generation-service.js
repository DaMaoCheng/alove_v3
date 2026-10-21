import { saveValidatedUpload } from "./upload-security.js";
import { AVATAR_UPLOAD_POLICY } from "./upload-policies.js";
import { getCompressedAvatarFilename, prepareGeneratedAvatarBuffer } from "./upload-service.js";
import { isImageGenerationConfigured, requestGeneratedImage } from "./image-generation-provider-service.js";

const DEFAULT_IMAGE_PROMPT = [
  "Create a portrait-style character image for an adult AI companion profile.",
  "Use a vertical 9:16 composition.",
  "The subject must be an adult.",
  "Photorealistic, natural light, shallow depth of field, premium mobile photo look.",
  "No watermark, no text, no collage, no duplicate people, no extra fingers, no minors.",
].join(" ");
const FIXED_IMAGE_STYLE_PROMPT = [
  "Overall style: ultra-realistic, raw original-photo texture, vertical 9:16 composition.",
  "Shot as if on an iPhone 15 Pro Max wide-angle lens, 24mm, f/1.8, with shallow depth of field.",
  "Use candid street-photography framing, natural light, a subtly blurred background, and clear separation around one adult subject.",
  "No watermark, no text, no logo, no poster design, no minors.",
].join(" ");
const AVATAR_GENERATION_MAX_ATTEMPTS = 2;

export async function generateCharacterAvatarImage({ userId = "", payload = {} } = {}) {
  assertImageGenerationConfigured();
  const prompt = buildCharacterAvatarPrompt(payload);
  const generated = await requestGeneratedAvatarImage(prompt);
  const compressedBuffer = await prepareGeneratedAvatarBuffer(generated.buffer);
  const saved = await saveValidatedUpload({
    buffer: compressedBuffer,
    contentType: "image/webp",
    uploadFilename: getCompressedAvatarFilename("avatar-ai"),
    uploadDir: AVATAR_UPLOAD_POLICY.uploadDir,
    publicPath: AVATAR_UPLOAD_POLICY.publicPath,
    allowedTypes: AVATAR_UPLOAD_POLICY.allowedTypes,
    maxBytes: AVATAR_UPLOAD_POLICY.generatedMaxBytes || AVATAR_UPLOAD_POLICY.maxBytes,
    fileNamePrefix: "avatar-ai",
    emptyMessage: "AI 头像生成结果为空",
    tooLargeMessage: "AI 头像结果过大，请稍后重试",
    unsupportedMessage: "AI 头像格式不支持",
  });

  return {
    ok: true,
    avatarUrl: saved.url,
    bytes: saved.size,
    contentType: saved.mimeType,
    sha256: saved.sha256,
    uploadedBy: String(userId || "").trim(),
    prompt,
  };
}

async function requestGeneratedAvatarImage(prompt) {
  let lastError = null;
  for (let attempt = 1; attempt <= AVATAR_GENERATION_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await requestGeneratedImage(prompt);
    } catch (error) {
      lastError = error;
      if (attempt >= AVATAR_GENERATION_MAX_ATTEMPTS) break;
    }
  }
  throw lastError || new Error("AI 头像生成失败");
}

export function buildCharacterAvatarPrompt(payload = {}) {
  const name = safeText(payload.name, 96);
  const category = safeText(payload.category || payload.categoryLabel || payload.categoryId, 96);
  const personality = safeText(payload.personality || payload.vibe, 128);
  const voice = safeText(payload.voice || payload.voiceStyle, 128);
  const language = safeText(payload.language, 128);
  const openingLine = safeText(payload.openingLine, 320);
  const backstory = safeText(payload.backstory, 1600);

  return [
    DEFAULT_IMAGE_PROMPT,
    name ? `Character name: ${name}.` : "",
    category ? `Category: ${category}.` : "",
    personality ? `Personality: ${personality}.` : "",
    voice ? `Voice style: ${voice}.` : "",
    language ? `Default language: ${language}.` : "",
    openingLine ? `Opening line mood reference: ${openingLine}.` : "",
    backstory ? `Background and visual cues: ${backstory}` : "",
    "Produce a single portrait suitable for an app avatar source image. Frame one adult person only, centered, with clean separation from the background.",
    FIXED_IMAGE_STYLE_PROMPT,
  ].filter(Boolean).join("\n\n");
}

function assertImageGenerationConfigured() {
  if (!isImageGenerationConfigured()) {
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
