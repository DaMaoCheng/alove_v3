import { ICONS } from "../../icons/icons.js";
import { createThemeToggle } from "../../pages/login/theme-toggle.js";
import { characterAvatarHtml } from "../shared-ui/character-avatar.js";
import { appendMessage, bindChatComposer, composerHtml } from "./chat-composer.js";
import { bindProductPanel, productPanelHtml } from "./chat-product-panel.js";
import { productCartHtml } from "./chat-product-cart.js";
import { ensureTtmallAccountBinding, ttmallAccountBindingHtml } from "./chat-ttmall-binding-panel.js";
import { ttmallCheckoutPanelHtml } from "./chat-ttmall-checkout-panel.js";
import { appendTypingIndicator } from "./chat-typing-indicator.js";
import { bindVoicePlayback } from "./chat-voice.js";
import { createFallbackCharacter, renderQuickReplies } from "./chat-quick-replies.js";
import { renderPendingAttachmentChips } from "./chat-pending-attachments.js";
import { renderChatMessages as renderChatMessagesHtml } from "./chat-message-renderer.js";
import { bindChatImageReadyToast } from "./chat-image-ready-toast.js";
import { reportProductImpressions } from "./chat-product-impressions.js";
import { bindProductCardLiveRefresh } from "./chat-product-card-live-refresh.js";
import { bindChatAttachmentPreview } from "./chat-attachment-preview.js";
import { showDialog } from "../shared-ui/dialog.js";
import { openFeedbackDialog } from "../notifications/notification-panel.js";
import { createSiteCopy } from "../../i18n/site-copy.js";
import { bindChatImageQuota, chatImageQuotaHtml } from "./chat-image-quota.js";

export function createChatPage({ agent, character, messages = [], quickReplies = [], pendingAttachments = [], openProductPanel = null, draftText = "", voiceAutoPlayMessageIds = [], siteSlug = "", pageLanguage = "English", loading = false, sending = false, error = "", guestMode = false, guest = null, imageQuota = null, readyImageToast = null, scrollRestore = null, onNavigate, onOpenCall, onSendMessage, onDraftChange, onAttachFile, onRemovePendingAttachment, onSendVoice, onProductPanelChange, onChatImageToastConsumed, onChatScrollRestored, onPendingChatImageRendered, onOpenOrders }) {
  const copy = createSiteCopy(pageLanguage);
  const currentCharacter = character || createFallbackCharacter(agent, pageLanguage);
  const previousScroll = readCurrentChatScroll(currentCharacter.id);
  const unavailable = isArchivedCharacter(currentCharacter);
  const unavailableMessage = copy.t("create.unavailable");
  const hasPendingAttachments = Array.isArray(pendingAttachments) && pendingAttachments.length > 0;
  const guestMessageLimit = Math.max(0, Number(guest?.messageLimit || 0));
  const guestMessageCount = Math.max(0, Number(guest?.messageCount || 0));
  const guestLimitReached = guestMode && guestMessageLimit > 0 && guestMessageCount >= guestMessageLimit;
  const guestCapabilities = guest?.capability?.capabilities || {};
  const allowVoiceInput = !guestMode || guestCapabilities.voiceInput === true;
  const allowAttachments = !guestMode || guestCapabilities.attachments === true;
  const allowRealtimeCall = !guestMode || (guestCapabilities.realtimeCall === true && !guestLimitReached);
  const renderedMessages = renderChatMessages({
    character: currentCharacter,
    messages,
    loading,
    error,
    pageLanguage,
    escapeHtml,
    escapeAttribute,
  });
  const wrap = document.createElement("div");
  wrap.className = `chat-wrap${unavailable ? " is-unavailable" : ""}`;
  wrap.dataset.characterId = String(currentCharacter.id || "");
  wrap.dataset.pageLanguage = pageLanguage;
  wrap.innerHTML = `
    <div class="chat-main">
      <div class="chat-head">
        <div class="chat-frame chat-head-inner">
          <button class="menu-btn chat-menu-btn" aria-label="${copy.t("common.openMenu")}">${ICONS.menu}</button>
          ${characterAvatarHtml({ name: currentCharacter.name, imageUrl: currentCharacter.avatarUrl })}
          <div class="ch-info"><div class="ch-name-row"><span class="ch-name">${escapeHtml(currentCharacter.name)}</span>${privateTagHtml(currentCharacter, copy)}${unavailableTagHtml(currentCharacter, copy)}</div><div class="ch-status"><span class="ch-status-line" data-chat-status-line data-carousel="false" data-slide="primary"><span class="ch-status-primary" data-chat-status-primary>${unavailable ? escapeHtml(unavailableMessage) : `${copy.t("chat.online")} · ${escapeHtml(currentCharacter.roleTitle)}`}</span>${unavailable ? "" : `<span class="ch-status-quota" data-chat-status-quota>${chatImageQuotaHtml({ quota: imageQuota, copy, escapeAttribute: escapeAttribute })}</span>`}</span></div></div>
          <div class="chat-head-spacer"></div>
          <button class="call-btn" aria-label="${copy.t("chat.voiceCall")}" ${unavailable || !allowRealtimeCall ? "disabled" : ""}>${ICONS.phone}</button>
          <span data-theme-slot></span>
        </div>
      </div>
      <div class="chat-body" id="chatBody">
        <div class="chat-frame chat-message-frame">
          ${renderedMessages}
        </div>
      </div>
      <div class="suggest-row">
        <div class="chat-frame suggest-frame${hasPendingAttachments ? " pending-attachment-frame" : ""}">
          ${hasPendingAttachments
            ? renderPendingAttachmentChips(pendingAttachments, { pageLanguage, escapeAttribute, escapeHtml })
            : guestMode ? "" : renderQuickReplies(quickReplies, { character: currentCharacter, pageLanguage, disabled: unavailable, escapeAttribute, escapeHtml })}
        </div>
      </div>
      ${guestAuthPromptHtml({ guestMode, messageCount: guestMessageCount, messageLimit: guestMessageLimit, copy })}
      ${composerHtml(currentCharacter.name, {
        disabled: unavailable,
        guestMode,
        guestLimitReached,
        allowAttachments,
        allowVoiceInput,
        placeholder: unavailable ? unavailableMessage : guestLimitReached ? copy.t("chat.limitPlaceholder") : "",
        pageLanguage,
        draftText,
      })}
    </div>
    <div class="prod-scrim"></div>
    <aside class="prod-panel">${productPanelHtml({ pageLanguage })}</aside>
    ${productCartHtml({ pageLanguage })}
    ${ttmallAccountBindingHtml()}
    ${ttmallCheckoutPanelHtml()}
  `;

  wrap.querySelector("[data-theme-slot]")?.replaceWith(createThemeToggle());
  bindChatImageQuota(wrap);
  wrap.querySelector(".chat-menu-btn")?.addEventListener("click", () => document.body.classList.toggle("drawer-open"));
  wrap.querySelector(".call-btn")?.addEventListener("click", () => {
    if (!unavailable && allowRealtimeCall) onOpenCall?.();
  });
  wrap.querySelectorAll("[data-guest-auth-view]").forEach((button) => {
    button.addEventListener("click", () => onNavigate?.(button.dataset.guestAuthView));
  });
  wrap.querySelectorAll("[data-open-feedback]").forEach((button) => {
    button.addEventListener("click", () => openFeedbackDialog({ guestMode, pageLanguage }));
  });
  wrap.querySelectorAll("[data-open-order-binding]").forEach((button) => {
    button.addEventListener("click", async () => {
      const targetSite = button.dataset.orderSite || siteSlug;
      if (guestMode) {
        onNavigate?.("login");
        return;
      }
      button.disabled = true;
      try {
        const binding = await ensureTtmallAccountBinding(wrap, { siteSlug: targetSite, language: pageLanguage, onBound: () => onOpenOrders?.() });
        if (binding?.mode === "ttmall" && binding.requiresBinding === false) onOpenOrders?.();
      } catch (error) {
        showDialog({ type: "error", message: error.message });
      } finally {
        button.disabled = false;
      }
    });
  });
  wrap.querySelectorAll("[data-quick]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (unavailable) return;
      wrap.querySelectorAll("[data-quick]").forEach((quickButton) => {
        quickButton.disabled = true;
      });
      appendMessage(wrap, button.dataset.quick);
      appendTypingIndicator(wrap, currentCharacter);
      const result = await onSendMessage?.({
        characterId: currentCharacter.id,
        text: button.dataset.quick,
        productTrigger: button.dataset.productTrigger,
      });
      if (!result?.ok) {
        scrollChatToLatest(wrap);
      }
    });
  });
  wrap.querySelectorAll("[data-remove-pending-attachment]").forEach((button) => {
    button.addEventListener("click", () => {
      onRemovePendingAttachment?.({
        characterId: currentCharacter.id,
        index: Number(button.dataset.removePendingAttachment),
      });
    });
  });
  bindChatComposer(wrap, {
    character: currentCharacter,
    sending,
    disabled: unavailable || guestLimitReached,
    pageLanguage,
    pendingAttachments,
    guestMode,
    allowAttachments,
    allowVoiceInput,
    onDraftChange: (text) => onDraftChange?.({ characterId: currentCharacter.id, text }),
    onSubmit: async ({ text: userText, attachments } = {}) => {
      const result = await onSendMessage?.({
        characterId: currentCharacter.id,
        text: userText,
        attachments,
      });
      if (!result?.ok) {
        scrollChatToLatest(wrap);
      }
    },
    onAttach: async (processedAttachment) => {
      const result = await onAttachFile?.({
        characterId: currentCharacter.id,
        attachment: processedAttachment,
      });
      if (!result?.ok) {
        scrollChatToLatest(wrap);
      }
    },
    onVoiceSubmit: async (voiceClip) => {
      const result = await onSendVoice?.({
        characterId: currentCharacter.id,
        voice: voiceClip,
      });
      if (!result?.ok) {
        scrollChatToLatest(wrap);
        throw new Error(result?.error || "Voice message failed.");
      }
      return result;
    },
  });
  if (!guestMode) {
    reportProductImpressions(wrap);
    bindProductCardLiveRefresh(wrap, { pageLanguage });
  }
  bindChatAttachmentPreview(wrap, { pageLanguage });
  bindProductPanel(wrap, {
    initialProduct: openProductPanel,
    language: pageLanguage,
    siteSlug,
    recordAnalytics: !guestMode,
    guestMode,
    requireAuthForCheckout: guestMode,
    onRestrictedCheckout: () => showDialog({
      type: "info",
      title: copy.t("common.checkoutTitle"),
      message: copy.t("common.checkoutMessage"),
      confirmText: copy.t("common.createAccount"),
      cancelText: copy.t("common.notNow"),
      onConfirm: () => onNavigate?.("register"),
    }),
    onProductChange: onProductPanelChange,
  });
  bindVoicePlayback(wrap, { messages, autoPlayMessageIds: voiceAutoPlayMessageIds });
  bindChatAutoScroll(wrap);
  if (scrollRestore && String(scrollRestore.characterId || "") === String(currentCharacter.id || "")) {
    restoreChatScroll(wrap, scrollRestore);
    onChatScrollRestored?.();
  } else if (previousScroll && !previousScroll.nearBottom) {
    restoreChatScroll(wrap, previousScroll);
  } else {
    scrollChatToLatest(wrap);
  }
  bindChatImageReadyToast(wrap, {
    toast: readyImageToast,
    language: pageLanguage,
    onConsumed: onChatImageToastConsumed,
  });
  if (hasPendingChatImage(wrap)) {
    const pendingCharacterId = String(agent || currentCharacter.id || "").trim();
    window.setTimeout(() => {
      onPendingChatImageRendered?.(pendingCharacterId);
    }, 0);
  }

  return wrap;
}

function guestAuthPromptHtml({ guestMode = false, messageCount = 0, messageLimit = 0, copy } = {}) {
  if (!guestMode || messageLimit <= 0 || messageCount < 20) return "";
  const limitReached = messageCount >= messageLimit;
  const title = limitReached
    ? copy.t("chat.freeUsed", { count: messageLimit })
    : copy.t("chat.keep");
  const message = limitReached
    ? copy.t("chat.limitMessage")
    : copy.t("chat.remaining", { count: Math.max(0, messageLimit - messageCount) });
  return `
    <div class="guest-auth-prompt${limitReached ? " is-limit-reached" : ""}" role="status">
      <div class="chat-frame guest-auth-prompt-inner">
        <div class="guest-auth-prompt-copy"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(message)}</span></div>
        <div class="guest-auth-prompt-actions">
          <button class="btn btn-secondary" type="button" data-guest-auth-view="login">${copy.t("chat.login")}</button>
          <button class="btn btn-primary" type="button" data-guest-auth-view="register">${copy.t("common.createAccount")}</button>
        </div>
      </div>
    </div>`;
}

function privateTagHtml(entity = {}, copy) {
  if (entity.visibility !== "private") return "";
  return `<span class="priv-tag" title="${escapeAttribute(copy.t("create.privateHint"))}">${ICONS.lock}<span>${escapeHtml(copy.t("create.private"))}</span></span>`;
}

function unavailableTagHtml(entity = {}, copy) {
  if (!isArchivedCharacter(entity)) return "";
  return `<span class="unavailable-tag" aria-label="${escapeAttribute(copy.t("create.unavailable"))}" title="${escapeAttribute(copy.t("create.unavailable"))}">!</span>`;
}

function isArchivedCharacter(entity = {}) {
  return String(entity.characterStatus || entity.status || "").trim().toLowerCase() === "archived";
}

export function renderChatMessages(options = {}) {
  return renderChatMessagesHtml({ ...options, escapeHtml, escapeAttribute });
}

export function scrollChatToLatest(root) {
  const body = root.querySelector("#chatBody");
  if (!body) return;

  const scroll = () => {
    body.scrollTop = body.scrollHeight;
  };

  scroll();
  window.requestAnimationFrame(() => {
    scroll();
    window.requestAnimationFrame(scroll);
  });
  window.setTimeout(scroll, 80);
  window.setTimeout(scroll, 220);
  window.setTimeout(scroll, 420);
}

export function bindChatAutoScroll(root) {
  const body = root.querySelector("#chatBody");
  if (!body) return;

  body.querySelectorAll("img").forEach((image) => {
    image.addEventListener("load", () => {
      if (isNearChatBottom(body)) scrollChatToLatest(root);
    }, { once: true });
  });
}

function readCurrentChatScroll(characterId) {
  const normalizedCharacterId = String(characterId || "");
  const wrap = document.querySelector(".chat-wrap");
  if (!wrap || String(wrap.dataset.characterId || "") !== normalizedCharacterId) return null;
  const body = wrap.querySelector("#chatBody");
  if (!body) return null;
  return {
    characterId: normalizedCharacterId,
    top: body.scrollTop,
    nearBottom: isNearChatBottom(body),
  };
}

function isNearChatBottom(body) {
  const threshold = 96;
  return body.scrollHeight - body.clientHeight - body.scrollTop <= threshold;
}

function restoreChatScroll(root, scrollRestore = {}) {
  const body = root.querySelector("#chatBody");
  if (!body) return;
  const top = Math.max(0, Number(scrollRestore.top || 0));
  body.scrollTop = top;
  window.requestAnimationFrame(() => {
    body.scrollTop = top;
  });
}

function hasPendingChatImage(root) {
  return Boolean(root.querySelector(".chat-image-card.is-pending, .chat-image-card.is-generating"));
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}
