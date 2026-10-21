import { stripTtsControlTags } from "./tts-emotion-tag-service.js";
import { applyContextualEmotionTags } from "./tts-emotion-routing-service.js";

export function resolveReplySpeechText(replyResult = {}, replyText = "", userText = "", sourceType = "") {
  const candidate = String(replyResult.speechText || replyText || "").trim();
  const aligned = applyContextualEmotionTags({
    speechText: candidate,
    displayText: replyText,
    userText,
    sourceType: sourceType || replyResult.sourceType || "ai",
  }).speechText;
  if (stripTtsControlTags(aligned) === String(replyText || "").trim()) return aligned;
  return applyContextualEmotionTags({
    speechText: replyText,
    displayText: replyText,
    userText,
    sourceType: sourceType || replyResult.sourceType || "ai",
  }).speechText;
}
