import { ICONS } from "../../icons/icons.js";
import { collectPlayableVoiceMessages, createChatVoicePlaybackQueue } from "./chat-voice-playback-queue.js";
import { createSiteCopy } from "../../i18n/site-copy.js";

let activeQueue = null;
let activeRoot = null;
let voicePlaybackGlobalBound = false;

export function voiceButtonHtml(id, seconds, audioUrl = "", { messageId = "", status = "ready", displayOrder = 0, pageLanguage = "English" } = {}) {
  const copy = createSiteCopy(pageLanguage);
  const normalizedStatus = normalizeVoiceStatus(status);
  const disabled = !audioUrl || normalizedStatus !== "ready";
  const displayedSeconds = disabled ? 0 : seconds;
  return `
    <button class="voice-btn ${disabled ? "is-disabled" : ""}" id="${id}" data-voice-play data-voice-message-id="${escapeAttribute(messageId)}" data-voice-status="${escapeAttribute(normalizedStatus)}" data-voice-order="${escapeAttribute(displayOrder)}" data-audio-url="${escapeAttribute(audioUrl)}" data-page-language="${escapeAttribute(copy.language.code)}" aria-label="${escapeAttribute(disabled ? copy.t("chat.voiceUnavailable") : copy.t("chat.playVoice"))}" ${disabled ? "disabled" : ""}>
      <span class="vb-ic">${statusIcon(normalizedStatus)}</span>
      <span class="vb-wave"><i></i><i></i><i></i><i></i><i></i></span>
      <span class="vb-time">${formatDuration(displayedSeconds)}</span>
    </button>
  `;
}

export function bindVoicePlayback(root, { messages = [], autoPlayMessageIds = [] } = {}) {
  stopPlaybackForPreviousRoot(root);
  bindVoicePlaybackGlobalStops();
  activeRoot = root;
  activeQueue = createChatVoicePlaybackQueue({
    onStateChange: (state) => syncVoiceButtons(root, state),
  });

  root.querySelectorAll("[data-voice-play]").forEach((button) => {
    button.addEventListener("click", () => toggleVoicePlayback(root, button));
  });

  activeQueue.enqueue(collectPlayableVoiceMessages(messages, { messageIds: autoPlayMessageIds }));
  void activeQueue.playNext();
  watchMountedRoot(root);
}

function toggleVoicePlayback(root, button) {
  if (!activeQueue || button.disabled) return;
  const state = activeQueue.getState();
  const messageId = button.dataset.voiceMessageId || "";
  const isCurrent = state.currentMessageId === messageId;
  const isPlaying = button.classList.contains("playing");

  if (isCurrent && isPlaying) {
    activeQueue.pauseAll();
    return;
  }

  const audioUrl = button.dataset.audioUrl || "";
  if (!audioUrl || !messageId) return;
  activeQueue.stopAll();
  activeQueue.enqueue([{
    messageId,
    voiceId: button.id,
    audioUrl,
    displayOrder: Number(button.dataset.voiceOrder || 0),
  }], { force: true });
  void activeQueue.resumeAuto();
  syncVoiceButtons(root, activeQueue.getState());
}

function syncVoiceButtons(root, state) {
  root.querySelectorAll("[data-voice-play]").forEach((button) => {
    const isCurrent = button.dataset.voiceMessageId && button.dataset.voiceMessageId === state.currentMessageId;
    button.classList.toggle("playing", Boolean(isCurrent));
    if (!button.disabled) {
      button.querySelector(".vb-ic").innerHTML = isCurrent ? ICONS.pause : statusIcon(button.dataset.voiceStatus);
      const copy = createSiteCopy(button.dataset.pageLanguage || "English");
      button.setAttribute("aria-label", isCurrent ? copy.t("chat.pauseVoice") : copy.t("chat.playVoice"));
    }
  });
}

function stopPlaybackForPreviousRoot(nextRoot) {
  if (!activeQueue) return;
  if (activeRoot && activeRoot === nextRoot) return;
  activeQueue.stopAll();
  activeQueue = null;
  activeRoot = null;
}

function bindVoicePlaybackGlobalStops() {
  if (voicePlaybackGlobalBound) return;
  voicePlaybackGlobalBound = true;
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) softStopActiveQueue();
  });
  window.addEventListener("blur", softStopActiveQueue);
  window.addEventListener("pagehide", stopActiveQueue);
  window.addEventListener("beforeunload", stopActiveQueue);
}

function watchMountedRoot(root) {
  const tick = () => {
    if (activeRoot !== root) return;
    if (!root.isConnected) {
      stopActiveQueue();
      return;
    }
    window.requestAnimationFrame(tick);
  };
  window.requestAnimationFrame(tick);
}

function stopActiveQueue() {
  if (!activeQueue) return;
  activeQueue.stopAll();
  activeQueue = null;
  activeRoot = null;
}

function softStopActiveQueue() {
  if (!activeQueue) return;
  activeQueue.stopAll();
}

function statusIcon(status = "ready") {
  const normalized = normalizeVoiceStatus(status);
  if (normalized === "failed") return ICONS.alert || ICONS.play;
  if (normalized === "pending") return ICONS.clock || ICONS.play;
  return ICONS.play;
}

function normalizeVoiceStatus(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized || "ready";
}

function formatDuration(seconds) {
  const safeSeconds = Math.max(0, Math.round(Number(seconds || 0)));
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function escapeAttribute(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
