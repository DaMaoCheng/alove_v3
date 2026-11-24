import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import sharp from "sharp";
import { CHAT_ATTACHMENT_UPLOAD_POLICY } from "./upload-policies.js";
import { extractFileName } from "./protected-upload-url-service.js";
import { normalizeContentType, validateUploadForPolicy } from "./upload-security.js";
import { parseJsonValue } from "./chat-message-payload-utils.js";

const MAX_VISION_INPUTS = 3;
const MAX_SOURCE_IMAGE_BYTES = 12 * 1024 * 1024;
const VISION_IMAGE_MAX_EDGE = 1024;
const VISION_IMAGE_ALLOWED_TYPES = Object.freeze({
  "image/jpeg": { extension: ".jpg", extensions: [".jpg", ".jpeg", ".jfif"], kind: "image" },
  "image/png": { extension: ".png", extensions: [".png"], kind: "image" },
  "image/webp": { extension: ".webp", extensions: [".webp"], kind: "image" },
  "image/gif": { extension: ".gif", extensions: [".gif"], kind: "image" },
});

export async function collectVisionInputsForMessages(messages = []) {
  const attachments = (Array.isArray(messages) ? messages : [])
    .map((message) => {
      if (message?.content_type !== "attachment") return null;
      return parseJsonValue(message.product_payload_json, null);
    })
    .filter((attachment) => attachment?.kind === "image")
    .slice(0, MAX_VISION_INPUTS);

  const inputs = [];
  for (const attachment of attachments) {
    const input = await buildVisionInputFromAttachment(attachment);
    if (input) inputs.push(input);
  }
  return inputs;
}

export async function collectVisionInputsForAttachments(attachments = []) {
  const imageAttachments = (Array.isArray(attachments) ? attachments : [])
    .filter((attachment) => attachment?.kind === "image")
    .slice(0, MAX_VISION_INPUTS);

  const inputs = [];
  for (const attachment of imageAttachments) {
    const input = await buildVisionInputFromAttachment(attachment);
    if (input) inputs.push(input);
  }
  return inputs;
}

async function buildVisionInputFromAttachment(attachment) {
  const fileName = extractFileName(attachment.storedName || attachment.url);
  if (!fileName) return null;
  const filePath = resolve(CHAT_ATTACHMENT_UPLOAD_POLICY.uploadDir, fileName);
  if (!isWithinDirectory(filePath, CHAT_ATTACHMENT_UPLOAD_POLICY.uploadDir)) return null;

  const buffer = await readFile(filePath);
  const sourceType = normalizeContentType(attachment.mimeType || inferContentTypeFromFileName(fileName));
  validateUploadForPolicy({
    buffer,
    contentType: sourceType,
    uploadFilename: fileName,
    allowedTypes: VISION_IMAGE_ALLOWED_TYPES,
    maxBytes: MAX_SOURCE_IMAGE_BYTES,
    emptyMessage: "图片附件不能为空",
    tooLargeMessage: "图片附件过大",
    unsupportedMessage: "图片附件格式不支持",
  });

  const output = await sharp(buffer)
    .rotate()
    .resize(VISION_IMAGE_MAX_EDGE, VISION_IMAGE_MAX_EDGE, {
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();

  return {
    name: String(attachment.name || fileName).trim().slice(0, 160),
    mimeType: "image/jpeg",
    dataUrl: `data:image/jpeg;base64,${Buffer.from(output).toString("base64")}`,
  };
}

function inferContentTypeFromFileName(value = "") {
  const lower = String(value || "").toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg") || lower.endsWith(".jfif")) return "image/jpeg";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  return "";
}

function isWithinDirectory(filePath = "", directory = "") {
  const normalizedFile = resolve(filePath);
  const normalizedDir = resolve(directory);
  return normalizedFile === normalizedDir || normalizedFile.startsWith(`${normalizedDir}${sep}`);
}

// Reuse an actual recent attachment only for an independently classified visual
// inspection continuation. Ownership is established by this exact session join.
export async function collectGuestInspectionVisionInputs(db, { sessionId = '', guestSessionId = '', characterId = '',
  beforeDisplayOrder = 0, recentMessages = [], jevDecision = null, collect = collectVisionInputsForAttachments } = {}) {
  if (jevDecision?.ok !== true || jevDecision.imageIntent !== 'image_inspection'
    || !sessionId || !guestSessionId || !characterId || !(Number(beforeDisplayOrder) > 0)) return [];
  const recentUsers = recentMessages.filter(row => (row.senderType || row.sender_type) === 'user'
    && Number(row.displayOrder || row.display_order) > 0 && Number(row.displayOrder || row.display_order) < Number(beforeDisplayOrder)).slice(-3);
  if (!recentUsers.length) return [];
  const after = Math.min(...recentUsers.map(row => Number(row.displayOrder || row.display_order)));
  const [rows] = await db.execute(`SELECT m.product_payload_json
    FROM chat_messages m JOIN chat_sessions s ON s.id = m.session_id
    WHERE m.session_id = ? AND s.guest_session_id = ? AND m.character_id = ?
      AND m.sender_type = 'user' AND m.content_type = 'attachment'
      AND m.display_order >= ? AND m.display_order < ?
    ORDER BY m.display_order DESC, m.sent_at DESC LIMIT 1`,
    [sessionId, guestSessionId, characterId, after, Number(beforeDisplayOrder)]);
  const attachment = rows?.length ? parseJsonValue(rows[0].product_payload_json, null) : null;
  return attachment?.kind === 'image' ? collect([attachment]) : [];
}
