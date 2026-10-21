import sharp from "sharp";
import { randomInt } from "node:crypto";
import { createId } from "./security.js";
import { getDbPool, withTransaction } from "./db.js";
import { requestGeneratedImage, isImageGenerationConfigured } from "./image-generation-provider-service.js";
import { collectChatImageReferenceImages } from "./chat-image-reference-material-service.js";
import { saveValidatedUpload, validateUploadForPolicy } from "./upload-security.js";
import { MASCOT_GREETING_IMAGE_UPLOAD_POLICY, MASCOT_GREETING_VIDEO_UPLOAD_POLICY } from "./upload-policies.js";
import { compressMascotGreetingVideo } from "./mascot-greeting-video-compression-service.js";
import { insertMessage, getNextMessageOrder } from "./chat-message-store.js";

export const MASCOT_GREETING_IMAGE_SLOT_COUNT = 5;
export const MASCOT_GREETING_VIDEO_SLOT_INDEX = 5;

export async function listMascotGreetingImages(characterId = "") {
  const mascot = await findMascot(getDbPool(), characterId);
  const [rows] = await getDbPool().execute(
    `SELECT id, character_id, slot_index, image_url, generation_status, source_type, prompt_summary, created_at, updated_at
       FROM mascot_greeting_images
      WHERE character_id = ?
      ORDER BY slot_index ASC`,
    [mascot.id]
  );
  return {
    ok: true,
    characterId: mascot.id,
    items: fillGreetingSlots(rows),
  };
}

export async function uploadMascotGreetingImage({ characterId = "", slotIndex = 0, buffer, contentType = "", filename = "" } = {}) {
  const mascot = await findMascot(getDbPool(), characterId);
  const slot = normalizeSlotIndex(slotIndex);
  const saved = slot === MASCOT_GREETING_VIDEO_SLOT_INDEX
    ? await saveGreetingVideo({ buffer, contentType, filename })
    : await saveGreetingImage({ buffer, contentType, filename });
  return saveGreetingSlot({ mascot, slot, imageUrl: saved.url, sourceType: "upload", promptSummary: "" });
}

export async function generateMascotGreetingImage({ characterId = "", slotIndex = 0 } = {}) {
  const mascot = await findMascot(getDbPool(), characterId);
  const slot = normalizeSlotIndex(slotIndex);
  if (slot === MASCOT_GREETING_VIDEO_SLOT_INDEX) {
    throwServiceError("问候视频槽位只支持管理员上传 MP4 视频", 400);
  }
  if (!isImageGenerationConfigured()) throwServiceError("图片生成服务未配置", 500);
  const prompt = buildMascotGreetingImagePrompt(mascot);
  const referenceImages = mascot.avatar_url
    ? await collectChatImageReferenceImages({ character: mascot })
    : [];
  const generated = await requestGeneratedImage(prompt, {
    count: 1,
    filenamePrefix: `mascot-greeting-${mascot.id}-${slot}`,
    referenceImages,
  });
  const saved = await saveGreetingImage({
    buffer: generated.buffer,
    contentType: generated.contentType,
    filename: generated.filename || `mascot-greeting-${slot}.png`,
    generated: true,
  });
  return saveGreetingSlot({
    mascot,
    slot,
    imageUrl: saved.url,
    sourceType: "ai",
    promptSummary: summarizePrompt(prompt),
  });
}

export async function deleteMascotGreetingImage({ characterId = "", slotIndex = 0 } = {}) {
  const mascot = await findMascot(getDbPool(), characterId);
  const slot = normalizeSlotIndex(slotIndex);
  await getDbPool().execute(
    "DELETE FROM mascot_greeting_images WHERE character_id = ? AND slot_index = ?",
    [mascot.id, slot]
  );
  return { ok: true, characterId: mascot.id, item: emptyGreetingSlot(slot) };
}

export async function ensureMascotGreetingImageMessageForSession(db, {
  sessionId = "",
  guestSessionId = "",
  character = {},
} = {}) {
  const normalizedSessionId = String(sessionId || "").trim();
  const characterId = String(character?.id || character?.character_id || "").trim();
  if (!normalizedSessionId || !characterId || String(character?.category_id || character?.categoryId || "").trim() !== "mascot") return null;

  // The caller owns the surrounding transaction. Claiming the session before
  // creating a message makes two first-load requests deterministic: only the
  // transaction that wins this unique row may create the greeting image.
  const [claim] = await db.execute(
    "INSERT IGNORE INTO mascot_greeting_message_deliveries (session_id, message_id, image_id) VALUES (?, NULL, NULL)",
    [normalizedSessionId]
  );
  if (!claim.affectedRows) {
    const [deliveryRows] = await db.execute(
      "SELECT message_id FROM mascot_greeting_message_deliveries WHERE session_id = ? LIMIT 1",
      [normalizedSessionId]
    );
    return deliveryRows[0]?.message_id || null;
  }

  const [videoRows] = await db.execute(
    `SELECT id, image_url, slot_index
       FROM mascot_greeting_images
      WHERE character_id = ? AND generation_status = 'ready' AND image_url IS NOT NULL AND image_url <> ''
        AND slot_index = 5
        AND LOWER(image_url) LIKE '%.mp4'
      LIMIT 1`,
    [characterId]
  );
  let image = videoRows[0] || null;
  if (!image) {
    const [imageRows] = await db.execute(
      `SELECT id, image_url, slot_index
         FROM mascot_greeting_images
        WHERE character_id = ? AND generation_status = 'ready' AND image_url IS NOT NULL AND image_url <> ''
          AND slot_index BETWEEN 1 AND 4
          AND (
            LOWER(image_url) LIKE '%.webp'
            OR LOWER(image_url) LIKE '%.png'
            OR LOWER(image_url) LIKE '%.jpg'
            OR LOWER(image_url) LIKE '%.jpeg'
          )
        ORDER BY slot_index ASC`,
      [characterId]
    );
    image = imageRows.length ? imageRows[randomInt(imageRows.length)] : null;
  }
  if (!image) {
    return null;
  }
  const mediaType = Number(image.slot_index || 0) === MASCOT_GREETING_VIDEO_SLOT_INDEX ? "video" : "image";

  const { insertMessage, getNextMessageOrder } = await import("./chat-message-store.js");
  const [openingRows] = await db.execute(
    "SELECT MIN(display_order) AS first_order FROM chat_messages WHERE session_id = ? AND source_ref = 'opening-line' LIMIT 1",
    [normalizedSessionId]
  );
  const firstOrder = Number(openingRows[0]?.first_order || 0);
  const message = await insertMessage(db, {
    sessionId: normalizedSessionId,
    guestSessionId: String(guestSessionId || "").trim(),
    characterId,
    senderType: "character",
    senderLabel: String(character?.name || "AIOVE Character").trim() || "AIOVE Character",
    contentType: "mascot_greeting_image",
    text: "",
    product: {
      imageId: image.id,
      imageUrl: image.image_url,
      slotIndex: Number(image.slot_index || 0),
      mediaType,
      mimeType: mediaType === "video" ? "video/mp4" : "image/webp",
      publicGreetingMedia: true,
      publicGreetingImage: mediaType === "image",
    },
    displayOrder: firstOrder ? firstOrder - 5 : await getNextMessageOrder(db, normalizedSessionId),
    sourceType: "system",
    sourceRef: `mascot-greeting-image:${image.id}`,
  });
  await db.execute(
    "UPDATE mascot_greeting_message_deliveries SET message_id = ?, image_id = ? WHERE session_id = ?",
    [message.id, image.id, normalizedSessionId]
  );
  return message.id;
}

export async function createMascotLibraryImageMessage(db, { sessionId = "", guestSessionId = "", character = {} } = {}) {
  const sid = String(sessionId || "").trim();
  const characterId = String(character?.id || character?.character_id || "").trim();
  if (!sid || !characterId) return null;
  const [rows] = await db.execute(
    `SELECT id, image_url, slot_index FROM mascot_greeting_images
      WHERE character_id = ? AND generation_status = 'ready' AND slot_index BETWEEN 1 AND 5
        AND image_url IS NOT NULL AND image_url <> '' AND LOWER(image_url) NOT LIKE '%.mp4'
        AND NOT EXISTS (
          SELECT 1 FROM chat_messages sent
           WHERE sent.session_id = ?
             AND sent.content_type IN ('mascot_greeting_image', 'mascot_library_image')
             AND sent.source_ref IN (
               CONCAT('mascot-greeting-image:', mascot_greeting_images.id),
               CONCAT('mascot-library-image:', mascot_greeting_images.id)
             )
        )
      ORDER BY slot_index ASC LIMIT 1`, [characterId, sid]);
  const image = rows?.[0];
  if (!image) return null;
  const message = await insertMessage(db, {
    sessionId: sid, guestSessionId, characterId, senderType: "character",
    senderLabel: String(character?.name || "AIOVE Character"), contentType: "mascot_library_image", text: "",
    product: { imageId: image.id, imageUrl: image.image_url, slotIndex: Number(image.slot_index), mediaType: "image", mimeType: "image/webp", publicGreetingImage: true },
    displayOrder: await getNextMessageOrder(db, sid), sourceType: "system", sourceRef: `mascot-library-image:${image.id}`,
  });
  return message;
}

export function buildMascotGreetingImagePrompt(mascot = {}) {
  const name = safeText(mascot.name, 96);
  const roleTitle = safeText(mascot.role_title || mascot.roleTitle, 128);
  const persona = safeText(mascot.persona_prompt || mascot.personaPrompt || mascot.speaking_style || mascot.speakingStyle, 1000);
  const openingLine = safeText(mascot.opening_line || mascot.openingLine, 512);
  return [
    "Create one pre-generated welcome photo for an adult virtual front-desk character in a football community app.",
    "Vertical 9:16 mobile photo. One adult subject only. Natural, friendly, candid and conversational; no text, watermark, collage, logo, poster design, duplicate people or minors.",
    "The result is a reusable welcome gallery image, not an app profile avatar and not a product advertisement.",
    name ? `Character name: ${name}.` : "",
    roleTitle ? `Role: ${roleTitle}.` : "",
    persona ? `Persona and visual mood: ${persona}.` : "",
    openingLine ? `Welcome mood reference: ${openingLine}.` : "",
    "Keep the same person and visual identity as the supplied character reference image when one is provided.",
  ].filter(Boolean).join("\n\n");
}

async function findMascot(db, characterId = "") {
  const normalizedId = String(characterId || "").trim();
  if (!normalizedId) throwServiceError("前台角色不能为空", 400);
  const [rows] = await db.execute(
    `SELECT id, name, avatar_url, category_id, character_status, role_title, persona_prompt, speaking_style, opening_line
       FROM ai_characters
      WHERE id = ?
      LIMIT 1`,
    [normalizedId]
  );
  const mascot = rows[0] || null;
  if (!mascot || mascot.category_id !== "mascot" || mascot.character_status !== "published") {
    throwServiceError("前台角色不存在或不可用", 404);
  }
  return mascot;
}

function normalizeSlotIndex(value) {
  const slot = Number.parseInt(value, 10);
  if (!Number.isInteger(slot) || slot < 1 || slot > MASCOT_GREETING_IMAGE_SLOT_COUNT) {
    throwServiceError(`图片槽位必须是 1-${MASCOT_GREETING_IMAGE_SLOT_COUNT}`, 400);
  }
  return slot;
}

async function saveGreetingImage({ buffer, contentType, filename, generated = false }) {
  if (!generated) {
    validateUploadForPolicy({
      buffer,
      contentType,
      uploadFilename: filename,
      allowedTypes: MASCOT_GREETING_IMAGE_UPLOAD_POLICY.allowedTypes,
      maxBytes: MASCOT_GREETING_IMAGE_UPLOAD_POLICY.maxBytes,
      emptyMessage: "问候图片不能为空",
      tooLargeMessage: "问候图片过大，请压缩后重试",
      unsupportedMessage: "问候图片格式不支持，请使用 JPG、PNG 或 WebP",
    });
  }
  const normalizedBuffer = await transcodeGreetingImageToWebp(buffer);
  return saveValidatedUpload({
    buffer: normalizedBuffer,
    contentType: "image/webp",
    uploadFilename: replaceFileExtension(filename, ".webp"),
    uploadDir: MASCOT_GREETING_IMAGE_UPLOAD_POLICY.uploadDir,
    publicPath: MASCOT_GREETING_IMAGE_UPLOAD_POLICY.publicPath,
    allowedTypes: MASCOT_GREETING_IMAGE_UPLOAD_POLICY.allowedTypes,
    maxBytes: MASCOT_GREETING_IMAGE_UPLOAD_POLICY.generatedMaxBytes,
    fileNamePrefix: MASCOT_GREETING_IMAGE_UPLOAD_POLICY.fileNamePrefix,
    emptyMessage: "问候图片不能为空",
    tooLargeMessage: "问候图片过大，请压缩后重试",
    unsupportedMessage: "问候图片格式不支持，请使用 JPG、PNG 或 WebP",
  });
}

async function saveGreetingVideo({ buffer, contentType, filename }) {
  validateUploadForPolicy({
    buffer,
    contentType,
    uploadFilename: filename,
    allowedTypes: MASCOT_GREETING_VIDEO_UPLOAD_POLICY.allowedTypes,
    maxBytes: MASCOT_GREETING_VIDEO_UPLOAD_POLICY.maxBytes,
    emptyMessage: "问候视频不能为空",
    tooLargeMessage: "问候视频过大，请压缩到 30MB 以内后重试",
    unsupportedMessage: "问候视频格式不支持，请使用 MP4",
  });
  const compressedBuffer = await compressMascotGreetingVideo(buffer);
  return saveValidatedUpload({
    buffer: compressedBuffer,
    contentType: "video/mp4",
    uploadFilename: replaceFileExtension(filename, ".mp4"),
    uploadDir: MASCOT_GREETING_VIDEO_UPLOAD_POLICY.uploadDir,
    publicPath: MASCOT_GREETING_VIDEO_UPLOAD_POLICY.publicPath,
    allowedTypes: MASCOT_GREETING_VIDEO_UPLOAD_POLICY.allowedTypes,
    maxBytes: MASCOT_GREETING_VIDEO_UPLOAD_POLICY.maxBytes,
    fileNamePrefix: MASCOT_GREETING_VIDEO_UPLOAD_POLICY.fileNamePrefix,
    emptyMessage: "问候视频不能为空",
    tooLargeMessage: "问候视频过大，请压缩到 30MB 以内后重试",
    unsupportedMessage: "问候视频格式不支持，请使用 MP4",
  });
}

async function transcodeGreetingImageToWebp(buffer) {
  try {
    return await sharp(buffer)
      .rotate()
      .resize(1024, 1792, { fit: "cover", position: "attention", withoutEnlargement: true })
      .webp({ quality: 84 })
      .toBuffer();
  } catch {
    throwServiceError("问候图片处理失败，请上传有效的 JPG、PNG 或 WebP 图片", 400);
  }
}

async function saveGreetingSlot({ mascot, slot, imageUrl, sourceType, promptSummary }) {
  const itemId = await withTransaction(async (db) => {
    const [existingRows] = await db.execute(
      "SELECT id FROM mascot_greeting_images WHERE character_id = ? AND slot_index = ? LIMIT 1 FOR UPDATE",
      [mascot.id, slot]
    );
    const id = existingRows[0]?.id || createId("mascot_greeting");
    await db.execute(
      `INSERT INTO mascot_greeting_images (id, character_id, slot_index, image_url, generation_status, source_type, prompt_summary)
       VALUES (?, ?, ?, ?, 'ready', ?, ?)
       ON DUPLICATE KEY UPDATE image_url = VALUES(image_url), generation_status = 'ready', source_type = VALUES(source_type), prompt_summary = VALUES(prompt_summary), updated_at = NOW(3)`,
      [id, mascot.id, slot, imageUrl, sourceType, promptSummary || null]
    );
    return id;
  });
  return {
    ok: true,
    characterId: mascot.id,
    item: {
      id: itemId,
      slotIndex: slot,
      imageUrl,
      mediaType: mediaTypeForSlot(slot, imageUrl),
      mimeType: mediaTypeForSlot(slot, imageUrl) === "video" ? "video/mp4" : "image/webp",
      status: "ready",
      sourceType,
      promptSummary: promptSummary || "",
    },
  };
}

function fillGreetingSlots(rows = []) {
  const bySlot = new Map(rows.map((row) => [Number(row.slot_index || 0), row]));
  return Array.from({ length: MASCOT_GREETING_IMAGE_SLOT_COUNT }, (_, index) => {
    const slot = index + 1;
    const row = bySlot.get(slot);
    return row
      ? {
          id: row.id,
          slotIndex: slot,
          imageUrl: row.image_url || "",
          mediaType: mediaTypeForSlot(slot, row.image_url),
          mimeType: mediaTypeForSlot(slot, row.image_url) === "video" ? "video/mp4" : "image/webp",
          status: row.generation_status || "empty",
          sourceType: row.source_type || "manual",
          promptSummary: row.prompt_summary || "",
          createdAt: row.created_at || null,
          updatedAt: row.updated_at || null,
        }
      : emptyGreetingSlot(slot);
  });
}

function emptyGreetingSlot(slotIndex) {
  const mediaType = Number(slotIndex) === MASCOT_GREETING_VIDEO_SLOT_INDEX ? "video" : "image";
  return { id: "", slotIndex, imageUrl: "", mediaType, mimeType: mediaType === "video" ? "video/mp4" : "image/webp", status: "empty", sourceType: "", promptSummary: "", createdAt: null, updatedAt: null };
}

function mediaTypeForSlot(slotIndex, mediaUrl = "") {
  if (Number(slotIndex) === MASCOT_GREETING_VIDEO_SLOT_INDEX && /\.mp4$/i.test(String(mediaUrl || "").trim())) return "video";
  return "image";
}

function summarizePrompt(value = "") {
  return safeText(value, 500);
}

function safeText(value, maxLength) {
  return String(value == null ? "" : value).trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function replaceFileExtension(value = "", extension = ".webp") {
  const name = String(value || "mascot-greeting").replace(/[^a-z0-9._-]/gi, "-");
  return `${name.replace(/\.[^.]+$/, "")}${extension}`;
}

function throwServiceError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  throw error;
}
