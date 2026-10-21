import { RealtimeCallClient } from "../features/call-modal/call-realtime-client.js";
import { applyCallClientEventState } from "../features/call-modal/call-client-event-state.js";
import { createCallDomRenderer } from "../features/call-modal/call-dom-renderer.js";
import { extractCallProductsFromPayload, mergeCallProducts } from "../features/call-modal/call-product-state.js";
import { mergeChatMessages } from "./chat-action-utils.js";
import { showDialog } from "../features/shared-ui/dialog.js";
import { createSiteCopy } from "../i18n/site-copy.js";

export function createCallActions({ appState, mountApp, onNavigate, refreshGuestChat } = {}) {
  const domRenderer = createCallDomRenderer({
    appState,
    onRestrictedCheckout: handleRestrictedCallCheckout,
    onProductOverlayClose: closeCallProductOverlay,
    onProductIndexChange: setCallProductIndex,
    onProductChange: handleCallProductChange,
  });

  function openCall() {
    appState.call.open = true;
    appState.call.seconds = 0;
    appState.call.muted = false;
    appState.call.paused = false;
    appState.call.status = "connecting";
    appState.call.turnStatus = "Connecting";
    appState.call.liveText = "";
    appState.call.liveSpeaker = "";
    appState.call.latencyText = "";
    appState.call.error = "";
    appState.call.sessionId = "";
    window.clearInterval(appState.call.timer);
    appState.call.timer = window.setInterval(() => {
      appState.call.seconds += 1;
      domRenderer.updateTimer(appState.call.seconds);
    }, 1000);
    mountApp();
  }

  function stopCall() {
    appState.call.client?.stop?.();
    appState.call.client = null;
    appState.call.open = false;
    window.clearInterval(appState.call.timer);
    appState.call.timer = null;
    appState.call.status = "idle";
    appState.call.turnStatus = "";
    appState.call.liveText = "";
    appState.call.liveSpeaker = "";
    appState.call.latencyText = "";
    appState.call.error = "";
    appState.call.sessionId = "";
    appState.call.products = [];
    appState.call.productOverlayOpen = false;
    appState.call.productIndex = 0;
    appState.call.hasHiddenProducts = false;
    domRenderer.clearProductOverlay();
    appState.call.paused = false;
  }

  function startCall() {
    if (!appState.call.open || appState.call.client) return;
    const client = new RealtimeCallClient({
      characterId: appState.agent,
      onEvent: handleCallClientEvent,
    });
    appState.call.client = client;
    client.start().catch((error) => {
      const copy = createSiteCopy(appState.site?.pageLanguage);
      client.stop();
      if (appState.call.client === client) appState.call.client = null;
      finishCallTimer();
      appState.call.paused = false;
      appState.call.status = "error";
      appState.call.error = copy.t("call.unavailable");
      appState.call.turnStatus = copy.t("call.unavailable");
      domRenderer.updateModal();
    });
  }

  function closeCall() {
    stopCall();
    mountApp();
  }

  function toggleCallPause() {
    if (!appState.call.client || ["ended", "error"].includes(appState.call.status)) return;
    appState.call.paused = !appState.call.paused;
    appState.call.status = appState.call.paused ? "paused" : "listening";
    appState.call.turnStatus = appState.call.paused ? "Paused" : "Listening";
    appState.call.client?.setPaused?.(appState.call.paused);
    mountApp();
  }

  function handleCallShopClick() {
    if (Array.isArray(appState.call.products) && appState.call.products.length) {
      appState.call.productOverlayOpen = true;
      appState.call.productIndex = 0;
      appState.call.hasHiddenProducts = false;
      domRenderer.updateProductUi();
      return;
    }
    appState.call.turnStatus = "Shop";
    domRenderer.updateModal();
  }

  function handleCallClientEvent(event = {}) {
    if (!appState.call.open) return;
    const result = applyCallClientEventState(appState, event);
    if (result.finishLifecycle) finishOpenCallLifecycle();
    if (result.mergeMessagesPayload) mergeCallMessagesIntoCurrentChat(result.mergeMessagesPayload);
    if (result.refreshGuestChat) void refreshGuestChat?.();
    domRenderer.updateModal();
  }

  function mergeCallMessagesIntoCurrentChat(payload = {}) {
    if (!payload || appState.agent !== appState.call.client?.characterId) return;
    const items = Array.isArray(payload.items) ? payload.items : [];
    if (!items.length) return;
    if (payload.session) {
      appState.chat.session = payload.session;
    }
    appState.chat.messages = mergeChatMessages(appState.chat.messages, items);
    appState.chat.unreadByCharacterId[appState.agent] = false;
    mergeCallProductMessages(payload);
    domRenderer.mountChatMessages();
  }

  function mergeCallProductMessages(payload = {}) {
    const nextProducts = extractCallProductsFromPayload(payload);
    if (!nextProducts.length) return;
    const mergedProducts = mergeCallProducts(appState.call.products, nextProducts);
    if (mergedProducts.length === appState.call.products.length) return;
    appState.call.products = mergedProducts;
    appState.call.productOverlayOpen = true;
    appState.call.productIndex = 0;
    appState.call.hasHiddenProducts = false;
    domRenderer.updateProductUi();
  }

  function closeCallProductOverlay() {
    appState.call.productOverlayOpen = false;
    appState.call.hasHiddenProducts = Array.isArray(appState.call.products) && appState.call.products.length > 0;
    domRenderer.updateProductUi();
  }

  function setCallProductIndex(index = 0) {
    const count = Array.isArray(appState.call.products) ? appState.call.products.length : 0;
    if (!count) return;
    const nextIndex = (Number(index || 0) + count) % count;
    appState.call.productIndex = nextIndex;
    appState.call.productOverlayOpen = true;
    appState.call.hasHiddenProducts = false;
    domRenderer.updateProductUi();
  }

  function handleCallProductChange({ product, index } = {}) {
    if (!product || !Array.isArray(appState.call.products)) return;
    const normalizedIndex = Number(index || 0);
    if (normalizedIndex < 0 || normalizedIndex >= appState.call.products.length) return;
    appState.call.products = appState.call.products.map((item, itemIndex) => itemIndex === normalizedIndex ? product : item);
  }

  function handleRestrictedCallCheckout() {
    const copy = createSiteCopy(appState?.site?.pageLanguage);
    showDialog({
      type: "info",
      title: copy.t("common.checkoutTitle"),
      message: copy.t("common.checkoutMessage"),
      confirmText: copy.t("common.createAccount"),
      cancelText: copy.t("common.notNow"),
      onConfirm: () => onNavigate?.("register"),
    });
  }

  function finishCallTimer() {
    window.clearInterval(appState.call.timer);
    appState.call.timer = null;
  }

  function finishOpenCallLifecycle() {
    const client = appState.call.client;
    appState.call.client = null;
    appState.call.paused = false;
    finishCallTimer();
    client?.stop?.();
  }

  return {
    openCall,
    stopCall,
    startCall,
    closeCall,
    toggleCallPause,
    handleCallShopClick,
    closeCallProductOverlay,
    setCallProductIndex,
    handleCallProductChange,
    handleRestrictedCallCheckout,
  };
}
