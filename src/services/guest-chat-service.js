import { ApiError, requestJson } from "./http-client.js";
import { buildApiUrl } from "../config/api-config.js";

export function getGuestChatCapability(siteSlug = "") {
  const query = new URLSearchParams({ siteSlug });
  return requestJson(`/api/guest/capability?${query.toString()}`, { notifyUnauthorized: false });
}

export async function getGuestChatSession(siteSlug = "", characterId = "", handoff = "") {
  const query = new URLSearchParams();
  if (siteSlug) query.set("siteSlug", siteSlug);
  if (characterId) query.set("characterId", characterId);
  if (handoff) query.set("handoff", String(handoff).slice(0, 4096));
  const path = `/api/guest/session?${query.toString()}`;
  try {
    return normalizeGuestResult(await requestJson(path, { notifyUnauthorized: false }));
  } catch (error) {
    if (Number(error?.status || 0) !== 401) throw error;
    return normalizeGuestResult(await requestJson(path, { notifyUnauthorized: false }));
  }
}

export function sendGuestChatMessage({ text, attachments = [], clientMessageId, characterId = "" }) {
  return requestJson("/api/guest/messages", {
    method: "POST",
    body: { text, attachments, clientMessageId, characterId },
    notifyUnauthorized: false,
  }).then(normalizeGuestResult);
}

export async function uploadGuestPendingChatAttachment(processedAttachment, characterId = "") {
  const file = processedAttachment?.file;
  if (!(file instanceof File)) throw new ApiError("Attachment file is invalid.");
  const clientUploadId = processedAttachment.clientUploadId || crypto.randomUUID();
  processedAttachment.clientUploadId = clientUploadId;
  const response = await fetch(buildApiUrl("/api/guest/uploads/chat"), {
    method: "POST",
    credentials: "include",
    headers: {
      Accept: "application/json",
      "Content-Type": file.type || "application/octet-stream",
      "X-Upload-Filename": encodeURIComponent(file.name || "attachment"),
      "X-Original-Filename": encodeURIComponent(processedAttachment.originalName || file.name || "attachment"),
      "X-Original-File-Sha256": processedAttachment.sha256 || "",
      "X-Client-Upload-Id": clientUploadId,
      "X-Guest-Character-Id": characterId,
    },
    body: file,
  });
  const payload = await readGuestJson(response);
  if (!response.ok || payload?.ok === false) throwGuestApiError(response, payload, "Attachment upload failed.");
  return payload?.attachment || null;
}

export function deleteGuestPendingChatAttachment(attachmentId, characterId = "") {
  const query = characterId ? `?characterId=${encodeURIComponent(characterId)}` : "";
  return requestJson(`/api/guest/uploads/chat/${encodeURIComponent(String(attachmentId || "").trim())}${query}`, {
    method: "DELETE",
    notifyUnauthorized: false,
  });
}

export async function uploadGuestChatVoice(voiceClip, clientMessageId, characterId = "") {
  const file = voiceClip?.file;
  if (!(file instanceof File)) throw new ApiError("Voice file is invalid.");
  const response = await fetch(buildApiUrl("/api/guest/voices"), {
    method: "POST",
    credentials: "include",
    headers: {
      Accept: "application/json",
      "Content-Type": file.type || "application/octet-stream",
      "X-Upload-Filename": encodeURIComponent(file.name || "voice.webm"),
      "X-Client-Message-Id": clientMessageId,
      "X-Guest-Character-Id": characterId,
    },
    body: file,
  });
  const payload = await readGuestJson(response);
  if (!response.ok || payload?.ok === false) throwGuestApiError(response, payload, "Voice message failed.");
  return normalizeGuestResult(payload);
}

export function sendGuestVoiceReply(messageId, characterId = "") {
  const query = characterId ? `?characterId=${encodeURIComponent(characterId)}` : "";
  return requestJson(`/api/guest/voices/${encodeURIComponent(String(messageId || "").trim())}/reply${query}`, {
    method: "POST",
    notifyUnauthorized: false,
  }).then(normalizeGuestResult);
}

function normalizeGuestResult(result = {}) {
  return {
    ...result,
    messages: Array.isArray(result.messages) ? result.messages : (Array.isArray(result.items) ? result.items : []),
  };
}

async function readGuestJson(response) {
  const text = await response.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { throw new ApiError("The service returned an invalid response.", { status: response.status }); }
}

function throwGuestApiError(response, payload, fallback) {
  throw new ApiError(String(payload?.error || payload?.message || fallback).trim(), { status: response.status, payload });
}
