import { trackEvent } from "../analytics/track.js";
import { uploadPendingChatAttachment } from "../services/chat-upload-service.js";
import { getRawErrorMessage, getUserFacingErrorMessage } from "../utils/user-facing-error.js";
import { deleteGuestPendingChatAttachment, uploadGuestPendingChatAttachment } from "../services/guest-chat-service.js";

export function createChatAttachmentActions({ appState, mountApp, isViewingCharacter, upsertContactFromChatResult }) {
  async function handleChatAttachmentSubmit({ characterId, attachment }) {
    const normalizedCharacterId = String(characterId || appState.agent || "").trim();
    if (!normalizedCharacterId || !attachment?.file || appState.chat.sendingByCharacterId[normalizedCharacterId]) {
      return { ok: false };
    }

    appState.chat.error = "";

    try {
      const guestMode = appState.chat.guest?.active === true && !appState.session.authenticated;
      const uploadedAttachment = guestMode
        ? await uploadGuestPendingChatAttachment(attachment, normalizedCharacterId)
        : await uploadPendingChatAttachment(attachment);
      if (!uploadedAttachment) return { ok: false };
      const pendingByCharacter = appState.chat.pendingAttachmentsByCharacterId || {};
      const current = Array.isArray(pendingByCharacter[normalizedCharacterId]) ? pendingByCharacter[normalizedCharacterId] : [];
      appState.chat.pendingAttachmentsByCharacterId = {
        ...pendingByCharacter,
        [normalizedCharacterId]: [...current, uploadedAttachment].slice(0, 5),
      };
      trackEvent("chat_attachment_uploaded", {
        character_id: normalizedCharacterId,
        returned_count: 0,
        file_type: attachment.file.type || "",
        original_size: attachment.originalSize || 0,
        guest: guestMode,
      });
      return { ok: true, attachment: uploadedAttachment };
    } catch (error) {
      const rawReason = getRawErrorMessage(error);
      const userMessage = getUserFacingErrorMessage(error, {
        pageLanguage: appState.site?.pageLanguage,
        fallbackType: "attachment",
      });
      if (isViewingCharacter(normalizedCharacterId)) {
        appState.chat.error = userMessage;
      }
      trackEvent("chat_attachment_upload_failed", {
        character_id: normalizedCharacterId,
        reason: rawReason,
        status: error.status || 0,
      });
      return { ok: false, error: userMessage };
    } finally {
      if (isViewingCharacter(normalizedCharacterId)) {
        mountApp();
      }
    }
  }

  async function removePendingChatAttachment({ characterId, index }) {
    const normalizedCharacterId = String(characterId || appState.agent || "").trim();
    const list = appState.chat.pendingAttachmentsByCharacterId?.[normalizedCharacterId] || [];
    const safeIndex = Number(index);
    if (!normalizedCharacterId || !Number.isInteger(safeIndex) || safeIndex < 0 || safeIndex >= list.length) return;
    const removedAttachment = list[safeIndex];
    const guestMode = appState.chat.guest?.active && !appState.session.authenticated;
    if (guestMode && removedAttachment?.guestAttachmentId) {
      try {
        await deleteGuestPendingChatAttachment(removedAttachment.guestAttachmentId, normalizedCharacterId);
      } catch (error) {
        if (isViewingCharacter(normalizedCharacterId)) {
          appState.chat.error = getUserFacingErrorMessage(error, { pageLanguage: appState.site?.pageLanguage, fallbackType: "attachment" });
          mountApp();
        }
        return;
      }
    }
    appState.chat.pendingAttachmentsByCharacterId = {
      ...appState.chat.pendingAttachmentsByCharacterId,
      [normalizedCharacterId]: list.filter((_, itemIndex) => itemIndex !== safeIndex),
    };
    if (isViewingCharacter(normalizedCharacterId)) mountApp();
  }

  return { handleChatAttachmentSubmit, removePendingChatAttachment };
}
