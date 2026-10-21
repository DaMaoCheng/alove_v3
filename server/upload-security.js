import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, extname, join } from "node:path";
import { createPublicError } from "./public-error-utils.js";
import { createId } from "./security.js";

const EXECUTABLE_SIGNATURES = Object.freeze([
  Buffer.from([0x4d, 0x5a]), // MZ
  Buffer.from([0x7f, 0x45, 0x4c, 0x46]), // ELF
  Buffer.from([0xcf, 0xfa, 0xed, 0xfe]), // Mach-O
  Buffer.from([0xce, 0xfa, 0xed, 0xfe]), // Mach-O
  Buffer.from([0xca, 0xfe, 0xba, 0xbe]), // Fat binary / class-like marker
]);

export function normalizeContentType(value) {
  return String(value || "").split(";")[0].trim().toLowerCase();
}

export function sanitizeOriginalFilename(filename) {
  const raw = basename(String(filename || "").trim().replace(/\0/g, ""));
  return raw.replace(/\s+/g, " ").slice(0, 120);
}

export async function saveValidatedUpload({
  buffer,
  contentType = "",
  uploadFilename = "",
  uploadDir,
  publicPath,
  allowedTypes,
  maxBytes,
  fileNamePrefix,
  deterministicNameBase = "",
  emptyMessage = "文件不能为空",
  tooLargeMessage = "文件过大，请压缩后重试",
  unsupportedMessage = "文件格式不支持",
} = {}) {
  const validation = validateUploadForPolicy({
    buffer,
    contentType,
    uploadFilename,
    allowedTypes,
    maxBytes,
    emptyMessage,
    tooLargeMessage,
    unsupportedMessage,
  });

  const sha256 = createHash("sha256").update(buffer).digest("hex");
  const normalizedDeterministicBase = String(deterministicNameBase || "").trim();
  if (normalizedDeterministicBase && !/^[a-zA-Z0-9_-]+$/.test(normalizedDeterministicBase)) {
    throwUploadError("文件存储名称无效", 400);
  }
  const storedName = normalizedDeterministicBase
    ? `${normalizedDeterministicBase}${validation.allowed.extension}`
    : `${fileNamePrefix || validation.allowed.kind || "file"}-${sha256.slice(0, 16)}-${createId("file")}${validation.allowed.extension}`;
  await mkdir(uploadDir, { recursive: true });
  await writeFile(join(uploadDir, storedName), buffer);

  return {
    allowed: validation.allowed,
    mimeType: validation.mimeType,
    sha256,
    storedName,
    url: `${String(publicPath || "").replace(/\/+$/, "")}/${storedName}`,
    size: buffer.length,
  };
}

export function validateUploadForPolicy({
  buffer,
  contentType = "",
  uploadFilename = "",
  allowedTypes,
  maxBytes,
  emptyMessage = "文件不能为空",
  tooLargeMessage = "文件过大，请压缩后重试",
  unsupportedMessage = "文件格式不支持",
} = {}) {
  validateUploadBuffer({ buffer, maxBytes, emptyMessage, tooLargeMessage });

  const normalizedType = normalizeContentType(contentType);
  const allowed = allowedTypes?.[normalizedType] || null;
  if (!allowed) {
    throwUploadError(unsupportedMessage, 400);
  }

  const safeUploadName = sanitizeOriginalFilename(uploadFilename) || `upload${allowed.extension}`;
  validateExtension(safeUploadName, allowed.extensions || [allowed.extension]);
  validateUnsafeSignature(buffer);
  if (allowed.kind === "image") {
    validateImageSignature(buffer, normalizedType);
  } else if (allowed.kind === "voice") {
    validateAudioSignature(buffer, normalizedType);
  } else if (allowed.kind === "video") {
    validateVideoSignature(buffer, normalizedType);
  } else if (normalizedType === "application/pdf") {
    validatePdfSignature(buffer);
  }

  return {
    allowed,
    mimeType: normalizedType,
    safeUploadName,
    size: buffer.length,
  };
}

function validateUploadBuffer({ buffer, maxBytes, emptyMessage, tooLargeMessage }) {
  if (!buffer || !Buffer.isBuffer(buffer) || !buffer.length) {
    throwUploadError(emptyMessage, 400);
  }

  if (buffer.length > Number(maxBytes || 0)) {
    throwUploadError(tooLargeMessage, 413);
  }

  if (buffer.length < 4) {
    throwUploadError("文件内容无效", 400);
  }
}

function validateExtension(filename, expectedExtensions) {
  const actualExtension = extname(String(filename || "").trim()).toLowerCase();
  if ((expectedExtensions || []).includes(actualExtension)) return;
  throwUploadError("文件扩展名与文件类型不匹配", 400);
}

function validateUnsafeSignature(buffer) {
  if (!EXECUTABLE_SIGNATURES.some((signature) => buffer.subarray(0, signature.length).equals(signature))) return;
  throwUploadError("检测到不安全文件，已拒绝上传", 400);
}

function validatePdfSignature(buffer) {
  if (buffer.subarray(0, 5).equals(Buffer.from("%PDF-"))) return;
  throwUploadError("PDF 文件内容校验失败", 400);
}

function validateImageSignature(buffer, normalizedType) {
  if (normalizedType === "image/jpeg" && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return;
  if (normalizedType === "image/png" && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return;
  if (normalizedType === "image/gif" && (buffer.subarray(0, 6).equals(Buffer.from("GIF87a")) || buffer.subarray(0, 6).equals(Buffer.from("GIF89a")))) return;
  if (normalizedType === "image/webp" && buffer.subarray(0, 4).equals(Buffer.from("RIFF")) && buffer.subarray(8, 12).equals(Buffer.from("WEBP"))) return;
  throwUploadError("图片文件内容校验失败", 400);
}

function validateAudioSignature(buffer, normalizedType) {
  if (normalizedType === "audio/webm" && isWebmSignature(buffer)) return;
  if (normalizedType === "audio/ogg" && buffer.subarray(0, 4).equals(Buffer.from("OggS"))) return;
  if (normalizedType === "audio/mpeg" && isMp3Signature(buffer)) return;
  if ((normalizedType === "audio/wav" || normalizedType === "audio/x-wav") && isWavSignature(buffer)) return;
  if ((normalizedType === "audio/mp4" || normalizedType === "audio/x-m4a" || normalizedType === "video/mp4") && isMp4AudioSignature(buffer)) return;
  throwUploadError("音频文件内容校验失败", 400);
}

function validateVideoSignature(buffer, normalizedType) {
  if (normalizedType === "video/mp4" && isIsoBmffSignature(buffer)) return;
  throwUploadError("视频文件内容校验失败", 400);
}

function isWebmSignature(buffer) {
  return buffer.length >= 4 && buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3;
}

function isMp3Signature(buffer) {
  if (buffer.subarray(0, 3).equals(Buffer.from("ID3"))) return true;
  return buffer.length >= 2 && buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0;
}

function isWavSignature(buffer) {
  return buffer.subarray(0, 4).equals(Buffer.from("RIFF")) && buffer.subarray(8, 12).equals(Buffer.from("WAVE"));
}

function isMp4AudioSignature(buffer) {
  return isIsoBmffSignature(buffer);
}

function isIsoBmffSignature(buffer) {
  if (buffer.length < 12 || !buffer.subarray(4, 8).equals(Buffer.from("ftyp"))) return false;
  const brand = buffer.subarray(8, 12).toString("ascii").toLowerCase();
  return ["m4a ", "m4v ", "mp42", "mp41", "isom", "iso2", "iso5", "avc1", "dash", "msnv"].includes(brand);
}

function throwUploadError(message, statusCode) {
  throw createPublicError(message, statusCode);
}
