import { WebSocket } from "ws";
import { createPublicError } from "./public-error-utils.js";
import { createId } from "./security.js";

export function createCallSession({ client, user = null, guest = null, guestToken = "", networkHash = "" }) {
  return {
    client,
    user,
    guest,
    guestToken,
    networkHash,
    identityType: guest ? "guest" : "user",
    callSessionId: createId("call"),
    turnId: 0,
    characterId: "",
    listening: false,
    processing: false,
    closed: false,
    providerSocket: null,
    stageStartedAt: 0,
    activeTurnId: 0,
    completedTurnIds: new Set(),
    ignoredTurnCount: 0,
    audioChunkLogCount: 0,
    audioRateWindowStartedAt: 0,
    audioRateWindowBytes: 0,
    audioRateWindowFrames: 0,
    listeningStartedAt: 0,
    lastAudioInputAt: 0,
    listeningTurnAudioBytes: 0,
    unfinalizedAudioBytes: 0,
    providerInputEpoch: 0,
    audioProbeCount: 0,
    lastAudioProbeAt: 0,
    turnPhase: "idle",
    guestCallLeaseToken: "",
    guestCallActive: false,
    guestCallMeter: null,
    guestCallMeterRunning: false,
    guestMessageLimitReached: false,
    awaitingResumeStartedAt: 0,
    endGuestCallReason: "",
    guardedInputMilliseconds: 0,
    onMessageLimitReached: null,
    onCloseSession: null,
  };
}

export function closeCallSession(session) {
  if (session.closed) return;
  session.closed = true;
  session.listening = false;
  session.processing = false;
  if (session.providerSocket && session.providerSocket.readyState !== WebSocket.CLOSED) {
    session.providerSocket.close();
  }
  if (session.client?.readyState === WebSocket.OPEN || session.client?.readyState === WebSocket.CONNECTING) {
    session.client.close();
  }
  void session.onCloseSession?.();
}

export function sendEvent(session, type, payload = {}) {
  if (session.closed || session.client.readyState !== WebSocket.OPEN) return;
  session.client.send(JSON.stringify({ type, ...payload }));
}

export function sendErrorEvent(session, error) {
  sendEvent(session, "error", {
    callSessionId: session.callSessionId,
    message: safeString(error?.message) || "Call is unavailable",
    code: safeString(error?.code),
    statusCode: Number(error?.statusCode || 0),
  });
}

export function markGuestProviderGuard(session, error) {
  if (session.identityType !== "guest" || error?.code !== "GUEST_PROVIDER_INPUT_GUARD") return;
  session.endGuestCallReason = "provider_guard";
  session.guardedInputMilliseconds = Math.max(1, Date.now() - Number(session.listeningStartedAt || Date.now()));
}

export function throwUserError(message, statusCode = 400) {
  throw createPublicError(message, statusCode);
}

export function safeString(value = "") {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}
