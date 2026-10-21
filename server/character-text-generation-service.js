import { requestReplyWithProviderFallback } from "./ai-reply-service.js";
import { isOpenAiReplyConfigured, requestOpenAiText } from "./ai-reply-provider-service.js";

export function isCharacterTextGenerationConfigured() {
  return isOpenAiReplyConfigured();
}

export async function generateCharacterText({ systemPrompt = "", userContent = "" } = {}) {
  return generateCharacterTextWithRequest({ systemPrompt, userContent });
}

export async function generateCharacterTextWithRequest({
  systemPrompt = "",
  userContent = "",
  requestText = requestOpenAiText,
  requestWithFallback = requestReplyWithProviderFallback,
} = {}) {
  return requestWithFallback(requestText, {
    systemPrompt: String(systemPrompt || "").trim(),
    messages: [{ role: "user", content: String(userContent || "").trim() }],
  }, {
    validateReply: (text) => ({
      valid: Boolean(String(text || "").trim()),
      reason: "empty_character_text",
    }),
  });
}
