import { getChatImageReadyToastCopy } from "./chat-image-status-copy.js";

export function bindChatImageReadyToast(root, {
  toast = null,
  language = "",
  onConsumed,
} = {}) {
  const messageId = String(toast?.messageId || "").trim();
  if (!messageId) return;
  if (!root.isConnected) {
    window.requestAnimationFrame(() => {
      bindChatImageReadyToast(root, { toast, language, onConsumed });
    });
    return;
  }
  const target = root.querySelector(`.chat-image-card.is-ready[data-chat-image-message-id="${cssEscape(messageId)}"]`);
  if (!target) {
    onConsumed?.(messageId);
    return;
  }
  const body = root.querySelector("#chatBody");
  if (!body || isElementMostlyVisible(target, body)) {
    onConsumed?.(messageId);
    return;
  }

  const button = document.createElement("button");
  button.type = "button";
  button.className = "chat-image-ready-toast";
  button.textContent = getChatImageReadyToastCopy(language);
  button.addEventListener("click", () => {
    target.scrollIntoView({ block: "center", behavior: "smooth" });
    button.remove();
    onConsumed?.(messageId);
  });
  body.addEventListener("scroll", () => {
    if (!isElementMostlyVisible(target, body)) return;
    button.remove();
    onConsumed?.(messageId);
  }, { passive: true });
  root.querySelector(".chat-main")?.append(button);
}

function isElementMostlyVisible(element, scrollRoot) {
  const elementRect = element.getBoundingClientRect();
  const rootRect = scrollRoot.getBoundingClientRect();
  const visibleTop = Math.max(elementRect.top, rootRect.top);
  const visibleBottom = Math.min(elementRect.bottom, rootRect.bottom);
  return visibleBottom - visibleTop >= Math.min(160, elementRect.height * 0.6);
}

function cssEscape(value = "") {
  if (window.CSS?.escape) return window.CSS.escape(value);
  return String(value || "").replaceAll('"', '\\"').replaceAll("\\", "\\\\");
}
