import { getCharacterMessages } from "../services/chat-service.js";
import { getGuestChatSession } from "../services/guest-chat-service.js";
import { mergeChatMessages } from "./chat-action-utils.js";

const POLL_INTERVAL_MS = 2500;
// Image total deadline plus bounded generation of its natural terminal reply.
const MAX_POLL_MS = 30 * 60 * 1000;
const FAILED_POLL_GRACE_MS = 60000;
const ACTIVE_STATUSES = new Set(["queued", "generating"]);

export function createChatImageStatusPoller({ appState, mountApp, isViewingCharacter, appendCurrentChatTypingIndicator, hasActiveReplyScheduler } = {}) {
  const pollers = new Map();

  function scheduleChatImageStatusPoll(characterId, { immediate = false } = {}) {
    const normalizedCharacterId = String(characterId || "").trim();
    if (!normalizedCharacterId) return;
    if (!hasActiveChatImage(appState.chat.messages)) {
      stopChatImageStatusPoll(normalizedCharacterId);
      return;
    }
    const existing = pollers.get(normalizedCharacterId);
    if (existing?.timer) return;
    pollers.set(normalizedCharacterId, {
      startedAt: Date.now(),
      timer: window.setTimeout(() => {
        void pollChatImageStatus(normalizedCharacterId);
      }, immediate ? 200 : POLL_INTERVAL_MS),
    });
  }

  function stopChatImageStatusPoll(characterId) {
    const normalizedCharacterId = String(characterId || "").trim();
    const poller = pollers.get(normalizedCharacterId);
    if (poller?.timer) window.clearTimeout(poller.timer);
    pollers.delete(normalizedCharacterId);
  }

  async function pollChatImageStatus(characterId) {
    const poller = pollers.get(characterId);
    if (!poller) return;
    poller.timer = null;
    if (!isViewingChatImageCharacter(characterId) || !hasActiveChatImage(appState.chat.messages)) {
      stopChatImageStatusPoll(characterId);
      return;
    }

    const beforeSnapshot = collectImageStatusSnapshot(appState.chat.messages);
    const beforeReady = collectReadyImageIds(appState.chat.messages);
    const beforeMessageIds = new Set(appState.chat.messages.map((message) => String(message?.id || "")).filter(Boolean));
    try {
      const result = appState.chat.guest?.active && !appState.session.authenticated
        ? await getGuestChatSession(appState.site.currentSlug, characterId)
        : await getCharacterMessages(characterId);
      if (!isViewingChatImageCharacter(characterId)) {
        stopChatImageStatusPoll(characterId);
        return;
      }
      const nextMessages = Array.isArray(result.messages) ? result.messages : [];
      appState.chat.session = result.session || appState.chat.session;
      appState.chat.imageQuota = result.imageQuota || result.guest?.imageQuota || appState.chat.imageQuota;
      if (result.guest) appState.chat.guest = { ...appState.chat.guest, ...result.guest };
      appState.chat.messages = mergeChatMessages(appState.chat.messages, nextMessages);
      const newlyReady = [...collectReadyImageIds(appState.chat.messages)].filter((id) => !beforeReady.has(id));
      if (newlyReady.length) {
        appState.chat.readyImageToast = {
          messageId: newlyReady[0],
          nonce: Date.now(),
        };
      }
      const hasNewMessages = appState.chat.messages.some((message) => message?.id && !beforeMessageIds.has(String(message.id)));
      if (hasImageStatusChanged(beforeSnapshot, collectImageStatusSnapshot(appState.chat.messages)) || hasNewMessages) {
        preserveCurrentChatScroll(characterId);
        mountApp?.();
        if (hasActiveReplyScheduler?.(characterId)) appendCurrentChatTypingIndicator?.();
      }
    } catch (error) {
      console.warn("[aiove] chat image status poll failed:", error?.message || error);
    }

    if (!hasActiveChatImage(appState.chat.messages) || Date.now() - poller.startedAt > MAX_POLL_MS) {
      stopChatImageStatusPoll(characterId);
      return;
    }
    poller.timer = window.setTimeout(() => {
      void pollChatImageStatus(characterId);
    }, POLL_INTERVAL_MS);
  }

  function preserveCurrentChatScroll(characterId) {
    const body = document.querySelector(".chat-wrap #chatBody");
    if (!body) return;
    appState.chat.scrollRestore = {
      characterId,
      top: body.scrollTop,
    };
  }

  function isViewingChatImageCharacter(characterId) {
    const normalizedCharacterId = String(characterId || "").trim();
    if (!normalizedCharacterId) return false;
    if (isViewingCharacter?.(normalizedCharacterId)) return true;
    return String(appState.agent || "").trim() === normalizedCharacterId && Boolean(document.querySelector(".chat-wrap"));
  }

  return {
    scheduleChatImageStatusPoll,
    stopChatImageStatusPoll,
  };
}

export function hasActiveChatImage(messages = []) {
  return Array.isArray(messages) && messages.some((message) => {
    if (getMessageContentType(message) !== "image_generation") return false;
    const status = getMessageImageStatus(message);
    if (ACTIVE_STATUSES.has(status)) return true;
    if (["ready", "failed"].includes(status) && message?.image?.terminalReplyPending === true) return true;
    if (status === "failed") return message?.image?.failureReplyPending === true || isRecentFailedChatImage(message);
    return false;
  });
}

function collectReadyImageIds(messages = []) {
  const ready = new Set();
  if (!Array.isArray(messages)) return ready;
  messages.forEach((message) => {
    if (getMessageContentType(message) !== "image_generation") return;
    const status = getMessageImageStatus(message);
    if (status === "ready" && message.id) ready.add(message.id);
  });
  return ready;
}

function collectImageStatusSnapshot(messages = []) {
  const snapshot = new Map();
  if (!Array.isArray(messages)) return snapshot;
  messages.forEach((message) => {
    if (getMessageContentType(message) !== "image_generation") return;
    if (!message.id) return;
    snapshot.set(String(message.id), [
      getMessageImageStatus(message),
      String(message?.image?.imageUrl || message?.image_url || ""),
      String(message?.text || message?.text_content || ""),
      message?.image?.failureReplyPending === true ? "failure_reply_pending" : "",
      message?.image?.terminalReplyPending === true ? "terminal_reply_pending" : "",
    ].join("|"));
  });
  return snapshot;
}

function hasImageStatusChanged(before, after) {
  if (before.size !== after.size) return true;
  for (const [id, value] of after.entries()) {
    if (before.get(id) !== value) return true;
  }
  return false;
}

function isRecentFailedChatImage(message = {}) {
  const updatedAt = Date.parse(message?.image?.updatedAt || message?.image?.updated_at || message?.sentAt || message?.sent_at || "");
  if (!Number.isFinite(updatedAt)) return false;
  const age = Date.now() - updatedAt;
  return age >= 0 && age < FAILED_POLL_GRACE_MS;
}

function getMessageContentType(message = {}) {
  return String(message?.contentType || message?.content_type || "").trim();
}

function getMessageImageStatus(message = {}) {
  return String(
    message?.image?.status ||
    message?.image_status ||
    message?.deliveryStatus ||
    message?.delivery_status ||
    ""
  ).trim().toLowerCase();
}
