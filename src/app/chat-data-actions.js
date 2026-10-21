import { trackEvent } from "../analytics/track.js";
import { fetchChatQuickReplies } from "../services/chat-quick-reply-service.js";
import { getCharacterMessages, getChatContacts } from "../services/chat-service.js";
import { getGuestChatSession } from "../services/guest-chat-service.js";
import { mergeContacts, syncSidebarContactUnread } from "./chat-action-utils.js";
import { getUserFacingErrorMessage } from "../utils/user-facing-error.js";

export function createChatDataActions({ appState, mountApp, scheduleDelayedReply, hasActiveReplyScheduler, scheduleChatImageStatusPoll }) {
  let chatLoadRequestId = 0;

  async function loadChatMessages(characterId) {
    const normalizedId = String(characterId || "").trim();
    const requestId = chatLoadRequestId + 1;
    chatLoadRequestId = requestId;
    if (!normalizedId) {
      appState.chat.session = null;
      appState.chat.messages = [];
      appState.chat.imageQuota = null;
      appState.chat.quickRepliesByCharacterId = {};
      appState.chat.openProductPanel = null;
      appState.chat.error = "";
      appState.chat.loading = false;
      mountApp();
      return;
    }

    appState.chat.loading = true;
    appState.chat.error = "";
    if (appState.chat.session?.characterId !== normalizedId) {
      appState.chat.session = null;
      appState.chat.messages = [];
      appState.chat.openProductPanel = null;
    }
    mountApp();

    try {
      const isGuest = appState.chat.guest?.active && !appState.session.authenticated;
      const [result, quickReplyResult] = isGuest
        ? [await getGuestChatSession(appState.site.currentSlug, normalizedId, appState.chat.guest.sourceHandoff), { quickReplies: [] }]
        : await Promise.all([
          getCharacterMessages(normalizedId),
          fetchChatQuickReplies(normalizedId).catch(() => ({ quickReplies: [] })),
        ]);
      if (!isCurrentChatLoad(requestId, normalizedId)) return;
      appState.chat.session = result.session || null;
      appState.chat.messages = Array.isArray(result.messages) ? result.messages : [];
      appState.chat.imageQuota = result.imageQuota || result.guest?.imageQuota || null;
      if (isGuest && result.guest) {
        appState.chat.guest = { ...appState.chat.guest, ...result.guest, sourceHandoff: "", active: true };
        const serverContactIds = Array.isArray(result.guest.contacts)
          ? result.guest.contacts.map((contact) => String(contact?.id || "").trim()).filter(Boolean)
          : [];
        const currentCharacterHasUserMessage = (result.messages || []).some((message) => message?.senderType === "user");
        appState.chat.guest.contactCharacterIds = [...new Set([
          ...(appState.chat.guest.contactCharacterIds || []),
          ...serverContactIds,
          ...(currentCharacterHasUserMessage ? [normalizedId] : []),
        ])];
        appState.chat.pendingAttachmentsByCharacterId = {
          ...appState.chat.pendingAttachmentsByCharacterId,
          [normalizedId]: Array.isArray(result.guest.pendingAttachments) ? result.guest.pendingAttachments : [],
        };
        scheduleGuestLimitReset(normalizedId);
      } else {
        clearGuestLimitReset();
      }
      appState.chat.quickRepliesByCharacterId[normalizedId] = Array.isArray(quickReplyResult.quickReplies) ? quickReplyResult.quickReplies : [];
      appState.chat.unreadByCharacterId[normalizedId] = false;
      appState.chat.contacts = mergeContacts(appState.chat.contacts, appState.chat.unreadByCharacterId);
      syncSidebarContactUnread(normalizedId, false);
      if (!isGuest) recoverUnansweredUserMessage(normalizedId);
      // Guest conversations also need the short failed-image grace window so
      // a failure reply created by the worker can arrive after a reload.
      scheduleChatImageStatusPoll?.(normalizedId, { immediate: true });
      trackEvent("chat_messages_loaded", {
        character_id: normalizedId,
        count: appState.chat.messages.length,
        has_session: Boolean(appState.chat.session),
      });
    } catch (error) {
      if (!isCurrentChatLoad(requestId, normalizedId)) return;
      appState.chat.session = null;
      appState.chat.messages = [];
      appState.chat.error = getUserFacingErrorMessage(error, {
        pageLanguage: appState.site?.pageLanguage,
        fallbackType: "chat",
      });
      trackEvent("chat_messages_failed", {
        character_id: normalizedId,
        reason: error.message,
        status: error.status || 0,
      });
    } finally {
      if (!isCurrentChatLoad(requestId, normalizedId)) return;
      appState.chat.loading = false;
      mountApp();
    }
  }

  function isCurrentChatLoad(requestId, characterId) {
    return requestId === chatLoadRequestId && String(appState.agent || "").trim() === characterId;
  }

  function scheduleGuestLimitReset(characterId) {
    clearGuestLimitReset();
    const guest = appState.chat.guest || {};
    const limit = Number(guest.messageLimit || 0);
    const count = Number(guest.messageCount || 0);
    const resetsAt = new Date(guest.messageWindowResetsAt || 0).getTime();
    if (!limit || count < limit || !resetsAt) return;
    const delay = Math.max(0, resetsAt - Date.now() + 100);
    appState.chat.guest.limitResetTimer = window.setTimeout(() => {
      appState.chat.guest.limitResetTimer = null;
      void loadChatMessages(characterId);
    }, Math.min(delay, 2_147_000_000));
  }

  function clearGuestLimitReset() {
    if (appState.chat.guest?.limitResetTimer) window.clearTimeout(appState.chat.guest.limitResetTimer);
    if (appState.chat.guest) appState.chat.guest.limitResetTimer = null;
  }

  function recoverUnansweredUserMessage(characterId) {
    if (hasActiveReplyScheduler?.(characterId)) return;
    const unansweredMessage = findLatestUnansweredUserTextMessage(appState.chat.messages);
    if (!unansweredMessage?.id) return;
    scheduleDelayedReply?.(characterId, unansweredMessage.id, { recovery: true });
  }

  function findLatestUnansweredUserTextMessage(messages = []) {
    const rows = Array.isArray(messages) ? messages : [];
    for (let index = rows.length - 1; index >= 0; index -= 1) {
      const message = rows[index];
      if (message?.senderType === "character") return null;
      if (message?.senderType === "user" && String(message?.contentType || "text") === "text") return message;
    }
    return null;
  }

  async function loadChatContacts() {
    if (!appState.session.authenticated) {
      appState.chat.contacts = [];
      appState.chat.unreadByCharacterId = {};
      appState.chat.voiceAutoplayByCharacterId = {};
      appState.chat.sendingByCharacterId = {};
      appState.chat.quickRepliesByCharacterId = {};
      mountApp();
      return;
    }

    try {
      const result = await getChatContacts({ siteSlug: appState.site.currentSlug || appState.site.defaultSlug || "gogoalshop" });
      appState.chat.contacts = mergeContacts(
        Array.isArray(result.contacts) ? result.contacts : [],
        appState.chat.unreadByCharacterId
      );
      trackEvent("chat_contacts_loaded", {
        count: appState.chat.contacts.length,
      });
    } catch (error) {
      trackEvent("chat_contacts_failed", {
        reason: error.message,
        status: error.status || 0,
      });
    } finally {
      mountApp();
    }
  }

  return {
    loadChatContacts,
    loadChatMessages,
    scheduleGuestLimitReset,
  };
}
