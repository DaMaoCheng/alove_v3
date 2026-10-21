import { createChatActionHelpers } from "./chat-action-utils.js";
import { createChatAttachmentActions } from "./chat-attachment-actions.js";
import { createChatDataActions } from "./chat-data-actions.js";
import { createChatImageStatusPoller } from "./chat-image-status-poller.js";
import { createChatReplyScheduler } from "./chat-reply-scheduler.js";
import { createChatTextActions } from "./chat-text-actions.js";
import { createChatVoiceActions } from "./chat-voice-actions.js";

export function createChatActions({ appState, getCurrentView, mountApp } = {}) {
  function setChatDraft({ characterId = "", text = "" } = {}) {
    const normalizedCharacterId = String(characterId || appState.agent || "").trim();
    if (!normalizedCharacterId) return;
    appState.chat.draftByCharacterId = {
      ...appState.chat.draftByCharacterId,
      [normalizedCharacterId]: String(text || ""),
    };
  }

  function handleProductPanelChange(product) {
    appState.chat.openProductPanel = product && typeof product === "object" ? product : null;
  }

  function consumeChatImageReadyToast() {
    appState.chat.readyImageToast = null;
  }

  function consumeChatScrollRestore() {
    appState.chat.scrollRestore = null;
  }

  const helpers = createChatActionHelpers({ appState, getCurrentView });
  const replyScheduler = createChatReplyScheduler({
    appState,
    mountApp,
    ...helpers,
  });
  const imageStatusPoller = createChatImageStatusPoller({
    appState,
    mountApp,
    ...helpers,
    ...replyScheduler,
  });
  const dataActions = createChatDataActions({
    appState,
    mountApp,
    ...replyScheduler,
    ...imageStatusPoller,
  });
  const textActions = createChatTextActions({
    appState,
    mountApp,
    ...helpers,
    ...replyScheduler,
    ...imageStatusPoller,
    ...dataActions,
  });
  const attachmentActions = createChatAttachmentActions({
    appState,
    mountApp,
    ...helpers,
  });
  const voiceActions = createChatVoiceActions({
    appState,
    mountApp,
    ...helpers,
    ...replyScheduler,
    ...imageStatusPoller,
    ...dataActions,
  });
  return {
    consumeChatImageReadyToast,
    consumeChatScrollRestore,
    handleProductPanelChange,
    setChatDraft,
    scheduleChatImageStatusPoll: imageStatusPoller.scheduleChatImageStatusPoll,
    ...attachmentActions,
    ...textActions,
    ...voiceActions,
    ...dataActions,
  };
}
