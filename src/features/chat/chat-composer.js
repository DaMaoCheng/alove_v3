import { bindChatAttachmentInput } from "./chat-composer-attachment.js";
import { bindEmojiPicker } from "./chat-composer-emoji.js";
import { composerHtml } from "./chat-composer-template.js";
import { appendMessage, bindChatTextInput, setComposerBusy, updateComposerButton } from "./chat-composer-text.js";
import { bindChatVoiceControls, getMobileVoiceArmed, setMobileVoiceMode } from "./chat-composer-voice.js";

export { appendMessage, composerHtml };

export function bindChatComposer(root, { character, sending = false, disabled = false, guestMode = false, allowAttachments = !guestMode, allowVoiceInput = !guestMode, pageLanguage = "English", pendingAttachments = [], onSubmit, onAttach, onVoiceSubmit, onDraftChange } = {}) {
  if (disabled) {
    setComposerBusy(root, true);
    return;
  }
  const hasPendingAttachments = Array.isArray(pendingAttachments) && pendingAttachments.length > 0;
  const updateButton = () => updateComposerButton(root, {
    mobileVoiceArmed: getMobileVoiceArmed(),
    hasPendingAttachments,
  });
  setComposerBusy(root, sending);
  setMobileVoiceMode(root, false, { onChange: updateButton });
  bindChatTextInput(root, { character, pendingAttachments, onSubmit, onChange: updateButton, onDraftChange });
  bindEmojiPicker(root, { onChange: updateButton });
  if (allowAttachments) bindChatAttachmentInput(root, { pageLanguage, onAttach, maxFiles: Math.max(0, 5 - pendingAttachments.length) });
  if (allowVoiceInput) bindChatVoiceControls(root, { character, pageLanguage, onVoiceSubmit, onChange: updateButton });
  updateButton();
}
