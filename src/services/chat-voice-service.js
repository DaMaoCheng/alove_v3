import { ApiError } from "./http-client.js";
import { API_ENDPOINTS, buildApiUrl } from "../config/api-config.js";

export async function uploadChatVoice(characterId, voiceClip) {
  const normalizedCharacterId = String(characterId || "").trim();
  if (!normalizedCharacterId) {
    throw new ApiError("角色不存在");
  }
  const file = voiceClip?.file;
  if (!(file instanceof File)) {
    throw new ApiError("语音文件无效");
  }

  const response = await fetch(buildApiUrl(buildVoicePath(normalizedCharacterId)), {
    method: "POST",
    credentials: "include",
    headers: {
      Accept: "application/json",
      "Content-Type": file.type || "application/octet-stream",
      "X-Upload-Filename": encodeURIComponent(file.name || "voice.webm"),
      "X-Voice-Duration-Seconds": String(Math.max(1, Math.round(Number(voiceClip.durationSeconds || 1)))),
    },
    body: file,
  });

  return normalizeVoiceResponse(response, await readJsonPayload(response));
}

export async function sendChatVoiceReply(characterId, messageId) {
  const normalizedCharacterId = String(characterId || "").trim();
  const normalizedMessageId = String(messageId || "").trim();
  if (!normalizedCharacterId || !normalizedMessageId) {
    throw new ApiError("语音消息不存在");
  }

  const response = await fetch(buildApiUrl(`${buildVoicePath(normalizedCharacterId)}/${encodeURIComponent(normalizedMessageId)}/reply`), {
    method: "POST",
    credentials: "include",
    headers: {
      Accept: "application/json",
    },
  });

  return normalizeVoiceResponse(response, await readJsonPayload(response));
}

function buildVoicePath(characterId) {
  return `${API_ENDPOINTS.characters.messages}/${encodeURIComponent(characterId)}/voices`;
}

function normalizeVoiceResponse(response, payload) {
  if (!response.ok || payload?.ok === false) {
    throw new ApiError(resolveErrorMessage(payload, response), {
      status: response.status,
      payload,
    });
  }

  return {
    ...payload,
    messages: Array.isArray(payload?.items) ? payload.items : payload?.messages || [],
  };
}

async function readJsonPayload(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError("服务返回异常，请稍后再试", { status: response.status });
  }
}

function resolveErrorMessage(payload, response) {
  const message = String(payload?.error || payload?.message || "").trim();
  if (message) return message;
  if (response.status === 401) return "登录状态异常，请重新登录";
  return "语音发送失败，请稍后再试";
}
