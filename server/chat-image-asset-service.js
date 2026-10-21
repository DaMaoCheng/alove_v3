import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { mkdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import sharp from "sharp";
import { validateUploadForPolicy } from "./upload-security.js";
import { CHAT_IMAGE_UPLOAD_POLICY } from "./upload-policies.js";
import { protectedChatImageUrl } from "./protected-upload-url-service.js";

const CHAT_IMAGE_WIDTH = 1024;
const CHAT_IMAGE_HEIGHT = 1792;

export async function saveMockChatImageAsset({ assetId = "" } = {}) {
  const buffer = await createMockImageBuffer(assetId);
  return saveGeneratedChatImageAsset({
    assetId,
    buffer,
    contentType: "image/webp",
    uploadFilename: "chat-image-mock.webp",
  });
}

export async function saveGeneratedChatImageAsset({
  assetId = "",
  buffer,
  contentType = "image/png",
  uploadFilename = "chat-image.png",
} = {}) {
  const normalizedAssetId = String(assetId || "").trim();
  if (!normalizedAssetId) throw new Error("Chat image asset id is required");
  const output = await sharp(buffer)
    .rotate()
    .resize(CHAT_IMAGE_WIDTH, CHAT_IMAGE_HEIGHT, {
      fit: "cover",
      position: "attention",
    })
    .webp({ quality: 82 })
    .toBuffer();
  const validation = validateUploadForPolicy({
    buffer: output,
    contentType: "image/webp",
    uploadFilename: uploadFilename.replace(/\.[^.]+$/, ".webp"),
    allowedTypes: CHAT_IMAGE_UPLOAD_POLICY.allowedTypes,
    maxBytes: CHAT_IMAGE_UPLOAD_POLICY.maxBytes,
    emptyMessage: "聊天图片不能为空",
    tooLargeMessage: "聊天图片过大",
    unsupportedMessage: "聊天图片格式不支持",
  });
  const storedName = getChatImageStorageName(normalizedAssetId);
  const temporaryName = getChatImageTemporaryStorageName(normalizedAssetId);
  await mkdir(CHAT_IMAGE_UPLOAD_POLICY.uploadDir, { recursive: true });
  try {
    await writeFile(join(CHAT_IMAGE_UPLOAD_POLICY.uploadDir, temporaryName), output);
    await rename(
      join(CHAT_IMAGE_UPLOAD_POLICY.uploadDir, temporaryName),
      join(CHAT_IMAGE_UPLOAD_POLICY.uploadDir, storedName)
    );
  } catch (error) {
    await unlink(join(CHAT_IMAGE_UPLOAD_POLICY.uploadDir, temporaryName)).catch(() => {});
    throw error;
  }

  return {
    storagePath: storedName,
    protectedPath: protectedChatImageUrl(storedName),
    width: CHAT_IMAGE_WIDTH,
    height: CHAT_IMAGE_HEIGHT,
    bytes: output.length,
    mimeType: validation.mimeType,
  };
}

export async function findRecoverableChatImageAsset({ assetId = "", storagePath = "" } = {}) {
  const normalizedAssetId = String(assetId || "").trim();
  if (!normalizedAssetId) return null;
  const expectedName = getChatImageStorageName(normalizedAssetId);
  const recordedName = basename(String(storagePath || "").trim());
  if (recordedName && recordedName !== expectedName) return null;
  const filePath = join(CHAT_IMAGE_UPLOAD_POLICY.uploadDir, expectedName);
  const temporaryPath = join(CHAT_IMAGE_UPLOAD_POLICY.uploadDir, getChatImageTemporaryStorageName(normalizedAssetId));
  try {
    let file;
    try {
      file = await stat(filePath);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      let temporaryFile;
      try {
        temporaryFile = await stat(temporaryPath);
      } catch (temporaryError) {
        if (temporaryError?.code === "ENOENT") return null;
        throw temporaryError;
      }
      if (!temporaryFile.isFile() || temporaryFile.size <= 0 || temporaryFile.size > CHAT_IMAGE_UPLOAD_POLICY.maxBytes) {
        await unlink(temporaryPath).catch(() => {});
        return null;
      }
      let temporaryMetadata;
      try {
        temporaryMetadata = await sharp(temporaryPath).metadata();
      } catch {
        await unlink(temporaryPath).catch(() => {});
        return null;
      }
      if (temporaryMetadata.format !== "webp") {
        await unlink(temporaryPath).catch(() => {});
        return null;
      }
      await rename(temporaryPath, filePath);
      file = await stat(filePath);
    }
    if (!file.isFile() || file.size <= 0 || file.size > CHAT_IMAGE_UPLOAD_POLICY.maxBytes) return null;
    const metadata = await sharp(filePath).metadata();
    if (metadata.format !== "webp") return null;
    return {
      storagePath: expectedName,
      protectedPath: protectedChatImageUrl(expectedName),
      width: Number(metadata.width || CHAT_IMAGE_WIDTH),
      height: Number(metadata.height || CHAT_IMAGE_HEIGHT),
      bytes: Number(file.size || 0),
      mimeType: "image/webp",
    };
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

export async function deleteStoredChatImageAsset({ assetId = "", storagePath = "" } = {}) {
  const normalizedAssetId = String(assetId || "").trim();
  const expectedName = normalizedAssetId ? getChatImageStorageName(normalizedAssetId) : "";
  const recordedName = basename(String(storagePath || "").trim());
  const fileName = recordedName || expectedName;
  if (!fileName || (expectedName && fileName !== expectedName)) return false;
  let deleted = false;
  for (const targetName of [fileName, normalizedAssetId ? getChatImageTemporaryStorageName(normalizedAssetId) : ""]) {
    if (!targetName) continue;
    try {
      await unlink(join(CHAT_IMAGE_UPLOAD_POLICY.uploadDir, targetName));
      deleted = true;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  return deleted;
}

export function getChatImageStorageName(assetId = "") {
  const normalizedAssetId = String(assetId || "").trim();
  if (!normalizedAssetId) return "";
  const digest = createHash("sha256").update(normalizedAssetId).digest("hex").slice(0, 32);
  return `${CHAT_IMAGE_UPLOAD_POLICY.fileNamePrefix}-${digest}.webp`;
}

export function getChatImageTemporaryStorageName(assetId = "") {
  const storedName = getChatImageStorageName(assetId);
  return storedName ? `.${storedName}.tmp` : "";
}

async function createMockImageBuffer(assetId = "") {
  const label = escapeSvgText(String(assetId || "mock").slice(0, 28));
  const svg = `
    <svg width="${CHAT_IMAGE_WIDTH}" height="${CHAT_IMAGE_HEIGHT}" viewBox="0 0 ${CHAT_IMAGE_WIDTH} ${CHAT_IMAGE_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stop-color="#0c1210"/>
          <stop offset="0.54" stop-color="#10251a"/>
          <stop offset="1" stop-color="#06100b"/>
        </linearGradient>
        <radialGradient id="glow" cx="48%" cy="42%" r="48%">
          <stop offset="0" stop-color="#16f26f" stop-opacity="0.55"/>
          <stop offset="1" stop-color="#16f26f" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#bg)"/>
      <rect x="0" y="0" width="100%" height="100%" fill="url(#glow)"/>
      <circle cx="512" cy="610" r="158" fill="#19ef72" opacity="0.18"/>
      <circle cx="512" cy="610" r="132" fill="#17231e" stroke="#15f26f" stroke-width="8"/>
      <path d="M374 1035 C448 912 570 912 650 1035 L696 1270 H330 Z" fill="#16221d" stroke="#2ff486" stroke-width="6" opacity="0.9"/>
      <text x="512" y="860" text-anchor="middle" fill="#f4fff8" font-family="Arial, Helvetica, sans-serif" font-size="58" font-weight="700">AIOVE</text>
      <text x="512" y="934" text-anchor="middle" fill="#9beab9" font-family="Arial, Helvetica, sans-serif" font-size="34">mock chat photo</text>
      <text x="512" y="1555" text-anchor="middle" fill="#6bbf86" font-family="Arial, Helvetica, sans-serif" font-size="24">${label}</text>
    </svg>
  `;
  return sharp(Buffer.from(svg)).webp({ quality: 76 }).toBuffer();
}

function escapeSvgText(value = "") {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
