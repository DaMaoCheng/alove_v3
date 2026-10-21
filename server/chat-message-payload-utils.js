import { createPublicError } from "./public-error-utils.js";

export function normalizeMessageText(text) {
  const normalizedText = String(text || "").replace(/\s+/g, " ").trim();
  if (!normalizedText) {
    throw createPublicError("请输入消息内容", 400);
  }
  if (normalizedText.length > 2000) {
    throw createPublicError("消息内容不能超过 2000 个字符", 400);
  }
  return normalizedText;
}

export function normalizeAttachmentPayload(attachment) {
  const payload = attachment && typeof attachment === "object" ? attachment : {};
  const kind = String(payload.kind || "").trim();
  if (kind !== "image" && kind !== "document") {
    throw createPublicError("附件类型无效", 400);
  }

  const url = String(payload.url || "").trim();
  if (!url.startsWith("/uploads/chat/") && !url.startsWith("/api/uploads/chat/")) {
    throw createPublicError("附件地址无效", 400);
  }

  return {
    kind,
    name: String(payload.name || "Attachment").trim().slice(0, 160),
    storedName: String(payload.storedName || "").trim().slice(0, 180),
    url,
    size: Math.max(0, Number(payload.size || 0)),
    mimeType: String(payload.mimeType || "").trim().slice(0, 120),
    sha256: String(payload.sha256 || "").trim().slice(0, 64),
    originalSha256: String(payload.originalSha256 || "").trim().slice(0, 64),
    processed: payload.processed && typeof payload.processed === "object" ? payload.processed : {},
  };
}

export function normalizeVoicePayload(voice) {
  const payload = voice && typeof voice === "object" ? voice : {};
  if (String(payload.kind || "").trim() !== "voice") {
    throw createPublicError("语音类型无效", 400);
  }

  const url = String(payload.url || "").trim();
  if (!url.startsWith("/uploads/voice/") && !url.startsWith("/api/uploads/voice/")) {
    throw createPublicError("语音地址无效", 400);
  }

  return {
    kind: "voice",
    name: String(payload.name || "Voice message").trim().slice(0, 160),
    storedName: String(payload.storedName || "").trim().slice(0, 180),
    url,
    size: Math.max(0, Number(payload.size || 0)),
    mimeType: String(payload.mimeType || "").trim().slice(0, 120),
    sha256: String(payload.sha256 || "").trim().slice(0, 64),
    durationSeconds: Math.max(1, Math.min(120, Math.round(Number(payload.durationSeconds || 1)))),
    waveform: Array.isArray(payload.waveform) ? payload.waveform.slice(0, 32).map((item) => Math.max(0, Math.min(1, Number(item) || 0))) : [],
  };
}

export function normalizeVoiceTranscriptText(transcriptText) {
  const transcript = String(transcriptText || "").replace(/\s+/g, " ").trim().slice(0, 2000);
  if (transcript) return transcript;
  throw createPublicError("语音识别未返回文本", 422);
}

export function buildAttachmentSummary(attachment) {
  return attachment.kind === "image"
    ? `[Image] ${attachment.name || ""}`.trim()
    : `[Document] ${attachment.name || ""}`.trim();
}

export function throwNotFound() {
  throw createPublicError("角色不存在", 404);
}

export function parseJsonValue(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}
