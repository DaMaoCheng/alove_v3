import { rm } from "node:fs/promises";
import { basename, join } from "node:path";
import sharp from "sharp";
import { saveValidatedUpload } from "./upload-security.js";
import { AVATAR_UPLOAD_POLICY, CAROUSEL_UPLOAD_POLICY } from "./upload-policies.js";

export async function saveAvatarUpload({ userId = "", buffer, contentType = "", filename = "" } = {}) {
  const saved = await saveValidatedUpload({
    buffer,
    contentType,
    uploadFilename: filename,
    uploadDir: AVATAR_UPLOAD_POLICY.uploadDir,
    publicPath: AVATAR_UPLOAD_POLICY.publicPath,
    allowedTypes: AVATAR_UPLOAD_POLICY.allowedTypes,
    maxBytes: AVATAR_UPLOAD_POLICY.maxBytes,
    fileNamePrefix: AVATAR_UPLOAD_POLICY.fileNamePrefix,
    emptyMessage: "头像文件不能为空",
    tooLargeMessage: "头像文件过大，请压缩后重试",
    unsupportedMessage: "头像格式不支持，请使用 JPG、PNG 或 WebP",
  });

  return {
    ok: true,
    avatarUrl: saved.url,
    bytes: saved.size,
    contentType: saved.mimeType,
    sha256: saved.sha256,
    uploadedBy: String(userId || "").trim(),
  };
}

export async function saveCarouselUpload({ userId = "", buffer, contentType = "", filename = "" } = {}) {
  const saved = await saveValidatedUpload({
    buffer,
    contentType,
    uploadFilename: filename,
    uploadDir: CAROUSEL_UPLOAD_POLICY.uploadDir,
    publicPath: CAROUSEL_UPLOAD_POLICY.publicPath,
    allowedTypes: CAROUSEL_UPLOAD_POLICY.allowedTypes,
    maxBytes: CAROUSEL_UPLOAD_POLICY.maxBytes,
    fileNamePrefix: CAROUSEL_UPLOAD_POLICY.fileNamePrefix,
    emptyMessage: "轮播图片不能为空",
    tooLargeMessage: "轮播图片过大，请压缩后重试",
    unsupportedMessage: "轮播图片格式不支持，请使用 JPG、PNG 或 WebP",
  });

  return {
    ok: true,
    imageUrl: saved.url,
    bytes: saved.size,
    contentType: saved.mimeType,
    sha256: saved.sha256,
    uploadedBy: String(userId || "").trim(),
  };
}

export async function deleteTemporaryAvatar({ avatarUrl = "" } = {}) {
  const normalizedUrl = String(avatarUrl || "").trim();
  if (!normalizedUrl.startsWith(`${AVATAR_UPLOAD_POLICY.publicPath}/`)) {
    throwUploadError("头像地址无效", 400);
  }

  const fileName = basename(normalizedUrl);
  if (!fileName || fileName !== normalizedUrl.slice(`${AVATAR_UPLOAD_POLICY.publicPath}/`.length)) {
    throwUploadError("头像地址无效", 400);
  }

  await rm(join(AVATAR_UPLOAD_POLICY.uploadDir, fileName), { force: true });
  return { ok: true, deleted: true };
}

export async function prepareGeneratedAvatarBuffer(buffer) {
  return sharp(buffer)
    .rotate()
    .resize({ width: 1024, height: 1792, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 86 })
    .toBuffer();
}

export function getCompressedAvatarFilename(prefix = "avatar") {
  return `${String(prefix || "avatar").replace(/[^a-z0-9-]/gi, "-")}-${Date.now()}.webp`;
}

function throwUploadError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  throw error;
}
