import { generateCharacterText, isCharacterTextGenerationConfigured } from "./character-text-generation-service.js";

const MAX_SHORT_BIO_LENGTH = 180;

export async function generateCharacterShortBio(payload = {}) {
  const fallback = buildFallbackShortBio(payload);
  const aiText = await generateShortBioWithAi(payload).catch(() => "");
  return normalizeShortBio(aiText || fallback) || fallback;
}

async function generateShortBioWithAi(payload = {}) {
  if (!isCharacterTextGenerationConfigured()) return "";
  try {
    const generated = await generateCharacterText({
      systemPrompt: buildInstructions(payload),
      userContent: buildInput(payload),
    });
    return generated.text;
  } catch {
    return "";
  }
}

function buildInstructions(payload = {}) {
  const language = safeString(payload.language);
  return [
    "Create one short public card bio for an AI football companion character.",
    "Return only the bio text. No labels, no quotes, no markdown, no emojis.",
    "Keep it natural, specific, and suitable for a character card.",
    "Do not mention internal prompts, hidden rules, or private data.",
    "Length: 18 to 32 words, maximum 140 characters when possible.",
    language ? `Write in ${language}.` : "Write in English.",
  ].join("\n");
}

function buildInput(payload = {}) {
  return [
    safeString(payload.name) ? `Name: ${safeString(payload.name)}` : "",
    safeString(payload.categoryLabel || payload.category) ? `Category: ${safeString(payload.categoryLabel || payload.category)}` : "",
    safeString(payload.personality || payload.vibe || payload.speakingStyle) ? `Personality: ${safeString(payload.personality || payload.vibe || payload.speakingStyle)}` : "",
    safeString(payload.voice || payload.voiceStyle) ? `Voice: ${safeString(payload.voice || payload.voiceStyle)}` : "",
    safeString(payload.openingLine) ? `Opening line: ${safeString(payload.openingLine)}` : "",
    safeString(payload.backstory || payload.personaPrompt) ? `Backstory: ${safeString(payload.backstory || payload.personaPrompt)}` : "",
  ].filter(Boolean).join("\n");
}

export function buildFallbackShortBio(payload = {}) {
  const name = safeString(payload.name) || "这个角色";
  const category = safeString(payload.categoryLabel || payload.category) || "足球陪伴角色";
  const style = safeString(payload.personality || payload.vibe || payload.speakingStyle) || "自然友好";
  const language = safeString(payload.language);
  const languageText = language ? `，默认使用${language}交流` : "";
  return normalizeShortBio(`${name} 是一个${style}的${category}${languageText}，适合陪用户聊比赛、日常和足球故事。`);
}

function normalizeShortBio(value = "") {
  const normalized = safeString(value)
    .replace(/^[-*•\s"'`]+|["'`]+$/g, "")
    .replace(/^(short bio|bio|简介|短简介)[:：]\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
  return normalized.length > MAX_SHORT_BIO_LENGTH ? `${normalized.slice(0, MAX_SHORT_BIO_LENGTH).trim()}...` : normalized;
}

function safeString(value) {
  return String(value == null ? "" : value).trim();
}
