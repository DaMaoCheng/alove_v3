import { createPublicError } from "./public-error-utils.js";

export const CALL_CLIENT_MAX_PAYLOAD_BYTES = 64 * 1024;
export const CALL_PROVIDER_MAX_BUFFERED_BYTES = 256 * 1024;

const ALLOWED_TYPES = new Set(["start_call", "audio_chunk", "audio_probe", "resume_listening", "end_call"]);
const MAX_AUDIO_BASE64_LENGTH = 24 * 1024;
const MAX_AUDIO_CHUNK_BYTES = 16 * 1024;
const MAX_AUDIO_BYTES_PER_SECOND = 64 * 1024;
const MAX_AUDIO_FRAMES_PER_SECOND = 32;
const MAX_AUDIO_BYTES_PER_LISTENING_TURN = 4 * 1024 * 1024;
const MAX_LISTENING_IDLE_MILLISECONDS = 90 * 1000;
const MAX_LISTENING_TURN_MILLISECONDS = 2 * 60 * 1000;
const MAX_AWAITING_RESUME_MILLISECONDS = 90 * 1000;
const MAX_AUDIO_PROBES = 8;
const AUDIO_PROBE_INTERVAL_MILLISECONDS = 750;

export function parseAndValidateCallClientMessage(data) {
  let payload = null;
  try {
    const text = Buffer.isBuffer(data) ? data.toString("utf8") : String(data || "");
    payload = JSON.parse(text);
  } catch {
    throw callInputError("Invalid call event.");
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || !ALLOWED_TYPES.has(payload.type)) {
    throw callInputError("Invalid call event.");
  }
  return payload;
}

export function consumeCallAudioInput(session, audio, now = Date.now()) {
  const value = typeof audio === "string" ? audio : "";
  if (!value || value.length > MAX_AUDIO_BASE64_LENGTH || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw callInputError("Invalid call audio.");
  }
  const byteLength = Buffer.byteLength(value, "base64");
  if (!byteLength || byteLength > MAX_AUDIO_CHUNK_BYTES || byteLength % 2 !== 0) {
    throw callInputError("Invalid call audio.");
  }
  if (!session.audioRateWindowStartedAt || now - session.audioRateWindowStartedAt >= 1000) {
    session.audioRateWindowStartedAt = now;
    session.audioRateWindowBytes = 0;
    session.audioRateWindowFrames = 0;
  }
  session.audioRateWindowBytes += byteLength;
  session.audioRateWindowFrames += 1;
  if (session.audioRateWindowBytes > MAX_AUDIO_BYTES_PER_SECOND || session.audioRateWindowFrames > MAX_AUDIO_FRAMES_PER_SECOND) {
    throw callInputError("Call audio rate limit exceeded.");
  }
  session.listeningTurnAudioBytes = Number(session.listeningTurnAudioBytes || 0) + byteLength;
  session.unfinalizedAudioBytes = Number(session.unfinalizedAudioBytes || 0) + byteLength;
  session.lastAudioInputAt = now;
  if (session.listeningTurnAudioBytes > MAX_AUDIO_BYTES_PER_LISTENING_TURN) {
    throw providerGuardError("Please pause briefly before continuing the call.");
  }
  return value;
}

export function assertGuestCallProviderGuard(session, now = Date.now()) {
  if (session?.turnPhase === "awaiting_resume" && session.awaitingResumeStartedAt
    && now - Number(session.awaitingResumeStartedAt) > MAX_AWAITING_RESUME_MILLISECONDS) {
    const error = callInputError("The call ended after waiting too long to resume.");
    error.code = "GUEST_CALL_RESUME_TIMEOUT";
    throw error;
  }
  if (!session?.listening || session.processing) return;
  const listeningStartedAt = Number(session.listeningStartedAt || now);
  const lastActivityAt = Number(session.lastAudioInputAt || listeningStartedAt);
  if (now - listeningStartedAt > MAX_LISTENING_TURN_MILLISECONDS) {
    throw providerGuardError("Please pause briefly before continuing the call.");
  }
  if (now - lastActivityAt > MAX_LISTENING_IDLE_MILLISECONDS) {
    throw providerGuardError("The call ended after a long period without speech.");
  }
}

export function consumeCallAudioProbe(session, now = Date.now()) {
  if (session.audioProbeCount >= MAX_AUDIO_PROBES) return false;
  if (session.lastAudioProbeAt && now - session.lastAudioProbeAt < AUDIO_PROBE_INTERVAL_MILLISECONDS) return false;
  session.audioProbeCount += 1;
  session.lastAudioProbeAt = now;
  return true;
}

export function callInputError(message) {
  const error = createPublicError(message, 400);
  error.closeCallSocket = true;
  return error;
}

function providerGuardError(message) {
  const error = callInputError(message);
  error.code = "GUEST_PROVIDER_INPUT_GUARD";
  return error;
}
