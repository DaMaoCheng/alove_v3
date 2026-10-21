import { ICONS } from "../../icons/icons.js";
import { createSiteCopy } from "../../i18n/site-copy.js";

export function bindChatAttachmentPreview(root, { pageLanguage = "English" } = {}) {
  if (!root || root.dataset.chatAttachmentPreviewBound === "true") return;
  root.dataset.chatAttachmentPreviewBound = "true";

  root.addEventListener("click", (event) => {
    const trigger = event.target.closest("[data-chat-attachment-preview]");
    if (!trigger || !root.contains(trigger)) return;
    event.preventDefault();
    openChatAttachmentPreview({
      url: trigger.dataset.videoUrl || trigger.dataset.imageUrl || "",
      name: trigger.dataset.imageName || "",
      mediaType: trigger.dataset.videoUrl ? "video" : "image",
      pageLanguage,
    });
  });
}

function openChatAttachmentPreview({ url = "", name = "", mediaType = "image", pageLanguage = "English" } = {}) {
  const copy = createSiteCopy(pageLanguage);
  const mediaUrl = String(url || "").trim();
  if (!mediaUrl) return;
  closeChatAttachmentPreview();
  const isVideo = mediaType === "video";

  const host = document.createElement("div");
  host.className = "chat-image-preview-host";
  host.innerHTML = `
    <div class="chat-image-preview-scrim" data-chat-image-preview-close></div>
    <div class="chat-image-preview-modal" role="dialog" aria-modal="true" aria-label="${escapeAttr(name || copy.t(isVideo ? "chat.videoPreview" : "chat.imagePreview"))}">
      <button class="chat-image-preview-close" type="button" aria-label="${escapeAttr(copy.t("chat.closePreview"))}" data-chat-image-preview-close>${ICONS.close}</button>
      ${isVideo
        ? `<video src="${escapeAttr(mediaUrl)}" controls playsinline preload="metadata"></video>`
        : `<img src="${escapeAttr(mediaUrl)}" alt="${escapeAttr(name || copy.t("chat.uploadedImage"))}" />`}
      ${name ? `<div class="chat-image-preview-name">${escapeHtml(name)}</div>` : ""}
    </div>
  `;

  document.body.append(host);
  document.body.classList.add("chat-image-preview-open");
  host.querySelectorAll("[data-chat-image-preview-close]").forEach((item) => {
    item.addEventListener("click", closeChatAttachmentPreview);
  });
  document.addEventListener("keydown", handlePreviewKeydown);
}

function closeChatAttachmentPreview() {
  document.querySelector(".chat-image-preview-host")?.remove();
  document.body.classList.remove("chat-image-preview-open");
  document.removeEventListener("keydown", handlePreviewKeydown);
}

function handlePreviewKeydown(event) {
  if (event.key === "Escape") closeChatAttachmentPreview();
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
