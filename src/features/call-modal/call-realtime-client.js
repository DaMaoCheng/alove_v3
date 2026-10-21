import { createCallAudioCapture, buildAudioProbePayload, getCallAudioConstraints } from "./call-audio-capture.js";
import { playAssistantAudio, resumeListeningAfterDelay, stopAssistantPlayback } from "./call-playback-guard.js";
import { CALL_STATES } from "./call-state-machine.js";
import { openCallSocket, parseSocketPayload, sendSocketEvent } from "./call-websocket-client.js";
import { emitCallDiagnostics } from "./call-client-diagnostics.js";

const AUDIO_PROBE_INTERVAL_MS = 1000;
const AUDIO_PROBE_MAX_COUNT = 8;

export class RealtimeCallClient {
  constructor({
    characterId,
    onEvent = () => {},
  } = {}) {
    this.characterId = characterId;
    this.onEvent = onEvent;
    this.socket = null;
    this.stream = null;
    this.audioContext = null;
    this.sourceNode = null;
    this.processorNode = null;
    this.muted = false;
    this.paused = false;
    this.pausedForAssistant = false;
    this.stopped = false;
    this.playback = null;
    this.resumeTimer = null;
    this.resumeGuardTimer = null;
    this.turnStartedAt = 0;
    this.transcriptFinalAt = 0;
    this.assistantAudioAt = 0;
    this.callState = CALL_STATES.IDLE;
    this.turnId = 0;
    this.activeTurnId = 0;
    this.sentFramesInTurn = 0;
    this.audioProcessTicks = 0;
    this.audioProbeCount = 0;
    this.lastAudioProbeAt = 0;
    this.handlePageHide = () => this.stop();
  }

  async start() {
    if (!this.characterId) throw new Error("Missing character");
    try {
      this.stopped = false;
      this.callState = CALL_STATES.CONNECTING;
      this.onEvent({ type: "status", status: "connecting", text: "Connecting" });
      this.stream = await navigator.mediaDevices.getUserMedia({
        ...getCallAudioConstraints(),
      });
      await this.startAudioCapture();
      await this.openSocket();
      window.addEventListener("pagehide", this.handlePageHide, { once: true });
    } catch (error) {
      this.stop();
      throw error;
    }
  }

  stop() {
    this.stopped = true;
    window.removeEventListener("pagehide", this.handlePageHide);
    window.clearTimeout(this.resumeTimer);
    window.clearTimeout(this.resumeGuardTimer);
    this.resumeTimer = null;
    this.resumeGuardTimer = null;
    stopAssistantPlayback(this);
    this.callState = CALL_STATES.ENDED;
    sendSocketEvent(this.socket, { type: "end_call" });
    this.socket?.close();
    this.socket = null;
    this.processorNode?.disconnect();
    this.sourceNode?.disconnect();
    this.audioContext?.close?.();
    this.processorNode = null;
    this.sourceNode = null;
    this.audioContext = null;
    this.stream?.getTracks?.().forEach((track) => track.stop());
    this.stream = null;
  }

  setMuted(nextMuted) {
    this.muted = Boolean(nextMuted);
    this.onEvent({
      type: "status",
      status: this.muted ? "muted" : "listening",
      text: this.muted ? "Muted" : "Listening",
    });
  }

  setPaused(nextPaused) {
    if (this.stopped || this.callState === CALL_STATES.ENDED) return;
    this.paused = Boolean(nextPaused);
    if (this.paused) stopAssistantPlayback(this);
    if (!this.paused) {
      this.beginListeningTurn();
      void this.resumeAudioContext();
      sendSocketEvent(this.socket, { type: "resume_listening" });
    } else {
      this.callState = CALL_STATES.PAUSED;
    }
    this.onEvent({
      type: "status",
      status: this.paused ? "paused" : "listening",
      text: this.paused ? "Paused" : "Listening",
    });
  }

  async startAudioCapture() {
    const capture = await createCallAudioCapture({
      stream: this.stream,
      onProcessAudio: ({ input, encodeAudio }) => {
        this.audioProcessTicks += 1;
        this.maybeSendAudioProbe(input);
        if (!this.shouldSendAudioFrame(input)) return;
        const audio = encodeAudio();
        if (!audio) return;
        if (!this.turnStartedAt) {
          this.turnStartedAt = performance.now();
          this.transcriptFinalAt = 0;
          this.assistantAudioAt = 0;
        }
        sendSocketEvent(this.socket, {
          type: "audio_chunk",
          turnId: this.activeTurnId,
          audio,
        });
      },
    });
    this.audioContext = capture.audioContext;
    this.sourceNode = capture.sourceNode;
    this.processorNode = capture.processorNode;
  }

  openSocket() {
    return openCallSocket({
      characterId: this.characterId,
      onMessage: (event) => this.handleSocketMessage(event),
      onError: () => {
        this.onEvent({ type: "error", text: "Call is unavailable" });
      },
      onClose: () => {
        if (!this.stopped) {
          this.onEvent({ type: "status", status: "ended", text: "Call ended" });
          this.stop();
        }
      },
    }).then((socket) => {
      this.socket = socket;
    });
  }

  handleSocketMessage(event) {
    if (this.stopped) return;
    const payload = parseSocketPayload(event.data);
    if (!payload?.type) return;
    if (payload.type === "call_ready") {
      this.onEvent({ type: "status", status: "ready", text: "Connected", payload });
      return;
    }
    if (payload.type === "listening") {
      this.beginListeningTurn();
      void this.resumeAudioContext();
      this.onEvent({ type: "status", status: "listening", text: "Listening", payload });
      return;
    }
    if (payload.type === "transcript_partial") {
      this.onEvent({ type: "partial", text: payload.text || "", payload });
      return;
    }
    if (payload.type === "transcript_final") {
      if (payload.turnId && Number(payload.turnId) !== this.activeTurnId) return;
      this.finishListeningTurn();
      this.transcriptFinalAt = performance.now();
      this.onEvent({ type: "final", text: payload.text || "", payload });
      emitCallDiagnostics(this, payload);
      return;
    }
    if (payload.type === "assistant_thinking") {
      this.callState = CALL_STATES.THINKING;
      this.pausedForAssistant = true;
      this.onEvent({ type: "status", status: "thinking", text: "Replying", payload });
      return;
    }
    if (payload.type === "user_message") {
      this.onEvent({ type: "user_message", payload });
      return;
    }
    if (payload.type === "assistant_audio") {
      this.assistantAudioAt = performance.now();
      this.onEvent({ type: "assistant", payload });
      emitCallDiagnostics(this, payload);
      void playAssistantAudio(this, payload.audioUrl);
      return;
    }
    if (payload.type === "assistant_text") {
      this.assistantAudioAt = performance.now();
      this.onEvent({ type: "assistant", payload });
      emitCallDiagnostics(this, payload);
      resumeListeningAfterDelay(this);
      return;
    }
    if (payload.type === "error") {
      this.onEvent({ type: "error", text: payload.message || "Call is unavailable", payload });
      resumeListeningAfterDelay(this);
      return;
    }
    if (payload.type === "call_ended") {
      this.callState = CALL_STATES.ENDED;
      this.onEvent({ type: "status", status: "ended", text: "Call ended", payload });
      this.stop();
      return;
    }
    if (payload.type === "call_usage") {
      this.onEvent({ type: "usage", payload });
    }
  }

  async resumeAudioContext() {
    if (this.audioContext?.state === "suspended") {
      try {
        await this.audioContext.resume();
      } catch {
        // The next user gesture or audio process tick can retry; call flow should not crash here.
      }
    }
  }

  beginListeningTurn() {
    if (this.stopped || this.paused) return;
    this.turnId += 1;
    this.activeTurnId = this.turnId;
    this.sentFramesInTurn = 0;
    this.turnStartedAt = 0;
    this.transcriptFinalAt = 0;
    this.assistantAudioAt = 0;
    this.callState = CALL_STATES.LISTENING;
    this.pausedForAssistant = false;
  }

  finishListeningTurn() {
    this.callState = CALL_STATES.FINALIZING;
    this.pausedForAssistant = true;
  }

  shouldSendAudioFrame() {
    if (this.stopped || this.muted || this.paused || this.pausedForAssistant || this.socket?.readyState !== WebSocket.OPEN) return false;
    if (this.callState !== CALL_STATES.LISTENING) return false;
    this.sentFramesInTurn += 1;
    return true;
  }

  maybeSendAudioProbe(input) {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    if (this.audioProbeCount >= AUDIO_PROBE_MAX_COUNT) return;
    const now = performance.now();
    if (now - this.lastAudioProbeAt < AUDIO_PROBE_INTERVAL_MS) return;
    this.lastAudioProbeAt = now;
    this.audioProbeCount += 1;
    sendSocketEvent(this.socket, buildAudioProbePayload({
      input,
      turnId: this.activeTurnId,
      callState: this.callState,
      muted: this.muted,
      paused: this.paused,
      pausedForAssistant: this.pausedForAssistant,
      audioProcessTicks: this.audioProcessTicks,
      sentFramesInTurn: this.sentFramesInTurn,
    }));
  }
}
