const PUBLIC_CHAT_ATTACHMENT_PREFIX = "/uploads/chat";
const PROTECTED_CHAT_ATTACHMENT_PREFIX = "/api/uploads/chat";
const PUBLIC_CHAT_IMAGE_PREFIX = "/uploads/chat-images";
const PROTECTED_CHAT_IMAGE_PREFIX = "/api/uploads/chat-images";
const PUBLIC_VOICE_PREFIX = "/uploads/voice";
const PUBLIC_AI_VOICE_PREFIX = "/uploads/voice/ai";
const PUBLIC_VOICE_PRESET_PREFIX = "/uploads/voice/presets";
const PROTECTED_VOICE_PREFIX = "/api/uploads/voice";
const PROTECTED_AI_VOICE_PREFIX = "/api/uploads/voice/ai";

export function toProtectedChatAttachmentUrl(value = "") {
  const fileName = extractFileName(value);
  return fileName ? `${PROTECTED_CHAT_ATTACHMENT_PREFIX}/${encodeURIComponent(fileName)}` : "";
}

export function normalizeChatAttachmentForClient(attachment) {
  if (!attachment || typeof attachment !== "object") return attachment;
  const protectedUrl = toProtectedChatAttachmentUrl(attachment.storedName || attachment.url);
  return protectedUrl ? { ...attachment, url: protectedUrl } : attachment;
}

export function toProtectedChatImageUrl(value = "") {
  const fileName = extractFileName(value);
  return fileName ? `${PROTECTED_CHAT_IMAGE_PREFIX}/${encodeURIComponent(fileName)}` : "";
}

export function toProtectedVoiceUrl(value = "") {
  const url = String(value || "").trim();
  if (!url) return "";
  if (url.startsWith(PROTECTED_AI_VOICE_PREFIX) || url.startsWith(`${PROTECTED_VOICE_PREFIX}/`)) return url;
  if (url.startsWith(PUBLIC_VOICE_PRESET_PREFIX)) return url;
  if (url.startsWith(PUBLIC_AI_VOICE_PREFIX)) {
    const fileName = extractFileName(url);
    return fileName ? `${PROTECTED_AI_VOICE_PREFIX}/${encodeURIComponent(fileName)}` : "";
  }
  if (url.startsWith(`${PUBLIC_VOICE_PREFIX}/`)) {
    const fileName = extractFileName(url);
    return fileName ? `${PROTECTED_VOICE_PREFIX}/${encodeURIComponent(fileName)}` : "";
  }
  return url;
}

export function publicChatAttachmentUrl(fileName = "") {
  const safeName = extractFileName(fileName);
  return safeName ? `${PUBLIC_CHAT_ATTACHMENT_PREFIX}/${safeName}` : "";
}

export function publicChatImageUrl(fileName = "") {
  const safeName = extractFileName(fileName);
  return safeName ? `${PUBLIC_CHAT_IMAGE_PREFIX}/${safeName}` : "";
}

export function protectedChatImageUrl(fileName = "") {
  const safeName = extractFileName(fileName);
  return safeName ? `${PROTECTED_CHAT_IMAGE_PREFIX}/${encodeURIComponent(safeName)}` : "";
}

export function protectedChatAttachmentUrl(fileName = "") {
  const safeName = extractFileName(fileName);
  return safeName ? `${PROTECTED_CHAT_ATTACHMENT_PREFIX}/${encodeURIComponent(safeName)}` : "";
}

export function publicAiVoiceUrl(fileName = "") {
  const safeName = extractFileName(fileName);
  return safeName ? `${PUBLIC_AI_VOICE_PREFIX}/${safeName}` : "";
}

export function protectedAiVoiceUrl(fileName = "") {
  const safeName = extractFileName(fileName);
  return safeName ? `${PROTECTED_AI_VOICE_PREFIX}/${encodeURIComponent(safeName)}` : "";
}

export function publicUserVoiceUrl(fileName = "") {
  const safeName = extractFileName(fileName);
  return safeName ? `${PUBLIC_VOICE_PREFIX}/${safeName}` : "";
}

export function protectedUserVoiceUrl(fileName = "") {
  const safeName = extractFileName(fileName);
  return safeName ? `${PROTECTED_VOICE_PREFIX}/${encodeURIComponent(safeName)}` : "";
}

export function extractFileName(value = "") {
  const rawValue = String(value || "").trim();
  if (!rawValue) return "";
  const cleanValue = rawValue.split("?")[0].split("#")[0];
  const parts = cleanValue.split("/").filter(Boolean);
  const fileName = parts[parts.length - 1] || "";
  try {
    return decodeURIComponent(fileName).replace(/[/\\]/g, "").trim();
  } catch {
    return fileName.replace(/[/\\]/g, "").trim();
  }
}
