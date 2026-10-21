import { API_ENDPOINTS, buildApiUrl } from "../config/api-config.js";
import { ApiError, requestJson } from "./http-client.js";
import { compressImageFile } from "../utils/image-processing.js";

export async function uploadAvatar({ blob, filename = "avatar.webp" } = {}) {
  if (!(blob instanceof Blob)) {
    throw new ApiError("Invalid avatar file.");
  }

  const response = await fetch(buildApiUrl(API_ENDPOINTS.upload.avatar), {
    method: "POST",
    credentials: "include",
    headers: {
      Accept: "application/json",
      "Content-Type": blob.type || "application/octet-stream",
      "X-Upload-Filename": encodeURIComponent(String(filename || "avatar.webp")),
    },
    body: blob,
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
    avatarUrl: String(payload.avatarUrl || "").trim(),
  };
}

export async function moderateAvatarFile(file) {
  if (!(file instanceof Blob)) {
    throw new ApiError("Invalid avatar file.");
  }

  const moderationFile = await compressImageFile(file, {
    maxSide: 512,
    outputType: "image/webp",
    outputExtension: ".webp",
    outputQuality: 0.72,
  });

  const response = await fetch(buildApiUrl(API_ENDPOINTS.upload.avatarModerate), {
    method: "POST",
    credentials: "include",
    headers: {
      Accept: "application/json",
      "Content-Type": moderationFile.type || "image/webp",
    },
    body: moderationFile,
  });

  const payload = await readJsonPayload(response);
  if (!response.ok || payload?.ok === false || payload?.allowed === false) {
    throw new ApiError(resolveErrorMessage(payload, response), {
      status: response.status,
      payload,
    });
  }

  return payload;
}

export function deleteTemporaryAvatar(avatarUrl) {
  const normalizedUrl = String(avatarUrl || "").trim();
  if (!normalizedUrl) return Promise.resolve({ ok: true, skipped: true });
  return requestJson(API_ENDPOINTS.upload.avatar, {
    method: "DELETE",
    body: { avatarUrl: normalizedUrl },
  });
}

async function readJsonPayload(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError("Service returned an invalid response. Please try again.", { status: response.status });
  }
}

function resolveErrorMessage(payload, response) {
  const message = String(payload?.error || payload?.message || "").trim();
  if (message) return message;
  if (response.status === 401) return "Your session expired. Please sign in again.";
  return "Avatar upload failed. Please try again.";
}
