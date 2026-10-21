import { ICONS } from "../../icons/icons.js";
import { showToast } from "../shared-ui/toast.js";
import { createSiteCopy } from "../../i18n/site-copy.js";

let activeVoicePreviewAudio = null;
let activeVoicePreviewButton = null;
let activeVoicePreviewFrame = 0;
let voicePreviewGlobalBound = false;

export function bindVoicePreviewButtons(page, pageLanguage = "English") {
  const copy = createSiteCopy(pageLanguage);
  bindVoicePreviewGlobalStops();
  page.querySelectorAll("[data-voice-preview]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const sampleUrl = button.dataset.voicePreview || "";
      if (!sampleUrl) return;

      if (activeVoicePreviewButton === button && activeVoicePreviewAudio && !activeVoicePreviewAudio.paused) {
        stopActiveVoicePreview();
        return;
      }

      stopActiveVoicePreview();
      activeVoicePreviewAudio = new Audio(sampleUrl);
      activeVoicePreviewButton = button;
      setVoicePreviewButtonPlaying(button, true, copy);
      activeVoicePreviewAudio.addEventListener("ended", stopActiveVoicePreview, { once: true });
      activeVoicePreviewAudio.play()
        .then(() => watchVoicePreviewPage(page))
        .catch(() => {
          stopActiveVoicePreview();
          showToast(copy.t("create.voiceUnavailable"));
        });
    });
  });
}

function bindVoicePreviewGlobalStops() {
  if (voicePreviewGlobalBound) return;
  voicePreviewGlobalBound = true;
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopActiveVoicePreview();
  });
  window.addEventListener("pagehide", stopActiveVoicePreview);
  window.addEventListener("beforeunload", stopActiveVoicePreview);
}

function watchVoicePreviewPage(page) {
  window.cancelAnimationFrame(activeVoicePreviewFrame);
  const tick = () => {
    if (!activeVoicePreviewAudio || activeVoicePreviewAudio.paused) return;
    if (!page.isConnected) {
      stopActiveVoicePreview();
      return;
    }
    activeVoicePreviewFrame = window.requestAnimationFrame(tick);
  };
  activeVoicePreviewFrame = window.requestAnimationFrame(tick);
}

function stopActiveVoicePreview() {
  window.cancelAnimationFrame(activeVoicePreviewFrame);
  activeVoicePreviewFrame = 0;
  if (activeVoicePreviewAudio) {
    activeVoicePreviewAudio.pause();
    activeVoicePreviewAudio.currentTime = 0;
    activeVoicePreviewAudio = null;
  }
  if (activeVoicePreviewButton) {
    setVoicePreviewButtonPlaying(activeVoicePreviewButton, false);
    activeVoicePreviewButton = null;
  }
}

function setVoicePreviewButtonPlaying(button, isPlaying, copy = createSiteCopy(globalThis.document?.documentElement?.lang || "English")) {
  button.classList.toggle("is-playing", isPlaying);
  button.setAttribute("aria-label", isPlaying ? copy.t("create.voicePause") : copy.t("create.playVoice", { name: "" }).trim());
  button.innerHTML = isPlaying ? ICONS.pause : ICONS.play;
}
