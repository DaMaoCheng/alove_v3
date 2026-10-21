import { API_ENDPOINTS, buildApiUrl } from "../config/api-config.js";
import { ApiError } from "./http-client.js";

export async function uploadChatAttachment(characterId, processedAttachment) {
  const normalizedCharacterId = String(characterId || "").trim();
  if (!normalizedCharacterId) {
    throw new ApiError("角色不存在");
  }
  const file = processedAttachment?.file;
  if (!(file instanceof File)) {
    throw new ApiError("附件文件无效");
  }

  const response = await fetch(buildApiUrl(`${API_ENDPOINTS.characters.messages}/${encodeURIComponent(normalizedCharacterId)}/attachments`), {
    method: "POST",
    credentials: "include",
    headers: {
      Accept: "application/json",
      "Content-Type": file.type || "application/octet-stream",
      "X-Upload-Filename": encodeURIComponent(file.name || "attachment"),
      "X-Original-Filename": encodeURIComponent(processedAttachment.originalName || file.name || "attachment"),
      "X-Original-File-Sha256": processedAttachment.sha256 || "",
    },
    body: file,
  });

  const payload = await readJsonPayload(response);
  if (!response.ok || payload?.ok === false) {
    throw new ApiError(resolveErrorMessage(payload, response), {
      status: response.status,
      payload,
    });
  }

  return {
    ...payload,
    messages: Array.isArray(payload.items) ? payload.items : payload.messages || [],
  };
}

export async function uploadPendingChatAttachment(processedAttachment) {
  const file = processedAttachment?.file;
  if (!(file instanceof File)) {
    throw new ApiError("附件文件无效");
  }

  const response = await fetch(buildApiUrl(API_ENDPOINTS.upload.chatAttachment), {
    method: "POST",
    credentials: "include",
    headers: {
      Accept: "application/json",
      "Content-Type": file.type || "application/octet-stream",
      "X-Upload-Filename": encodeURIComponent(file.name || "attachment"),
      "X-Original-Filename": encodeURIComponent(processedAttachment.originalName || file.name || "attachment"),
      "X-Original-File-Sha256": processedAttachment.sha256 || "",
    },
    body: file,
  });

  const payload = await readJsonPayload(response);
  if (!response.ok || payload?.ok === false) {
    throw new ApiError(resolveErrorMessage(payload, response), {
      status: response.status,
      payload,
    });
  }

  return payload?.attachment || null;
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
  return "附件上传失败，请稍后再试";
}
