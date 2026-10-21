import { ICONS } from "../../icons/icons.js";
import { CHAT_ATTACHMENT_ACCEPT } from "./chat-attachments.js";
import { EMOJIS } from "./chat-composer-emoji.js";
import { createSiteCopy } from "../../i18n/site-copy.js";

export function composerHtml(characterName, { disabled = false, guestMode = false, guestLimitReached = false, allowAttachments = !guestMode, allowVoiceInput = !guestMode, placeholder = "", pageLanguage = "English", draftText = "" } = {}) {
  const copy = createSiteCopy(pageLanguage);
  const inputDisabled = disabled || guestLimitReached;
  const disabledAttr = inputDisabled ? " disabled" : "";
  const unavailableAttr = disabled ? ' data-chat-unavailable="true"' : "";
  const inputPlaceholder = placeholder || copy.t("chat.message", { name: characterName });
  const disclaimer = {
    short: copy.t("chat.disclaimerShort"),
    long: copy.t("chat.disclaimerLong"),
  };
  return `
    <div class="composer${disabled ? " is-unavailable" : ""}${guestLimitReached ? " is-guest-limited" : ""}"${unavailableAttr}>
      <div class="chat-frame composer-frame">
        <div class="emoji-pop" id="emojiPop">${EMOJIS.map((emoji) => `<button class="emoji-cell" data-emoji="${emoji}">${emoji}</button>`).join("")}</div>
        <div class="composer-inner">
          <button class="icon attach-btn" type="button" aria-label="${copy.t("chat.attach")}" data-attach-toggle${inputDisabled || !allowAttachments ? " disabled" : ""}>${ICONS.plusS}</button>
          <input data-chat-attachment-file type="file" accept="${CHAT_ATTACHMENT_ACCEPT}" multiple hidden />
          <button class="icon" aria-label="${copy.t("chat.emoji")}" data-emoji-toggle${disabledAttr}>${ICONS.emoji}</button>
          <input id="msgInput" placeholder="${escapeAttr(inputPlaceholder)}" value="${escapeAttr(draftText)}"${disabledAttr} />
          <button class="voice-hold-btn" type="button" data-voice-hold${inputDisabled || !allowVoiceInput ? " disabled" : ""}>${copy.t("chat.hold")}</button>
          <button class="icon mic-btn" id="voiceBtnMain" aria-label="${copy.t("chat.voice")}"${inputDisabled || !allowVoiceInput ? " disabled" : ""}>${ICONS.mic}</button>
          <button class="send"${disabledAttr}>${ICONS.send}</button>
        </div>
        <details class="ai-disclaimer">
          <summary>
            <span class="ai-disclaimer-short">${escapeHtml(disclaimer.short)}</span>
            <span class="ai-disclaimer-long">${escapeHtml(disclaimer.long)}</span>
          </summary>
        </details>
        <div class="voice-rec" id="voiceRec">
          <span class="vr-dot"></span>
          <span class="vr-wave"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></span>
          <span class="vr-time" id="voiceRecTime">0:00</span>
          <button class="vr-cancel">${copy.t("chat.cancel")}</button>
        </div>
      </div>
    </div>
  `;
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[char]);
}

function escapeAttr(value = "") {
  return escapeHtml(value);
}
