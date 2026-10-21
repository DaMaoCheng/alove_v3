import { CHAT_ATTACHMENT_UPLOAD_POLICY } from "./upload-policies.js";
import { toProtectedChatAttachmentUrl } from "./protected-upload-url-service.js";
import { saveValidatedUpload, sanitizeOriginalFilename } from "./upload-security.js";
import { access, readdir, rename, rm } from "node:fs/promises";
import { resolve } from "node:path";

export async function saveChatAttachmentUpload({ userId = "", buffer, contentType = "", filename = "", originalName = "", originalSha256 = "", deterministicNameBase = "" } = {}) {
  const saved = await saveValidatedUpload({
    buffer,
    contentType,
    uploadFilename: filename,
    uploadDir: CHAT_ATTACHMENT_UPLOAD_POLICY.uploadDir,
    publicPath: CHAT_ATTACHMENT_UPLOAD_POLICY.publicPath,
    allowedTypes: CHAT_ATTACHMENT_UPLOAD_POLICY.allowedTypes,
    maxBytes: CHAT_ATTACHMENT_UPLOAD_POLICY.maxBytes,
    fileNamePrefix: CHAT_ATTACHMENT_UPLOAD_POLICY.fileNamePrefix,
    deterministicNameBase,
    emptyMessage: "附件文件不能为空",
    tooLargeMessage: "附件不能超过 20MB",
    unsupportedMessage: "仅支持上传图片、PDF 或 TXT",
  });
  const displayName = sanitizeOriginalFilename(originalName) || sanitizeOriginalFilename(filename) || `attachment${saved.allowed.extension}`;

  return {
    kind: saved.allowed.kind,
    name: displayName,
    storedName: saved.storedName,
    url: toProtectedChatAttachmentUrl(saved.storedName),
    size: saved.size,
    mimeType: saved.mimeType,
    sha256: saved.sha256,
    originalSha256: String(originalSha256 || "").trim().slice(0, 64),
    processed: {
      renamed: true,
      imageCompressed: saved.allowed.kind === "image" && saved.mimeType === "image/webp",
      documentPreserved: saved.allowed.kind === "document",
    },
    uploadedBy: String(userId || "").trim(),
  };
}

export async function deleteStoredChatAttachmentUpload(storedName = "") {
  const normalized = String(storedName || "").trim();
  if (!/^[a-zA-Z0-9._-]+$/.test(normalized)) return false;
  try {
    await rm(resolve(CHAT_ATTACHMENT_UPLOAD_POLICY.uploadDir, normalized), { force: true });
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

export async function moveStoredChatAttachmentUpload(sourceStoredName = "", targetStoredName = "") {
  const source = normalizeStoredName(sourceStoredName);
  const target = normalizeStoredName(targetStoredName);
  await rename(
    resolve(CHAT_ATTACHMENT_UPLOAD_POLICY.uploadDir, source),
    resolve(CHAT_ATTACHMENT_UPLOAD_POLICY.uploadDir, target)
  );
}

export async function storedChatAttachmentUploadExists(storedName = "") {
  const normalized = normalizeStoredName(storedName);
  try {
    await access(resolve(CHAT_ATTACHMENT_UPLOAD_POLICY.uploadDir, normalized));
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

export async function deleteStoredChatAttachmentAttempts(assetId = "") {
  const normalizedId = String(assetId || "").trim();
  if (!/^guest_attachment_[a-zA-Z0-9-]+$/.test(normalizedId)) return 0;
  let entries = [];
  try {
    entries = await readdir(CHAT_ATTACHMENT_UPLOAD_POLICY.uploadDir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return 0;
    throw error;
  }
  const prefix = `${normalizedId}_attachment_attempt_`;
  const suffixPattern = /^[a-zA-Z0-9-]+_tmp\.[a-z0-9]{1,8}$/;
  const matches = entries.filter((entry) => entry.isFile() && entry.name.startsWith(prefix) && suffixPattern.test(entry.name.slice(prefix.length)));
  await Promise.all(matches.map((entry) => rm(resolve(CHAT_ATTACHMENT_UPLOAD_POLICY.uploadDir, entry.name), { force: true })));
  return matches.length;
}

function normalizeStoredName(value) {
  const normalized = String(value || "").trim();
  if (!/^[a-zA-Z0-9._-]+$/.test(normalized)) throw new Error("Attachment storage name is invalid.");
  return normalized;
}
