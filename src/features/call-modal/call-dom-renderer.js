import { createCallProductOverlay } from "./call-product-overlay.js";
import { bindVoicePlayback } from "../chat/chat-voice.js";
import { bindChatAutoScroll, renderChatMessages, scrollChatToLatest } from "../chat/chat-page.js";
import { resolveCallStatusCopy } from "./call-status-copy.js";

export function createCallDomRenderer({
  appState,
  onRestrictedCheckout,
  onProductOverlayClose,
  onProductIndexChange,
  onProductChange,
} = {}) {
  function updateTimer(seconds = 0) {
    const timer = document.getElementById("callTimer");
    if (timer) {
      timer.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
    }
  }

  function updateProductUi() {
    updateShopButton();
    renderProductOverlay();
  }

  function updateShopButton() {
    const shopButton = document.getElementById("callShop");
    if (!shopButton) return;
    const hasProducts = Array.isArray(appState.call.products) && appState.call.products.length > 0;
    shopButton.classList.toggle("has-products", hasProducts);
    const icon = shopButton.querySelector(".cc-ic");
    if (!icon) return;
    const existingBadge = icon.querySelector(".call-shop-alert");
    if (!appState.call.hasHiddenProducts || !hasProducts) {
      existingBadge?.remove();
      return;
    }
    if (existingBadge) return;
    const badge = document.createElement("span");
    badge.className = "call-shop-alert";
    badge.textContent = "!";
    icon.append(badge);
  }

  function renderProductOverlay() {
    clearProductOverlay();
    if (!appState.call.productOverlayOpen || !Array.isArray(appState.call.products) || !appState.call.products.length) {
      return;
    }
    const app = document.getElementById("app") || document.body;
    app.append(createCallProductOverlay({
      products: appState.call.products,
      index: appState.call.productIndex,
      siteSlug: appState.site.currentSlug || appState.site.defaultSlug || "gogoalshop",
      pageLanguage: appState.site.pageLanguage || "English",
      guestMode: appState.chat.guest?.active === true && !appState.session.authenticated,
      onRestrictedCheckout,
      onClose: onProductOverlayClose,
      onIndexChange: onProductIndexChange,
      onProductChange,
    }));
  }

  function clearProductOverlay() {
    document.querySelectorAll(".call-product-overlay").forEach((node) => node.remove());
    document.body.classList.remove("call-product-open");
  }

  function mountChatMessages() {
    const root = document.querySelector(".chat-wrap");
    const frame = root?.querySelector(".chat-message-frame");
    if (!root || !frame) return;
    frame.innerHTML = renderChatMessages({
      character: appState.characters.current || {},
      messages: appState.chat.messages,
      loading: appState.chat.loading,
      error: appState.chat.error,
      pageLanguage: appState.site.pageLanguage || "English",
    });
    bindVoicePlayback(root, { messages: appState.chat.messages, autoPlayMessageIds: [] });
    bindChatAutoScroll(root);
    scrollChatToLatest(root);
  }

  function updateModal() {
    const status = document.getElementById("callStatusText");
    if (status) {
      status.textContent = resolveCallStatusCopy({
        status: appState.call.status,
        turnStatus: appState.call.turnStatus,
        error: appState.call.error,
        pageLanguage: appState.site.pageLanguage || "English",
      });
    }
    const live = document.getElementById("callLiveText");
    if (live) {
      live.innerHTML = renderCallLiveText(appState.call.liveText, appState.call.liveSpeaker);
    }
    const latency = document.getElementById("callLatency");
    if (latency) {
      latency.textContent = appState.call.latencyText || " ";
    }
    const pause = document.getElementById("callPause");
    if (pause) pause.disabled = !appState.call.client || ["ended", "error"].includes(appState.call.status);
  }

  return {
    updateTimer,
    updateProductUi,
    clearProductOverlay,
    mountChatMessages,
    updateModal,
  };
}

function renderCallLiveText(text = "", speaker = "") {
  const normalizedText = String(text || "").trim();
  if (!normalizedText) return " ";
  const isUser = speaker === "user";
  return `<div class="call-live-row ${isUser ? "user" : "assistant"}"><span class="call-live-dot"></span><p>${escapeHtml(normalizedText)}</p></div>`;
}

function escapeHtml(value = "") {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
