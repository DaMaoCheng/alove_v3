import { WebSocketServer } from "ws";
import { requireAuth } from "./auth-service.js";
import {
  closeCallSession,
  createCallSession,
  markGuestProviderGuard,
  safeString,
  sendErrorEvent,
  sendEvent,
  throwUserError,
} from "./call-session-service.js";
import { CALL_CLIENT_MAX_PAYLOAD_BYTES, assertGuestCallProviderGuard, consumeCallAudioInput, consumeCallAudioProbe, parseAndValidateCallClientMessage } from "./call-input-guard-service.js";
import { logCallAudioEvent } from "./call-diagnostics-service.js";
import { connectProviderSocket, sendAudioChunkToProvider } from "./call-provider-socket-service.js";
import { handleFinalTranscript } from "./call-turn-service.js";
import { readAuthToken, readCookie } from "./http-utils.js";
import { assertPublicAppOrigin } from "./request-origin-service.js";
import { GUEST_COOKIE_NAME, requireGuest } from "./guest-chat-service.js";
import { buildGuestNetworkHash } from "./guest-network-rate-limit-service.js";
import { accountGuestCall, endGuestCall, startGuestCall } from "./guest-call-usage-service.js";

const GUEST_CALL_METER_INTERVAL_MS = 1000;
const activeGuestCallSessions = new Map();

export function createRealtimeCallService({ server } = {}) {
  if (!server) throw new Error("HTTP server is required for realtime call service");

  const wss = new WebSocketServer({ noServer: true, maxPayload: CALL_CLIENT_MAX_PAYLOAD_BYTES });

  server.on("upgrade", async (req, socket, head) => {
    const pathname = new URL(req.url || "/", "http://localhost").pathname;
    if (pathname !== "/ws/call") {
      socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }

    try {
      const principal = await resolveCallPrincipal(req);
      wss.handleUpgrade(req, socket, head, (client) => {
        wss.emit("connection", client, req, principal);
      });
    } catch (error) {
      socket.write(`HTTP/1.1 ${Number(error?.statusCode || 401)} Unauthorized\r\nConnection: close\r\n\r\n`);
      socket.destroy();
    }
  });

  wss.on("connection", (client, req, principal) => {
    const session = createCallSession({ client, user: principal.user, guest: principal.guest, guestToken: principal.guestToken, networkHash: principal.networkHash });
    session.onCloseSession = () => finalizeGuestCallSession(session);
    session.onMessageLimitReached = () => closeCallSession(session);
    client.on("message", (data) => void handleClientMessage(session, data));
    client.on("close", () => closeCallSession(session));
    client.on("error", () => closeCallSession(session));
    sendEvent(session, "call_ready", {
      callSessionId: session.callSessionId,
      ...(session.user?.id ? { userId: session.user.id } : { guest: true }),
    });
  });

  return { close: () => new Promise((resolve) => wss.close(resolve)) };
}

async function handleClientMessage(session, data) {
  let payload = null;
  try {
    payload = parseAndValidateCallClientMessage(data);
    if (payload.type === "start_call") {
      if (session.turnPhase !== "idle") throwUserError("Call has already started.", 409);
      session.characterId = safeString(payload.characterId);
      if (!session.characterId || session.characterId.length > 128) throwUserError("Missing character", 400);
      if (session.identityType === "guest" && !session.guestCallActive) {
        await activateGuestCallSession(session);
      }
      await connectProviderSocket(session, { onFinalTranscript: handleFinalTranscript });
      session.listening = true;
      session.turnPhase = "listening";
      sendEvent(session, "listening", { callSessionId: session.callSessionId });
      return;
    }

    if (payload.type === "audio_chunk") {
      const audio = consumeCallAudioInput(session, payload.audio);
      if (session.identityType === "guest" && !session.guestCallActive) return;
      if (!session.listening || session.processing) {
        logCallAudioEvent(session, {
          event: "audio_chunk_rejected",
          reason: !session.listening ? "not_listening" : "processing",
          turnId: Number(payload.turnId || 0),
        });
        return;
      }
      const turnId = Number(payload.turnId || 0);
      if (!turnId || turnId < session.activeTurnId || session.completedTurnIds.has(turnId)) {
        session.ignoredTurnCount += 1;
        logCallAudioEvent(session, {
          event: "audio_chunk_rejected",
          reason: !turnId ? "missing_turn" : "stale_or_completed_turn",
          turnId,
        });
        sendEvent(session, "stale_turn_ignored", {
          callSessionId: session.callSessionId,
          turnId,
          ignoredTurnCount: session.ignoredTurnCount,
        });
        return;
      }
      session.activeTurnId = turnId;
      if (session.lastLoggedAudioTurnId !== turnId) {
        session.lastLoggedAudioTurnId = turnId;
        session.audioChunkLogCount = 0;
      }
      sendAudioChunkToProvider(session, audio);
      return;
    }

    if (payload.type === "audio_probe") {
      if (!consumeCallAudioProbe(session)) return;
      logCallAudioEvent(session, {
        event: "audio_probe",
        turnId: Number(payload.turnId || 0),
        clientState: safeString(payload.callState).slice(0, 32),
        muted: Boolean(payload.muted),
        paused: Boolean(payload.paused),
        pausedForAssistant: Boolean(payload.pausedForAssistant),
        audioProcessTicks: Number(payload.audioProcessTicks || 0),
        sentFramesInTurn: Number(payload.sentFramesInTurn || 0),
        rms: Number(payload.rms || 0),
      });
      return;
    }

    if (payload.type === "resume_listening") {
      if (session.turnPhase !== "awaiting_resume" || session.processing) return;
      if (session.identityType === "guest" && session.guestMessageLimitReached) {
        sendEvent(session, "call_ended", { callSessionId: session.callSessionId, reason: "message_limit_reached" });
        session.endGuestCallReason = "message_limit_reached";
        closeCallSession(session);
        return;
      }
      await connectProviderSocket(session, { onFinalTranscript: handleFinalTranscript });
      session.processing = false;
      session.listening = true;
      session.turnPhase = "listening";
      session.awaitingResumeStartedAt = 0;
      sendEvent(session, "listening", { callSessionId: session.callSessionId });
      return;
    }

    if (payload.type === "end_call") {
      sendEvent(session, "call_ended", { callSessionId: session.callSessionId });
      closeCallSession(session);
    }
  } catch (error) {
    markGuestProviderGuard(session, error);
    sendErrorEvent(session, error);
    if (error?.closeCallSocket || payload?.type === "start_call") {
      closeCallSession(session);
      return;
    }
  }
}

async function resolveCallPrincipal(req) {
  assertPublicAppOrigin(req);
  const authToken = readAuthToken(req);
  if (authToken) return { user: await requireAuth(req, readAuthToken), guest: null, guestToken: "", networkHash: "" };
  const guestToken = readCookie(req, GUEST_COOKIE_NAME);
  return { user: null, guest: await requireGuest(guestToken), guestToken, networkHash: buildGuestNetworkHash(req) };
}

async function activateGuestCallSession(session) {
  const usage = await startGuestCall({
    token: session.guestToken,
    callSessionId: session.callSessionId,
    characterId: session.characterId,
    networkHash: session.networkHash,
  });
  session.guest = { ...session.guest, id: usage.guestSessionId };
  session.guestCallLeaseToken = usage.leaseToken;
  session.guestCallActive = true;
  const replaced = activeGuestCallSessions.get(usage.guestSessionId);
  if (replaced && replaced !== session && !replaced.closed) {
    sendEvent(replaced, "call_ended", { callSessionId: replaced.callSessionId, reason: "replaced" });
    closeCallSession(replaced);
  }
  activeGuestCallSessions.set(usage.guestSessionId, session);
  sendEvent(session, "call_usage", callUsagePayload(session, usage));
  session.guestCallMeter = setInterval(() => void meterGuestCallSession(session), GUEST_CALL_METER_INTERVAL_MS);
}

async function meterGuestCallSession(session) {
  if (session.closed || !session.guestCallActive || session.guestCallMeterRunning) return;
  session.guestCallMeterRunning = true;
  try {
    assertGuestCallProviderGuard(session);
    const usage = await accountGuestCall({
      guestSessionId: session.guest?.id,
      callSessionId: session.callSessionId,
      leaseToken: session.guestCallLeaseToken,
      pendingInputMilliseconds: pendingInputMilliseconds(session), pendingInputEpoch: session.providerInputEpoch,
    });
    session.guestCallActive = usage.active;
    sendEvent(session, "call_usage", callUsagePayload(session, usage));
    if (!usage.active) {
      sendEvent(session, "call_ended", {
        callSessionId: session.callSessionId,
        reason: usage.reason,
      });
      closeCallSession(session);
    }
  } catch (error) {
    markGuestProviderGuard(session, error);
    sendErrorEvent(session, error);
    closeCallSession(session);
  } finally {
    session.guestCallMeterRunning = false;
  }
}

async function finalizeGuestCallSession(session) {
  if (session.guestCallMeter) clearInterval(session.guestCallMeter);
  session.guestCallMeter = null;
  if (session.identityType !== "guest" || !session.guestCallLeaseToken) return;
  if (activeGuestCallSessions.get(session.guest?.id) === session) activeGuestCallSessions.delete(session.guest.id);
  const leaseToken = session.guestCallLeaseToken;
  session.guestCallLeaseToken = "";
  session.guestCallActive = false;
  await endGuestCall({ guestSessionId: session.guest?.id, callSessionId: session.callSessionId, leaseToken,
    status: session.endGuestCallReason || "ended",
    guardedInputMilliseconds: Math.max(Number(session.guardedInputMilliseconds || 0), pendingInputMilliseconds(session)) }).catch((error) => {
    console.warn("[aiove] guest call finalization failed:", error.message);
  });
}

function callUsagePayload(session, usage) { return { callSessionId: session.callSessionId, messageCount: usage.messageCount, messageLimit: usage.messageLimit, remainingMessages: usage.remainingMessages }; }

function pendingInputMilliseconds(session) { return Math.max(0, Math.ceil(Number(session.unfinalizedAudioBytes || 0) / 32)); }
