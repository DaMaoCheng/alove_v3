import { appendTypingIndicator } from "./chat-typing-indicator.js";
import { isPlainEnter } from "../../utils/keyboard-events.js";

export function bindChatTextInput(root, { character, pendingAttachments = [], onSubmit, onChange, onDraftChange } = {}) {
  root.querySelector(".send")?.addEventListener("click", () => sendMessage(root, { character, pendingAttachments, onSubmit, onChange, onDraftChange }));
  root.querySelector("#msgInput")?.addEventListener("keydown", (event) => {
    if (isPlainEnter(event)) sendMessage(root, { character, pendingAttachments, onSubmit, onChange, onDraftChange });
  });
  root.querySelector("#msgInput")?.addEventListener("input", (event) => {
    onDraftChange?.(String(event.target?.value || ""));
    onChange?.();
  });
}

export function appendMessage(root, text) {
  const body = root.querySelector("#chatBody");
  const container = root.querySelector(".chat-message-frame");
  if (!body || !container || !text) return;
  const message = document.createElement("div");
  message.className = "msg me";
  message.innerHTML = `<div class="bubble">${text.replaceAll("<", "&lt;")}</div>`;
  container.append(message);
  body.scrollTop = body.scrollHeight;
}

function sendMessage(root, { character, pendingAttachments = [], onSubmit, onChange, onDraftChange } = {}) {
  const input = root.querySelector("#msgInput");
  const send = root.querySelector(".send");
  const value = input?.value.trim();
  const attachments = Array.isArray(pendingAttachments) ? pendingAttachments : [];
  if ((!value && !attachments.length) || send?.disabled) return;
  setComposerBusy(root, true);
  if (value) appendMessage(root, value);
  appendTypingIndicator(root, character);
  input.value = "";
  onDraftChange?.("");
  onChange?.();
  onSubmit?.({ text: value, attachments });
}

export function setComposerBusy(root, sending) {
  const send = root.querySelector(".send");
  if (send) {
    send.disabled = Boolean(sending);
  }
}

export function updateComposerButton(root, { mobileVoiceArmed = false, hasPendingAttachments = false } = {}) {
  const input = root.querySelector("#msgInput");
  const mic = root.querySelector("#voiceBtnMain");
  if (!input || !mic) return;
  mic.style.display = (input.value.trim() || hasPendingAttachments) && !mobileVoiceArmed ? "none" : "";
}
