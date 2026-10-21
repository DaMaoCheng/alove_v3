import { showDialog } from "../shared-ui/dialog.js";
import { isAllowedChatAttachment, processChatAttachmentFile } from "./chat-attachments.js";
import { getUserFacingErrorMessage } from "../../utils/user-facing-error.js";
import { createSiteCopy } from "../../i18n/site-copy.js";

export function bindChatAttachmentInput(root, { pageLanguage = "English", onAttach, maxFiles = 5 } = {}) {
  const remainingSlots = Math.max(0, Math.min(5, Number(maxFiles || 0)));
  if (!remainingSlots) {
    const button = root.querySelector("[data-attach-toggle]");
    if (button) button.disabled = true;
    return;
  }
  root.querySelector("[data-attach-toggle]")?.addEventListener("click", () => {
    root.querySelector("[data-chat-attachment-file]")?.click();
  });
  root.querySelector("[data-chat-attachment-file]")?.addEventListener("change", (event) => {
    void handleAttachmentSelection(root, event, { pageLanguage, onAttach, maxFiles: remainingSlots });
  });
}

async function handleAttachmentSelection(root, event, { pageLanguage = "English", onAttach, maxFiles = 5 } = {}) {
  const input = event.target;
  const files = Array.from(input.files || []).slice(0, Math.max(0, Math.min(5, Number(maxFiles || 0))));
  input.value = "";
  if (!files.length) return;
  const invalid = files.find((file) => !isAllowedChatAttachment(file));
  if (invalid) {
    showAttachmentError(pageLanguage, attachmentCopy(pageLanguage).unsupportedTitle, attachmentCopy(pageLanguage).unsupportedMessage);
    return;
  }

  setAttachmentBusy(root, true);
  try {
    for (const file of files) {
      const processed = await processChatAttachmentFile(file, { pageLanguage });
      await onAttach?.(processed);
    }
  } catch (error) {
    showAttachmentError(pageLanguage, attachmentCopy(pageLanguage).failedTitle, getUserFacingErrorMessage(error, {
      pageLanguage,
      fallbackType: "attachment",
    }));
  } finally {
    setAttachmentBusy(root, false);
  }
}

function showAttachmentError(pageLanguage, title, message) {
  const copy = attachmentCopy(pageLanguage);
  showDialog({
    type: "error",
    title,
    message,
    confirmText: copy.confirmText,
  });
}

function attachmentCopy(pageLanguage = "English") {
  const copy = createSiteCopy(pageLanguage);
  return {
    unsupportedTitle: copy.t("chat.attachmentUnsupportedTitle"),
    unsupportedMessage: copy.t("chat.attachmentUnsupported"),
    failedTitle: copy.t("chat.attachmentFailedTitle"),
    confirmText: copy.t("common.ok"),
  };
}

function setAttachmentBusy(root, uploading) {
  const button = root.querySelector("[data-attach-toggle]");
  if (!button) return;
  button.disabled = Boolean(uploading);
  button.classList.toggle("loading", Boolean(uploading));
}
