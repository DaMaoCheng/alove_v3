import { ICONS } from "../../icons/icons.js";
import { showDialog } from "../shared-ui/dialog.js";
import { createVoiceRecorderSession } from "./chat-voice-recorder.js";
import { createSiteCopy } from "../../i18n/site-copy.js";

let voiceTimer = null;
let voiceSeconds = 0;
let voiceSession = null;
let mobileVoiceArmed = false;

export function bindChatVoiceControls(root, { character, pageLanguage = "English", onVoiceSubmit, onChange } = {}) {
  root.querySelector("#voiceBtnMain")?.addEventListener("click", () => {
    handleVoiceButtonClick(root, { character, pageLanguage, onVoiceSubmit, onChange });
  });
  root.querySelector(".vr-cancel")?.addEventListener("click", () => {
    void cancelVoiceInput(root, { onChange });
  });
  bindMobileVoiceHold(root, { character, pageLanguage, onVoiceSubmit, onChange });
}

export function setMobileVoiceMode(root, armed, { onChange } = {}) {
  mobileVoiceArmed = Boolean(armed);
  root.querySelector(".composer-inner")?.classList.toggle("voice-mode", mobileVoiceArmed);
  root.querySelector("[data-voice-hold]")?.classList.toggle("on", mobileVoiceArmed);
  onChange?.();
}

export function getMobileVoiceArmed() {
  return mobileVoiceArmed;
}

function handleVoiceButtonClick(root, { character, pageLanguage = "English", onVoiceSubmit, onChange } = {}) {
  if (isMobileComposer()) {
    setMobileVoiceMode(root, !mobileVoiceArmed, { onChange });
    return;
  }
  void toggleVoiceInput(root, { character, pageLanguage, onVoiceSubmit, onChange });
}

function bindMobileVoiceHold(root, { character, pageLanguage = "English", onVoiceSubmit, onChange } = {}) {
  const hold = root.querySelector("[data-voice-hold]");
  if (!hold) return;
  const start = (event) => {
    if (!mobileVoiceArmed || voiceSession) return;
    event.preventDefault();
    hold.setPointerCapture?.(event.pointerId);
    hold.classList.add("pressing");
    void startVoiceInput(root);
  };
  const finish = (event) => {
    if (!mobileVoiceArmed) return;
    event.preventDefault();
    hold.releasePointerCapture?.(event.pointerId);
    hold.classList.remove("pressing");
    if (!voiceSession) return;
    void stopVoiceInput(root, { character, pageLanguage, onVoiceSubmit, exitMobileMode: true, onChange });
  };
  hold.addEventListener("pointerdown", start);
  hold.addEventListener("pointerup", finish);
  hold.addEventListener("pointercancel", finish);
  hold.addEventListener("pointerleave", (event) => {
    if (voiceSession) finish(event);
  });
}

async function toggleVoiceInput(root, { character, pageLanguage = "English", onVoiceSubmit, onChange } = {}) {
  if (voiceSession) {
    await stopVoiceInput(root, { character, pageLanguage, onVoiceSubmit, onChange });
    return;
  }
  await startVoiceInput(root, { pageLanguage });
}

async function startVoiceInput(root, { pageLanguage = "English" } = {}) {
  const recorder = root.querySelector("#voiceRec");
  const inner = root.querySelector(".composer-inner");
  if (!recorder) return;

  try {
    voiceSession = await createVoiceRecorderSession({
      onTick: (seconds) => {
        voiceSeconds = seconds;
        updateVoiceTimer(root, seconds);
      },
    });
    recorder.classList.add("on");
    inner?.classList.add("recording");
    setVoiceButtonRecording(root, true);
    updateVoiceTimer(root, 0);
  } catch (error) {
    voiceSession = null;
    root.querySelector("[data-voice-hold]")?.classList.remove("pressing");
    showVoiceError({
      pageLanguage,
      reason: error.message,
      fallbackType: "microphone",
    });
  }
}

async function stopVoiceInput(root, { character, pageLanguage = "English", onVoiceSubmit, exitMobileMode = false, onChange } = {}) {
  const session = voiceSession;
  if (!session) return;
  voiceSession = null;
  setVoiceSending(root, true);
  try {
    const clip = await session.stop();
    resetVoiceInput(root, { exitMobileMode, onChange });
    if (!clip) return;
    await onVoiceSubmit?.(clip);
  } catch (error) {
    resetVoiceInput(root, { exitMobileMode, onChange });
    showVoiceError({
      pageLanguage,
      reason: error.message,
      fallbackType: "send",
    });
  } finally {
    setVoiceSending(root, false);
  }
}

async function cancelVoiceInput(root, { onChange } = {}) {
  const session = voiceSession;
  voiceSession = null;
  try {
    await session?.cancel();
  } finally {
    resetVoiceInput(root, { exitMobileMode: false, onChange });
  }
}

function resetVoiceInput(root, { exitMobileMode = false, onChange } = {}) {
  window.clearInterval(voiceTimer);
  voiceSeconds = 0;
  root.querySelector("#voiceRec")?.classList.remove("on");
  root.querySelector(".composer-inner")?.classList.remove("recording");
  root.querySelector("[data-voice-hold]")?.classList.remove("pressing");
  setVoiceButtonRecording(root, false);
  if (exitMobileMode) setMobileVoiceMode(root, false, { onChange });
  updateVoiceTimer(root, 0);
}

function setVoiceButtonRecording(root, recording) {
  const mic = root.querySelector("#voiceBtnMain");
  if (!mic) return;
  const copy = createSiteCopy(root.dataset.pageLanguage || "English");
  mic.classList.toggle("recording", Boolean(recording));
  mic.innerHTML = recording ? ICONS.stop : ICONS.mic;
  mic.setAttribute("aria-label", recording ? copy.t("chat.voiceStopSend") : copy.t("chat.voice"));
}

function isMobileComposer() {
  return window.matchMedia?.("(max-width: 760px)").matches || window.innerWidth <= 760;
}

function updateVoiceTimer(root, seconds) {
  const safeSeconds = Math.max(0, Math.round(Number(seconds || 0)));
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  const timer = root.querySelector("#voiceRecTime");
  if (timer) timer.textContent = `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function setVoiceSending(root, sending) {
  const mic = root.querySelector("#voiceBtnMain");
  if (mic) mic.disabled = Boolean(sending);
}

function showVoiceError({ pageLanguage = "English", reason = "", fallbackType = "send" } = {}) {
  const copy = getVoiceErrorCopy(pageLanguage, { reason, fallbackType });
  showDialog({
    type: "error",
    title: copy.title,
    message: copy.message,
    confirmText: copy.confirmText,
  });
}

function getVoiceErrorCopy(pageLanguage = "English", { reason = "", fallbackType = "send" } = {}) {
  const copy = createSiteCopy(pageLanguage);
  return {
    title: copy.t("chat.voiceFailedTitle"),
    message: fallbackType === "microphone"
      ? copy.t("chat.microphoneFailed")
      : copy.t("chat.voiceSendFailed"),
    confirmText: copy.t("common.gotIt"),
  };
}
