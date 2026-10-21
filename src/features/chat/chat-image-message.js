import { getChatImageStatusCopy } from "./chat-image-status-copy.js";

export function renderChatImageMessage({ message, pageLanguage = "English", copy, escapeHtml, escapeAttribute }) {
  const image = message.image || {};
  const status = String(image.status || message.deliveryStatus || "queued").toLowerCase();
  const localizedStatus = getChatImageStatusCopy(status, pageLanguage);
  const text = message.contentType === "image_generation"
    ? localizedStatus
    : message.text || localizedStatus;
  if (status === "ready" && image.imageUrl) {
    const media = image.mediaType === "video"
      ? `<video src="${escapeAttribute(image.imageUrl)}" controls playsinline preload="metadata"></video>`
      : `<img src="${escapeAttribute(image.imageUrl)}" alt="${escapeAttribute(text || copy?.t("chat.generatedPhoto") || getChatImageStatusCopy("ready", pageLanguage))}" loading="lazy" />`;
    return `
      <div class="chat-image-card is-ready" data-chat-image-message-id="${escapeAttribute(message.id || "")}">
        ${media}
      </div>
    `;
  }
  if (status === "failed" || status === "cancelled") {
    if (status === "failed") return "";
    return `
      <div class="chat-image-card is-failed" data-chat-image-message-id="${escapeAttribute(message.id || "")}">
        <span class="chat-image-status-text">${escapeHtml(text)}</span>
      </div>
    `;
  }
  return `
    <div class="chat-image-card is-pending" data-chat-image-message-id="${escapeAttribute(message.id || "")}">
      <span class="chat-image-spinner" aria-hidden="true"></span>
      <span class="chat-image-status-text">${escapeHtml(text)}</span>
    </div>
  `;
}
