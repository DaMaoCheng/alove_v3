const DEFAULT_RECORDING_MIME = "audio/webm";
const MAX_RECORD_SECONDS = 120;

export async function createVoiceRecorderSession({ onTick } = {}) {
  ensureVoiceRecordingSupported();

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mimeType = resolveRecorderMimeType();
  const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
  const chunks = [];
  let tickTimer = null;
  const startedAt = Date.now();

  recorder.addEventListener("dataavailable", (event) => {
    if (event.data && event.data.size > 0) {
      chunks.push(event.data);
    }
  });

  recorder.start(120);
  onTick?.(0);
  tickTimer = window.setInterval(() => {
    const seconds = resolveElapsedSeconds(startedAt);
    onTick?.(seconds);
    if (seconds >= MAX_RECORD_SECONDS) {
      void session.stop();
    }
  }, 1000);

  const session = {
    mimeType: recorder.mimeType || mimeType || DEFAULT_RECORDING_MIME,
    stop: () => finalizeRecording("stop"),
    cancel: async () => {
      await finalizeRecording("cancel");
      return null;
    },
  };

  return session;

  function finalizeRecording(mode) {
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        window.clearInterval(tickTimer);
        stopTracks(stream);
      };

      recorder.addEventListener("stop", () => {
        cleanup();
        if (mode === "cancel") {
          resolve(null);
          return;
        }
        const blob = new Blob(chunks, { type: recorder.mimeType || mimeType || DEFAULT_RECORDING_MIME });
        if (!blob.size) {
          reject(new Error("录音内容为空，请重试"));
          return;
        }
        const durationSeconds = Math.max(1, Math.min(MAX_RECORD_SECONDS, resolveElapsedSeconds(startedAt)));
        resolve(buildVoiceClip(blob, durationSeconds));
      }, { once: true });

      if (recorder.state === "inactive") {
        cleanup();
        resolve(mode === "cancel" ? null : buildVoiceClip(new Blob(chunks, { type: recorder.mimeType || mimeType || DEFAULT_RECORDING_MIME }), resolveElapsedSeconds(startedAt)));
        return;
      }

      try {
        recorder.stop();
      } catch (error) {
        cleanup();
        reject(error);
      }
    });
  }
}

export function ensureVoiceRecordingSupported() {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
    throw new Error("当前浏览器暂不支持语音录制");
  }
}

function resolveRecorderMimeType() {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") {
    return DEFAULT_RECORDING_MIME;
  }
  if (MediaRecorder.isTypeSupported("audio/mp4")) return "audio/mp4";
  if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) return "audio/webm;codecs=opus";
  if (MediaRecorder.isTypeSupported("audio/webm")) return "audio/webm";
  if (MediaRecorder.isTypeSupported("audio/ogg;codecs=opus")) return "audio/ogg;codecs=opus";
  if (MediaRecorder.isTypeSupported("audio/ogg")) return "audio/ogg";
  return DEFAULT_RECORDING_MIME;
}

function buildVoiceClip(blob, durationSeconds) {
  const extension = inferExtension(blob.type || DEFAULT_RECORDING_MIME);
  const file = new File([blob], `voice-${Date.now()}${extension}`, {
    type: blob.type || DEFAULT_RECORDING_MIME,
    lastModified: Date.now(),
  });
  return {
    kind: "voice",
    file,
    durationSeconds: Math.max(1, Math.min(MAX_RECORD_SECONDS, Math.round(Number(durationSeconds || 1)))),
  };
}

function inferExtension(mimeType) {
  const normalized = String(mimeType || "").toLowerCase();
  if (normalized.includes("mp4")) return ".m4a";
  if (normalized.includes("mpeg")) return ".mp3";
  if (normalized.includes("ogg")) return ".ogg";
  if (normalized.includes("wav")) return ".wav";
  return ".webm";
}

function resolveElapsedSeconds(startedAt) {
  return Math.max(1, Math.round((Date.now() - startedAt) / 1000));
}

function stopTracks(stream) {
  try {
    stream.getTracks().forEach((track) => track.stop());
  } catch {}
}
