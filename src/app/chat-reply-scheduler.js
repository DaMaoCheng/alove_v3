import { trackEvent } from "../analytics/track.js";
import { sendCharacterReply } from "../services/chat-service.js";
import { createProductPanelMountGuard, mergeChatMessages, syncSidebarContactUnread } from "./chat-action-utils.js";
import { markVoiceMessagesForAutoplay } from "./chat-voice-autoplay-state.js";
import { getUserFacingErrorMessage } from "../utils/user-facing-error.js";

export const REPLY_DELAY_MS = 1500;
const PRODUCT_FOLLOWUP_DELAY_MS = 500;

export function createChatReplyScheduler({ appState, mountApp, isViewingCharacter, appendCurrentChatTypingIndicator, upsertContactFromChatResult }) {
  const replySchedulers = new Map();

  function scheduleDelayedReply(characterId, messageId, { productTrigger = "" } = {}) {
    const scheduler = getReplyScheduler(characterId);
    if (scheduler.completedSinceMessageIds.has(messageId)) return;
    if (!scheduler.pendingSinceMessageId) {
      scheduler.pendingSinceMessageId = messageId;
    }
    if (productTrigger) {
      scheduler.productTriggerByMessageId.set(messageId, productTrigger);
    }
    if (scheduler.generating) {
      scheduler.rerunAfterGenerate = true;
      return;
    }
    window.clearTimeout(scheduler.timer);
    const delayMs = productTrigger ? PRODUCT_FOLLOWUP_DELAY_MS : REPLY_DELAY_MS;
    scheduler.timer = window.setTimeout(() => {
      void runScheduledReply(characterId);
    }, delayMs);
  }

  async function runScheduledReply(characterId) {
    const scheduler = getReplyScheduler(characterId);
    if (scheduler.generating || !scheduler.pendingSinceMessageId) return;
    window.clearTimeout(scheduler.timer);
    scheduler.timer = null;
    const sinceMessageId = scheduler.pendingSinceMessageId;
    scheduler.pendingSinceMessageId = "";
    const productTrigger = scheduler.productTriggerByMessageId.get(sinceMessageId) || "";
    scheduler.productTriggerByMessageId.delete(sinceMessageId);
    scheduler.rerunAfterGenerate = false;
    scheduler.generating = true;
    const productPanelMountGuard = createProductPanelMountGuard(appState, characterId);
    if (isViewingCharacter(characterId)) appendCurrentChatTypingIndicator();

    try {
      const result = await sendCharacterReply(characterId, { sinceMessageId, productTrigger, siteSlug: appState.site.currentSlug || appState.site.defaultSlug || "" });
      const replyMessages = Array.isArray(result.messages) ? result.messages : [];
      const isCurrentChat = isViewingCharacter(characterId);
      markVoiceMessagesForAutoplay(appState, characterId, replyMessages);
      if (isCurrentChat) {
        if (result.session) {
          appState.chat.session = result.session;
        }
        await mergeReplyMessagesForDisplay(replyMessages, productPanelMountGuard);
      } else if (replyMessages.length) {
        appState.chat.unreadByCharacterId[characterId] = true;
        syncSidebarContactUnread(characterId, true);
      }
      upsertContactFromChatResult({
        characterId,
        session: result.session,
        messages: replyMessages,
      });
      trackEvent("chat_reply_generated", {
        character_id: characterId,
        returned_count: replyMessages.length,
        delayed_ms: REPLY_DELAY_MS,
      });
      scheduler.completedSinceMessageIds.add(sinceMessageId);
    } catch (error) {
      if (isViewingCharacter(characterId)) {
        appState.chat.error = getUserFacingErrorMessage(error, {
          pageLanguage: appState.site?.pageLanguage,
          fallbackType: "chat",
        });
      }
      trackEvent("chat_reply_failed", {
        character_id: characterId,
        reason: error.message,
        status: error.status || 0,
      });
    } finally {
      scheduler.generating = false;
      if (scheduler.rerunAfterGenerate || scheduler.pendingSinceMessageId) {
        scheduler.rerunAfterGenerate = false;
        window.clearTimeout(scheduler.timer);
        scheduler.timer = window.setTimeout(() => {
          void runScheduledReply(characterId);
        }, REPLY_DELAY_MS);
      }
      if (isViewingCharacter(characterId)) {
        productPanelMountGuard.mount(mountApp);
        if (hasActiveReplyScheduler(characterId)) appendCurrentChatTypingIndicator();
      }
    }
  }

  async function mergeReplyMessagesForDisplay(replyMessages, productPanelMountGuard) {
    const productMessage = replyMessages.find((message) => message?.contentType === "product");
    const textMessages = replyMessages.filter((message) => message?.contentType !== "product");
    if (!productMessage || !textMessages.length) {
      appState.chat.messages = mergeChatMessages(appState.chat.messages, replyMessages);
      return;
    }

    appState.chat.messages = mergeChatMessages(appState.chat.messages, [productMessage]);
    productPanelMountGuard.mount(mountApp);
    await wait(PRODUCT_FOLLOWUP_DELAY_MS);
    appState.chat.messages = mergeChatMessages(appState.chat.messages, textMessages);
  }

  function wait(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function getReplyScheduler(characterId) {
    if (!replySchedulers.has(characterId)) {
      replySchedulers.set(characterId, {
        timer: null,
        pendingSinceMessageId: "",
        productTriggerByMessageId: new Map(),
        completedSinceMessageIds: new Set(),
        generating: false,
        rerunAfterGenerate: false,
      });
    }
    return replySchedulers.get(characterId);
  }

  function hasActiveReplyScheduler(characterId) {
    const scheduler = replySchedulers.get(characterId);
    return Boolean(scheduler?.pendingSinceMessageId || scheduler?.generating || scheduler?.timer);
  }

  return {
    hasActiveReplyScheduler,
    scheduleDelayedReply,
  };
}
