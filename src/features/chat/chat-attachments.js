import { ICONS } from "../../icons/icons.js";
import { CHAT_ATTACHMENT_UPLOAD_POLICY } from "../../config/upload-policies.js";
import { compressImageFile } from "../../utils/image-processing.js";
import { createSiteCopy } from "../../i18n/site-copy.js";

export const CHAT_ATTACHMENT_ACCEPT = CHAT_ATTACHMENT_UPLOAD_POLICY.accept;
const ALLOWED_IMAGE_TYPES = new Set(CHAT_ATTACHMENT_UPLOAD_POLICY.imageTypes);
const ALLOWED_DOCUMENT_TYPES = new Set(CHAT_ATTACHMENT_UPLOAD_POLICY.documentTypes);

export function isAllowedChatAttachment(file) {
  if (!(file instanceof File)) return false;
  const type = String(file.type || "").toLowerCase();
  return ALLOWED_IMAGE_TYPES.has(type) || (ALLOWED_DOCUMENT_TYPES.has(type) && isAllowedDocumentName(file.name));
}

export async function processChatAttachmentFile(file, { pageLanguage = "English" } = {}) {
  const copy = createSiteCopy(pageLanguage);
  if (!(file instanceof File)) {
    throw new Error(copy.t("chat.attachmentInvalid"));
  }
  if (file.size > CHAT_ATTACHMENT_UPLOAD_POLICY.maxBytes) {
    throw new Error(copy.t("chat.attachmentTooLarge"));
  }
  if (!isAllowedChatAttachment(file)) {
    throw new Error(copy.t("chat.attachmentUnsupported"));
  }

  const sha256 = await computeFileSha256(file);
  if (ALLOWED_IMAGE_TYPES.has(String(file.type || "").toLowerCase())) {
    const processedFile = await compressImageFile(file, CHAT_ATTACHMENT_UPLOAD_POLICY.imageCompression);
    return {
      file: processedFile,
      originalName: file.name || "image",
      originalSize: file.size || 0,
      originalType: file.type || "",
      sha256,
    };
  }

  return {
    file,
    originalName: file.name || "document",
    originalSize: file.size || 0,
    originalType: file.type || "",
    sha256,
  };
}

export function renderAttachmentBubble(attachment = {}, { pageLanguage = "English" } = {}) {
  const copy = createSiteCopy(pageLanguage);
  const kind = String(attachment.kind || "").trim();
  if (kind === "image") {
    return `
      <button class="attachment-card attachment-image" type="button" data-chat-attachment-preview data-image-url="${escapeAttr(attachment.url)}" data-image-name="${escapeAttr(attachment.name || copy.t("chat.image"))}" aria-label="${escapeAttr(copy.t("chat.attachPreview"))} ${escapeAttr(attachment.name || "")}">
        <img src="${escapeAttr(attachment.url)}" alt="${escapeAttr(attachment.name || copy.t("chat.image"))}" />
        <span>${escapeHtml(attachment.name || copy.t("chat.image"))}</span>
      </button>
    `;
  }

  return `
    <a class="attachment-card attachment-doc" href="${escapeAttr(attachment.url)}" target="_blank" rel="noreferrer">
      <span class="att-ic">${ICONS.file || ICONS.ticket}</span>
      <span class="att-main"><b>${escapeHtml(attachment.name || copy.t("chat.document"))}</b><small>${formatBytes(attachment.size)}</small></span>
    </a>
  `;
}

export function attachmentSummary(attachment = {}) {
  const kind = String(attachment.kind || "").trim();
  return kind === "image" ? "[Image]" : `[Document] ${attachment.name || ""}`.trim();
}

function isAllowedDocumentName(name = "") {
  return /\.(pdf|txt)$/i.test(String(name || ""));
}

async function computeFileSha256(file) {
  if (!window.crypto?.subtle || typeof file.arrayBuffer !== "function") return "";
  const buffer = await file.arrayBuffer();
  const digest = await window.crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}
