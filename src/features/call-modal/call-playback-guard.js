import { CALL_STATES } from "./call-state-machine.js";
import { sendSocketEvent } from "./call-websocket-client.js";

export const POST_SPEAK_DELAY_MS = 200;
export const ASSISTANT_RESUME_GUARD_MS = 12000;
const ASSISTANT_RESUME_GUARD_EXTRA_MS = 900;

export function getAssistantResumeGuardDelay(playback) {
  const durationMs = Number.isFinite(playback?.duration) && playback.duration > 0
    ? Math.ceil(playback.duration * 1000) + ASSISTANT_RESUME_GUARD_EXTRA_MS
    : ASSISTANT_RESUME_GUARD_MS;
  return Math.max(ASSISTANT_RESUME_GUARD_EXTRA_MS, durationMs);
}

export async function playAssistantAudio(client, audioUrl) {
  if (client.stopped || !audioUrl) return;
  stopAssistantPlayback(client);
  client.callState = CALL_STATES.SPEAKING;
  client.pausedForAssistant = true;
  client.onEvent({ type: "status", status: "speaking", text: "Speaking" });
  client.playback = new Audio(audioUrl);
  client.playback.addEventListener("loadedmetadata", () => armAssistantResumeGuard(client), { once: true });
  client.playback.addEventListener("ended", () => finishAssistantPlayback(client), { once: true });
  client.playback.addEventListener("error", () => finishAssistantPlayback(client), { once: true });
  armAssistantResumeGuard(client);
  try {
    await client.playback.play();
  } catch {
    finishAssistantPlayback(client);
  }
}

export function stopAssistantPlayback(client) {
  if (!client.playback) return;
  window.clearTimeout(client.resumeGuardTimer);
  client.resumeGuardTimer = null;
  client.playback.pause();
  client.playback.currentTime = 0;
  client.playback = null;
}

export function finishAssistantPlayback(client) {
  client.playback = null;
  resumeListeningAfterDelay(client);
}

export function armAssistantResumeGuard(client) {
  window.clearTimeout(client.resumeGuardTimer);
  client.resumeGuardTimer = window.setTimeout(() => {
    if (client.stopped || !client.pausedForAssistant || client.paused) return;
    finishAssistantPlayback(client);
  }, getAssistantResumeGuardDelay(client.playback));
}

export function resumeListeningAfterDelay(client) {
  window.clearTimeout(client.resumeTimer);
  window.clearTimeout(client.resumeGuardTimer);
  client.resumeGuardTimer = null;
  client.callState = CALL_STATES.COOLDOWN;
  client.resumeTimer = window.setTimeout(() => {
    if (client.stopped) return;
    void client.resumeAudioContext();
    sendSocketEvent(client.socket, { type: "resume_listening" });
  }, POST_SPEAK_DELAY_MS);
}
