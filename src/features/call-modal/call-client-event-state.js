import { createSiteCopy } from "../../i18n/site-copy.js";

export function applyCallClientEventState(appState, event = {}) {
  const result = {
    finishLifecycle: false,
    mergeMessagesPayload: null,
    refreshGuestChat: false,
  };

  if (event.type === "status") {
    appState.call.status = event.status || appState.call.status;
    appState.call.turnStatus = event.text || appState.call.turnStatus;
    appState.call.sessionId = event.payload?.callSessionId || appState.call.sessionId;
    if (event.status === "ended") {
      result.finishLifecycle = true;
      result.refreshGuestChat = event.payload?.reason === "message_limit_reached";
    }
  }
  if (event.type === "partial" || event.type === "final") {
    appState.call.liveText = event.text || "";
    appState.call.liveSpeaker = "user";
    appState.call.turnStatus = event.type === "final" ? "Heard" : "Listening";
  }
  if (event.type === "assistant") {
    appState.call.liveText = event.payload?.message?.text || appState.call.liveText;
    appState.call.liveSpeaker = "assistant";
    result.mergeMessagesPayload = event.payload;
  }
  if (event.type === "user_message") {
    result.mergeMessagesPayload = event.payload;
  }
  if (event.type === "error") {
    appState.call.status = "error";
    appState.call.error = event.text || "Call is unavailable";
    appState.call.turnStatus = "Call unavailable";
    result.refreshGuestChat = event.payload?.code === "GUEST_MESSAGE_LIMIT_REACHED";
  }
  if (event.type === "diagnostics") {
    appState.call.latencyText = formatCallLatencyText(
      event.diagnostics || {},
      appState.site?.pageLanguage || "English",
    );
  }
  if (event.type === "usage" && appState.chat.guest?.active) {
    appState.chat.guest = {
      ...appState.chat.guest,
      messageLimit: Math.max(0, Number(event.payload?.messageLimit || appState.chat.guest.messageLimit || 0)),
      messageCount: Math.max(0, Number(event.payload?.messageCount || 0)),
    };
    if (appState.chat.guest.messageLimit > 0 && appState.chat.guest.messageCount >= appState.chat.guest.messageLimit) {
      result.refreshGuestChat = true;
    }
  }

  return result;
}

export function formatCallLatencyText(diagnostics = {}, pageLanguage = "English") {
  const copy = createSiteCopy(pageLanguage);
  const parts = [];
  if (diagnostics.heardMs) parts.push(`${copy.t("call.latencyHeard")} ${formatLatencySeconds(diagnostics.heardMs)}`);
  if (diagnostics.assistantWaitMs) parts.push(`${copy.t("call.latencyReply")} ${formatLatencySeconds(diagnostics.assistantWaitMs)}`);
  const timing = diagnostics.timing || {};
  if (timing.replyTotalMs && !diagnostics.assistantWaitMs) {
    parts.push(`${copy.t("call.latencyReply")} ${formatLatencySeconds(timing.replyTotalMs)}`);
  }
  return parts.join(" · ");
}

function formatLatencySeconds(ms = 0) {
  return `${(Math.max(0, Number(ms || 0)) / 1000).toFixed(1)}s`;
}
