import { renderAttachmentBubble } from "./chat-attachments.js";
import { voiceButtonHtml } from "./chat-voice.js";
import { characterAvatarHtml } from "../shared-ui/character-avatar.js";
import { renderChatImageMessage } from "./chat-image-message.js";
import { renderProductCard } from "./chat-product-card.js";
import { FEEDBACK_ICON } from "../notifications/notification-panel.js";
import { createSiteCopy } from "../../i18n/site-copy.js";
import { getChatOrderCopy } from "../../../shared/chat-order-copy.js";

export function renderChatMessages({ character, messages, loading, error, pageLanguage = "English", escapeHtml, escapeAttribute }) {
  const copy = createSiteCopy(pageLanguage);
  if (loading && !messages.length) {
    return renderSystemBubble(copy.t("chat.loading"), escapeHtml);
  }
  if (error && !messages.length) {
    return renderSystemBubble(copy.t("chat.loadFailed"), escapeHtml);
  }
  if (!messages.length) {
    return "";
  }
  return messages.map((message) => renderMessage({ character, message, pageLanguage, copy, escapeHtml, escapeAttribute })).join("");
}

function renderMessage({ character, message, pageLanguage, copy, escapeHtml, escapeAttribute }) {
  if (message.contentType === "product") {
    return renderProductCard(message.product || {}, { message, character, pageLanguage, escapeHtml, escapeAttribute });
  }
  if (message.contentType === "attachment") {
    return renderAttachmentMessage({ character, message, pageLanguage, escapeHtml });
  }
  if (message.contentType === "image_generation" || message.contentType === "mascot_greeting_image" || message.contentType === "mascot_library_image") {
    return renderImageGenerationMessage({ character, message, pageLanguage, copy, escapeHtml, escapeAttribute });
  }
  if (message.contentType === "feedback_action") {
    return renderFeedbackActionMessage({ message, copy, escapeHtml, escapeAttribute });
  }
  if (message.contentType === "order_action") {
    return renderOrderActionMessage({ message, pageLanguage, escapeHtml, escapeAttribute });
  }
  if (message.senderType === "user") {
    return renderUserMessage(message, escapeHtml);
  }
  return renderCharacterMessage({ character, message, pageLanguage, escapeHtml, escapeAttribute });
}

function renderOrderActionMessage({ message, pageLanguage, escapeHtml, escapeAttribute }) {
  const action = message.orderAction || message.product || {};
  const { text, label } = getChatOrderCopy(pageLanguage, action.status === "login_required");
  return `<div class="msg them feedback-action-msg"><span class="feedback-action-avatar-spacer" aria-hidden="true"></span><div><div class="bubble">${escapeHtml(text)}</div><button class="feedback-action-btn" type="button" data-open-order-binding data-order-status="${escapeAttribute(action.status || "binding_required")}" data-order-site="${escapeAttribute(action.siteSlug || "")}" aria-label="${escapeAttribute(label)}">${escapeHtml(label)}</button></div></div>`;
}

function renderFeedbackActionMessage({ message, copy, escapeHtml, escapeAttribute }) {
  const action = message.feedbackAction || message.product || {};
  const label = String(action.label || copy.t("chat.feedbackAction")).trim() || copy.t("chat.feedbackAction");
  return `
    <div class="msg them feedback-action-msg">
      <span class="feedback-action-avatar-spacer" aria-hidden="true"></span>
      <div>
        <button class="feedback-action-btn" type="button" data-open-feedback aria-label="${escapeAttribute(label)}">
          ${FEEDBACK_ICON}<span>${escapeHtml(label)}</span>
        </button>
      </div>
    </div>
  `;
}

// Preserve deliberately indented literal content without changing ordinary
// bubbles or their voice controls. Text is escaped before adding presentation.
function renderMessageText(value = "", escapeHtml) {
  const text = String(value || "");
  const escaped = escapeHtml(text);
  return /\r?\n[ \t]+\S/.test(text)
    ? `<span style="white-space:pre-wrap">${escaped}</span>`
    : escaped;
}

function renderUserMessage(message, escapeHtml) {
  return `<div class="msg me"><div class="bubble">${renderMessageText(message.text, escapeHtml)}</div></div>`;
}

function renderImageGenerationMessage({ character, message, pageLanguage, copy, escapeHtml, escapeAttribute }) {
  const imageMarkup = renderChatImageMessage({ message, pageLanguage, copy, escapeHtml, escapeAttribute });
  if (!imageMarkup) return "";
  return `
    <div class="msg them chat-image-msg">
      ${characterAvatarHtml({ name: character.name, imageUrl: character.avatarUrl, className: "av" })}
      <div>
        ${imageMarkup}
        <div class="msg-time">${formatMessageTime(message.sentAt, pageLanguage)}</div>
      </div>
    </div>
  `;
}

function renderAttachmentMessage({ character, message, pageLanguage, escapeHtml }) {
  const isUser = message.senderType === "user";
  const avatar = isUser ? "" : characterAvatarHtml({ name: character.name, imageUrl: character.avatarUrl, className: "av" });
  return `
    <div class="msg ${isUser ? "me" : "them"}">
      ${avatar}
      <div>
        <div class="bubble attachment-bubble">${renderAttachmentBubble(message.attachment || message.product || {}, { pageLanguage })}</div>
        <div class="msg-time">${formatMessageTime(message.sentAt, pageLanguage)}</div>
      </div>
    </div>
  `;
}

function renderCharacterMessage({ character, message, pageLanguage, escapeHtml, escapeAttribute }) {
  const voiceStatus = message.voice?.assetStatus || (message.voice?.audioUrl ? "ready" : "pending");
  const hasPlayableVoice = Boolean(message.voice?.audioUrl) && String(voiceStatus || "").toLowerCase() === "ready";
  const voice = voiceButtonHtml(
    `voice-${escapeAttribute(message.voice?.id || message.id || "message")}`,
    hasPlayableVoice ? message.voice?.durationSeconds || estimateVoiceDuration(message.text) : 0,
    hasPlayableVoice ? message.voice?.audioUrl || "" : "",
    {
      messageId: message.id || "",
      displayOrder: message.displayOrder || 0,
      status: voiceStatus,
      pageLanguage,
    }
  );
  return `
    <div class="msg them">
      ${characterAvatarHtml({ name: character.name, imageUrl: character.avatarUrl, className: "av" })}
      <div>
        <div class="bubble">${renderMessageText(message.text, escapeHtml)}${voice}</div>
        <div class="msg-time">${formatMessageTime(message.sentAt, pageLanguage)}</div>
      </div>
    </div>
  `;
}

function renderSystemBubble(text, escapeHtml) {
  return `<div class="msg them"><div><div class="bubble">${escapeHtml(text)}</div></div></div>`;
}

function formatMessageTime(value, pageLanguage = "English") {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const time = formatHourMinute(date);
  if (isSameLocalDate(date, now)) return time;

  const locale = createSiteCopy(pageLanguage).locale === "zh" ? "zh-CN" : "en-GB";
  const dateText = new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  }).format(date);
  return `${dateText}, ${time}`;
}

function isSameLocalDate(left, right) {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
}

function formatHourMinute(date) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function estimateVoiceDuration(text) {
  const length = String(text || "").trim().length;
  if (!length) return 2;
  return Math.max(2, Math.min(12, Math.ceil(length / 18)));
}
