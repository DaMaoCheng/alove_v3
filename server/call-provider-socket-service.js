import { WebSocket } from "ws";
import {
  buildElevenLabsRealtimeSttHeaders,
  buildElevenLabsRealtimeSttUrl,
  normalizeElevenLabsRealtimeEvent,
  parseRealtimeMessage,
  resolveElevenLabsRealtimeSttConfig,
} from "./elevenlabs-realtime-stt-service.js";
import { logCallAudioEvent } from "./call-diagnostics-service.js";
import { recordProviderCallLog } from "./ai-reply-log-service.js";
import { safeString, sendErrorEvent, sendEvent } from "./call-session-service.js";
import { CALL_PROVIDER_MAX_BUFFERED_BYTES, callInputError } from "./call-input-guard-service.js";

const SAMPLE_RATE = 16000;

export async function connectProviderSocket(session, { onFinalTranscript } = {}) {
  if (session.providerSocket?.readyState === WebSocket.OPEN || session.providerSocket?.readyState === WebSocket.CONNECTING) {
    return;
  }

  const config = resolveElevenLabsRealtimeSttConfig();
  const startedAt = Date.now();
  let providerCallLogged = false;
  const providerSocket = new WebSocket(buildElevenLabsRealtimeSttUrl({ config, sampleRate: SAMPLE_RATE }), {
    headers: buildElevenLabsRealtimeSttHeaders(config),
  });
  session.providerSocket = providerSocket;

  providerSocket.on("message", (data) => {
    const normalized = normalizeElevenLabsRealtimeEvent(parseRealtimeMessage(data));
    if (!normalized || session.closed) return;
    if (normalized.type === "partial") {
      sendEvent(session, "transcript_partial", {
        callSessionId: session.callSessionId,
        text: normalized.text,
      });
      return;
    }
    if (normalized.type === "final") {
      void onFinalTranscript?.(session, normalized.text, session.activeTurnId);
      return;
    }
    if (normalized.type === "error") {
      sendErrorEvent(session, new Error(normalized.text));
    }
  });

  providerSocket.on("error", (error) => {
    if (!providerCallLogged) {
      void recordProviderCallLog({
        provider: "elevenlabs", model: config.model, baseUrl: config.baseUrl,
        sourceRef: "elevenlabs-realtime-stt", status: "error", startedAt, error,
      });
      providerCallLogged = true;
    }
    sendErrorEvent(session, error);
  });
  providerSocket.on("close", () => {
    if (!session.closed && session.client.readyState === WebSocket.OPEN) {
      sendEvent(session, "call_ended", { callSessionId: session.callSessionId });
    }
  });

  try {
    await waitForSocketOpen(providerSocket);
    await recordProviderCallLog({
      provider: "elevenlabs", model: config.model, baseUrl: config.baseUrl,
      sourceRef: "elevenlabs-realtime-stt", status: "success", startedAt,
    });
    providerCallLogged = true;
  } catch (error) {
    if (!providerCallLogged) {
      await recordProviderCallLog({
        provider: "elevenlabs", model: config.model, baseUrl: config.baseUrl,
        sourceRef: "elevenlabs-realtime-stt", status: "error", startedAt, error,
      });
      providerCallLogged = true;
    }
    throw error;
  }
  session.listeningStartedAt = Date.now();
  session.lastAudioInputAt = session.listeningStartedAt;
  session.listeningTurnAudioBytes = 0;
}

export function sendAudioChunkToProvider(session, audio = "") {
  if (session.providerSocket?.readyState !== WebSocket.OPEN) {
    logCallAudioEvent(session, {
      event: "audio_chunk_rejected",
      reason: "provider_socket_not_open",
      turnId: session.activeTurnId,
      providerReadyState: session.providerSocket?.readyState ?? -1,
    });
    return;
  }
  if (Number(session.providerSocket.bufferedAmount || 0) > CALL_PROVIDER_MAX_BUFFERED_BYTES) {
    throw callInputError("Call audio is arriving too quickly.");
  }
  const normalizedAudio = safeString(audio);
  if (!normalizedAudio) {
    logCallAudioEvent(session, {
      event: "audio_chunk_rejected",
      reason: "empty_audio",
      turnId: session.activeTurnId,
    });
    return;
  }
  if (session.audioChunkLogCount < 5) {
    session.audioChunkLogCount += 1;
    logCallAudioEvent(session, {
      event: "audio_chunk_forwarded",
      turnId: session.activeTurnId,
      chunkCount: session.audioChunkLogCount,
      audioLength: normalizedAudio.length,
    });
  }
  session.providerSocket.send(JSON.stringify({
    message_type: "input_audio_chunk",
    audio_base_64: normalizedAudio,
    commit: false,
    sample_rate: SAMPLE_RATE,
  }));
}

export function resetProviderSocketForNextTurn(session) {
  if (session.providerSocket && session.providerSocket.readyState !== WebSocket.CLOSED) {
    session.providerSocket.removeAllListeners("message");
    session.providerSocket.removeAllListeners("error");
    session.providerSocket.removeAllListeners("close");
    session.providerSocket.close();
  }
  session.providerSocket = null;
}

function waitForSocketOpen(socket) {
  if (socket.readyState === WebSocket.OPEN) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      socket.off("open", handleOpen);
      socket.off("error", handleError);
    };
    const handleOpen = () => {
      cleanup();
      resolve();
    };
    const handleError = (error) => {
      cleanup();
      reject(error);
    };
    socket.once("open", handleOpen);
    socket.once("error", handleError);
  });
}
