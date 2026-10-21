import { trackEvent } from "../analytics/track.js";
import { uploadChatVoice } from "../services/chat-voice-service.js";
import { getRawErrorMessage, getUserFacingErrorMessage } from "../utils/user-facing-error.js";
import { mergeChatMessages } from "./chat-action-utils.js";
import { getGuestChatSession, sendGuestVoiceReply, uploadGuestChatVoice } from "../services/guest-chat-service.js";
import { markVoiceMessagesForAutoplay } from "./chat-voice-autoplay-state.js";
import { prepareGuestVoiceClip } from "../services/guest-voice-wav-service.js";
import { createSiteCopy } from "../i18n/site-copy.js";

export function createChatVoiceActions({ appState, mountApp, isViewingCharacter, appendCurrentChatTypingIndicator, upsertContactFromChatResult, scheduleDelayedReply, hasActiveReplyScheduler, scheduleChatImageStatusPoll, scheduleGuestLimitReset }) {
  async function handleChatVoiceSubmit({ characterId, voice }) {
    const normalizedCharacterId = String(characterId || appState.agent || "").trim();
    if (!normalizedCharacterId || !voice?.file || appState.chat.sendingByCharacterId[normalizedCharacterId]) {
      return { ok: false };
    }
    const guestMode = appState.chat.guest?.active === true && !appState.session.authenticated;
    if (guestMode && Number(appState.chat.guest.messageLimit || 0) > 0 && Number(appState.chat.guest.messageCount || 0) >= Number(appState.chat.guest.messageLimit || 0)) {
      return { ok: false, error: createSiteCopy(appState.site?.pageLanguage).t("chat.limitPlaceholder") };
    }

    appState.chat.sendingByCharacterId[normalizedCharacterId] = true;
    appState.chat.error = "";
    let guestVoiceMessageId = "";
    let guestPreviousMessageIds = new Set();

    try {
      if (guestMode) {
        const clientMessageId = voice.clientMessageId || crypto.randomUUID();
        voice.clientMessageId = clientMessageId;
        const previousMessageIds = new Set((appState.chat.messages || []).map((message) => String(message?.id || "")).filter(Boolean));
        guestPreviousMessageIds = previousMessageIds;
        const preparedVoice = await prepareGuestVoiceClip(voice);
        preparedVoice.clientMessageId = clientMessageId;
        const userResult = await uploadGuestChatVoice(preparedVoice, clientMessageId, normalizedCharacterId);
        const newUserMessages = (userResult.messages || []).filter((message) => !previousMessageIds.has(String(message?.id || "")));
        const userMessage = newUserMessages.find((message) => message?.senderType === "user" && message?.contentType === "text");
        if (!userMessage?.id) throw new Error("Voice transcript message was not created.");
        guestVoiceMessageId = userMessage.id;
        appState.chat.session = userResult.session || appState.chat.session;
        appState.chat.messages = Array.isArray(userResult.messages) ? userResult.messages : appState.chat.messages;
        appState.chat.guest = { ...appState.chat.guest, ...(userResult.guest || {}) };
        scheduleGuestLimitReset?.(normalizedCharacterId);
        if (isViewingCharacter(normalizedCharacterId)) {
          mountApp();
          appendCurrentChatTypingIndicator();
        }
        const replyResult = await sendGuestVoiceReply(userMessage.id, normalizedCharacterId);
        const newReplyMessages = (replyResult.messages || []).filter((message) => !previousMessageIds.has(String(message?.id || "")));
        markVoiceMessagesForAutoplay(appState, normalizedCharacterId, newReplyMessages);
        appState.chat.session = replyResult.session || appState.chat.session;
        appState.chat.messages = Array.isArray(replyResult.messages) ? replyResult.messages : appState.chat.messages;
        appState.chat.guest = { ...appState.chat.guest, ...(replyResult.guest || {}) };
        scheduleGuestLimitReset?.(normalizedCharacterId);
        scheduleChatImageStatusPoll?.(normalizedCharacterId, { immediate: true });
        trackEvent("chat_voice_sent", {
          character_id: normalizedCharacterId,
          returned_count: newReplyMessages.length,
          duration_seconds: voice.durationSeconds || 0,
          server_asr: true,
          guest: true,
        });
        return { ok: true, messages: replyResult.messages || [] };
      }
      const result = await uploadChatVoice(normalizedCharacterId, voice);
      const userMessages = Array.isArray(result.messages) ? result.messages : [];
      const isCurrentChat = isViewingCharacter(normalizedCharacterId);
      if (isCurrentChat) {
        if (result.session) {
          appState.chat.session = result.session;
        }
        appState.chat.messages = mergeChatMessages(appState.chat.messages, userMessages);
        scheduleChatImageStatusPoll?.(normalizedCharacterId, { immediate: true });
        mountApp();
        appendCurrentChatTypingIndicator();
      } else {
        appState.chat.unreadByCharacterId[normalizedCharacterId] = true;
      }
      upsertContactFromChatResult({
        characterId: normalizedCharacterId,
        session: result.session,
        messages: userMessages,
      });
      const userTextMessage = userMessages.find((message) => message?.senderType === "user" && message?.contentType === "text");
      if (userTextMessage?.id) {
        scheduleDelayedReply?.(normalizedCharacterId, userTextMessage.id);
      }
      trackEvent("chat_voice_sent", {
        character_id: normalizedCharacterId,
        returned_count: userMessages.length,
        duration_seconds: voice.durationSeconds || 0,
        server_asr: true,
      });
      return { ok: true, messages: userMessages };
    } catch (error) {
      if (guestMode && guestVoiceMessageId && Number(error?.status || 0) !== 429) {
        const recovered = await getGuestChatSession(appState.site.currentSlug, normalizedCharacterId).catch(() => null);
        const recoveredMessages = Array.isArray(recovered?.messages) ? recovered.messages : [];
        if (recovered?.guest) {
          appState.chat.guest = { ...appState.chat.guest, ...recovered.guest, active: true };
          scheduleGuestLimitReset?.(normalizedCharacterId);
        }
        const userIndex = recoveredMessages.findIndex((message) => message?.id === guestVoiceMessageId);
        const hasRecoveredReply = userIndex >= 0 && recoveredMessages.slice(userIndex + 1).some((message) => message?.senderType === "character");
        if (hasRecoveredReply) {
          const newMessages = recoveredMessages.filter((message) => !guestPreviousMessageIds.has(String(message?.id || "")));
          markVoiceMessagesForAutoplay(appState, normalizedCharacterId, newMessages);
          appState.chat.session = recovered.session || appState.chat.session;
          appState.chat.messages = recoveredMessages;
          return { ok: true, messages: recoveredMessages, recovered: true };
        }
      }
      if (guestMode && Number(error?.status || 0) === 429) {
        const refreshed = await getGuestChatSession(appState.site.currentSlug, normalizedCharacterId).catch(() => null);
        if (refreshed?.guest) {
          appState.chat.guest = { ...appState.chat.guest, ...refreshed.guest, active: true };
          scheduleGuestLimitReset?.(normalizedCharacterId);
        }
      }
      const rawReason = getRawErrorMessage(error);
      const userMessage = getUserFacingErrorMessage(error, {
        pageLanguage: appState.site?.pageLanguage,
        fallbackType: "voice",
      });
      if (isViewingCharacter(normalizedCharacterId)) {
        appState.chat.error = userMessage;
      }
      trackEvent("chat_voice_failed", {
        character_id: normalizedCharacterId,
        reason: rawReason,
        status: error.status || 0,
      });
      return { ok: false, error: userMessage };
    } finally {
      appState.chat.sendingByCharacterId[normalizedCharacterId] = false;
      if (isViewingCharacter(normalizedCharacterId)) {
        mountApp();
        if (hasActiveReplyScheduler?.(normalizedCharacterId)) appendCurrentChatTypingIndicator();
      }
    }
  }

  return { handleChatVoiceSubmit };
}
