import { trackEvent } from "../analytics/track.js";
import { sendCharacterMessage } from "../services/chat-service.js";
import { getGuestChatSession, sendGuestChatMessage } from "../services/guest-chat-service.js";
import { getRawErrorMessage, getUserFacingErrorMessage } from "../utils/user-facing-error.js";
import { createProductPanelMountGuard, mergeChatMessages, syncSidebarContactUnread } from "./chat-action-utils.js";
import { markVoiceMessagesForAutoplay } from "./chat-voice-autoplay-state.js";
import { createSiteCopy } from "../i18n/site-copy.js";

export function createChatTextActions({ appState, mountApp, isViewingCharacter, appendCurrentChatTypingIndicator, upsertContactFromChatResult, scheduleDelayedReply, hasActiveReplyScheduler, scheduleChatImageStatusPoll, scheduleGuestLimitReset }) {
  async function handleChatMessageSubmit({ characterId, text, attachments = null, productTrigger = "" }) {
    const normalizedCharacterId = String(characterId || appState.agent || "").trim();
    const normalizedText = String(text || "").trim();
    const pendingAttachments = Array.isArray(attachments)
      ? attachments
      : appState.chat.pendingAttachmentsByCharacterId?.[normalizedCharacterId] || [];
    if (!normalizedCharacterId || (!normalizedText && !pendingAttachments.length)) {
      return { ok: false };
    }
    if (appState.chat.guest?.active && !appState.session.authenticated) {
      const messageLimit = Number(appState.chat.guest.messageLimit || 0);
      const messageCount = Number(appState.chat.guest.messageCount || 0);
      if (messageLimit > 0 && messageCount >= messageLimit) {
        return { ok: false, error: createSiteCopy(appState.site?.pageLanguage).t("chat.limitPlaceholder") };
      }
      if (appState.chat.sendingByCharacterId[normalizedCharacterId]) return { ok: false };
      const pendingAttachmentIds = pendingAttachments.map((attachment) => String(attachment?.guestAttachmentId || "")).filter(Boolean);
      const requestFingerprint = JSON.stringify({ text: normalizedText, attachments: pendingAttachmentIds });
      const pendingRequest = appState.chat.guestPendingRequestByCharacterId[normalizedCharacterId];
      const clientMessageId = pendingRequest?.fingerprint === requestFingerprint
        ? pendingRequest.clientMessageId
        : crypto.randomUUID();
      appState.chat.guestPendingRequestByCharacterId[normalizedCharacterId] = { clientMessageId, text: normalizedText, fingerprint: requestFingerprint };
      appState.chat.sendingByCharacterId[normalizedCharacterId] = true;
      appState.chat.error = "";
      const previousMessageIds = new Set((appState.chat.messages || []).map((message) => String(message?.id || "")).filter(Boolean));
      try {
        const result = await sendGuestChatMessage({
          text: normalizedText,
          attachments: pendingAttachmentIds,
          clientMessageId,
          characterId: normalizedCharacterId,
        });
        delete appState.chat.guestPendingRequestByCharacterId[normalizedCharacterId];
        appState.chat.draftByCharacterId[normalizedCharacterId] = "";
        appState.chat.pendingAttachmentsByCharacterId = {
          ...appState.chat.pendingAttachmentsByCharacterId,
          [normalizedCharacterId]: [],
        };
        const newMessages = (result.messages || []).filter((message) => !previousMessageIds.has(String(message?.id || "")));
        markVoiceMessagesForAutoplay(appState, normalizedCharacterId, newMessages);
        if (isViewingCharacter(normalizedCharacterId)) {
          appState.chat.session = result.session || appState.chat.session;
          appState.chat.messages = Array.isArray(result.messages) ? result.messages : [];
          appState.chat.guest = { ...appState.chat.guest, ...(result.guest || {}) };
          appState.chat.imageQuota = result.guest?.imageQuota || appState.chat.imageQuota;
          appState.chat.guest.contactCharacterIds = [...new Set([
            ...(appState.chat.guest.contactCharacterIds || []),
            normalizedCharacterId,
          ])];
          scheduleGuestLimitReset?.(normalizedCharacterId);
          scheduleChatImageStatusPoll?.(normalizedCharacterId, { immediate: true });
        }
        return { ok: true, messages: result.messages || [] };
      } catch (error) {
        if (Number(error?.status || 0) === 429) {
          const refreshed = await getGuestChatSession(appState.site.currentSlug, normalizedCharacterId).catch(() => null);
          if (refreshed?.guest) {
            appState.chat.guest = { ...appState.chat.guest, ...refreshed.guest, active: true };
            scheduleGuestLimitReset?.(normalizedCharacterId);
          }
        }
        const message = getUserFacingErrorMessage(error, { pageLanguage: appState.site?.pageLanguage, fallbackType: "chat" });
        if (isViewingCharacter(normalizedCharacterId)) {
          appState.chat.error = message;
          appState.chat.draftByCharacterId[normalizedCharacterId] = normalizedText;
        }
        return { ok: false, error: message };
      } finally {
        appState.chat.sendingByCharacterId[normalizedCharacterId] = false;
        if (isViewingCharacter(normalizedCharacterId)) {
          // A stale image-poll scroll snapshot must not override the current
          // send flow's normal "stay with the latest message" behavior.
          appState.chat.scrollRestore = null;
          mountApp();
        }
      }
    }

    const productPanelMountGuard = createProductPanelMountGuard(appState, normalizedCharacterId);

    appState.chat.error = "";
    upsertContactFromChatResult({
      characterId: normalizedCharacterId,
      session: appState.chat.session?.characterId === normalizedCharacterId ? appState.chat.session : null,
      messages: [{
        senderType: "user",
            text: normalizedText || pendingAttachments.map((attachment) => attachment?.name || "Attachment").filter(Boolean).join(", "),
            sentAt: new Date().toISOString(),
          }],
    });

    try {
      const result = await sendCharacterMessage(normalizedCharacterId, {
        text: normalizedText,
        attachments: pendingAttachments,
      });
      const userMessages = Array.isArray(result.messages) ? result.messages : [];
      const isCurrentChat = isViewingCharacter(normalizedCharacterId);
      if (isCurrentChat) {
        if (result.session) {
          appState.chat.session = result.session;
        }
        appState.chat.pendingAttachmentsByCharacterId = {
          ...appState.chat.pendingAttachmentsByCharacterId,
          [normalizedCharacterId]: [],
        };
        appState.chat.messages = mergeChatMessages(appState.chat.messages, userMessages);
        scheduleChatImageStatusPoll?.(normalizedCharacterId, { immediate: true });
        productPanelMountGuard.mount(mountApp);
        appendCurrentChatTypingIndicator();
      } else {
        appState.chat.unreadByCharacterId[normalizedCharacterId] = true;
      }
      upsertContactFromChatResult({
        characterId: normalizedCharacterId,
        session: result.session,
        messages: userMessages,
      });
      if (!isCurrentChat) {
        syncSidebarContactUnread(normalizedCharacterId, true);
      }
      const userMessage = userMessages.find((message) => message?.senderType === "user" && (message?.contentType === "text" || message?.contentType === "attachment"));
      if (userMessage?.id) {
        scheduleDelayedReply(normalizedCharacterId, userMessage.id, { productTrigger });
      }
      trackEvent("chat_message_sent", {
        character_id: normalizedCharacterId,
        returned_count: userMessages.length,
        has_session: Boolean(result.session || appState.chat.session),
      });
      return { ok: true, messages: userMessages };
    } catch (error) {
      const rawReason = getRawErrorMessage(error);
      const userMessage = getUserFacingErrorMessage(error, {
        pageLanguage: appState.site?.pageLanguage,
        fallbackType: "chat",
      });
      if (isViewingCharacter(normalizedCharacterId)) {
        appState.chat.error = userMessage;
      }
      trackEvent("chat_message_failed", {
        character_id: normalizedCharacterId,
        reason: rawReason,
        status: error.status || 0,
      });
      return { ok: false, error: userMessage };
    } finally {
      if (isViewingCharacter(normalizedCharacterId)) {
        productPanelMountGuard.mount(mountApp);
        if (hasActiveReplyScheduler(normalizedCharacterId)) appendCurrentChatTypingIndicator();
      }
    }
  }

  return { handleChatMessageSubmit };
}
