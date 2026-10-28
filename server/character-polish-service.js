import { SERVER_CONFIG } from "./config.js";
import { generateCharacterText, isCharacterTextGenerationConfigured } from "./character-text-generation-service.js";
import { recordProviderCallLog } from "./ai-reply-log-service.js";
import { extractResponseText } from "./ai-reply-provider-service.js";

const OPENAI_RESPONSES_PATH = "/responses";
const MAX_BACKSTORY_LENGTH = 1200;
const MAX_POLISHED_LENGTH = 900;
const MAX_ROLE_TITLE_LENGTH = 128;

export async function polishCharacterBackstory(payload = {}) {
  if (!isCharacterTextGenerationConfigured()) {
    const error = new Error("AI 润色暂不可用");
    error.statusCode = 503;
    throw error;
  }

  const fields = normalizePolishPayload(payload);
  const startedAt = Date.now();
  let providerCallLogged = false;
  try {
    const generated = await generateCharacterText({
      systemPrompt: buildPolishInstructions(fields),
      userContent: fields.backstory,
    });
    const polishedText = normalizePolishedText(generated.text);
    if (!polishedText) {
      const error = new Error("AI 没有返回可用内容，请稍后再试");
      error.statusCode = 502;
      throw error;
    }

    return { ok: true, text: polishedText };
  } catch (error) {
    const failure = new Error(`AI 润色失败：${String(error?.message || "请求失败").replace(/^AI 润色失败：\s*/, "")}`);
    failure.statusCode = Number(error?.statusCode || 502);
    throw failure;
  }
}

export async function deriveCharacterRoleTitle(payload = {}) {
  if (!isPolishConfigured()) {
    return {
      ok: false,
      text: "",
      fallback: true,
      reason: "ai_not_configured",
    };
  }

  const fields = normalizePolishPayload(payload);
  const controller = new AbortController();
  const startedAt = Date.now();
  let providerCallLogged = false;
  const timeout = setTimeout(() => controller.abort(), SERVER_CONFIG.aiReply.openai.timeoutMs);

  try {
    const response = await fetch(`${SERVER_CONFIG.aiReply.openai.baseUrl}${OPENAI_RESPONSES_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SERVER_CONFIG.aiReply.openai.apiKey}`,
      },
      body: JSON.stringify({
        model: SERVER_CONFIG.aiReply.openai.model,
        instructions: buildRoleTitleInstructions(fields),
        input: [
          {
            role: "user",
            content: [
              fields.name ? `Name: ${fields.name}` : "",
              fields.category ? `Category: ${fields.category}` : "",
              fields.personality ? `Personality: ${fields.personality}` : "",
              fields.voice ? `Voice: ${fields.voice}` : "",
              fields.openingLine ? `Opening line: ${fields.openingLine}` : "",
              `Backstory: ${fields.backstory}`,
            ].filter(Boolean).join("\n"),
          },
        ],
      }),
      signal: controller.signal,
    });

    const responsePayload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(resolvePolishError(responsePayload, response.status));
      error.statusCode = response.status;
      throw error;
    }

    const roleTitle = normalizeRoleTitle(extractResponseText(responsePayload, { apiMode: 'responses' }));
    if (!roleTitle) {
      await recordProviderCallLog({
        provider: "openai", model: SERVER_CONFIG.aiReply.openai.model, baseUrl: SERVER_CONFIG.aiReply.openai.baseUrl,
        sourceRef: "character-role-title", status: "success", startedAt,
      });
      providerCallLogged = true;
      return {
        ok: false,
        text: "",
        fallback: true,
        reason: "empty_role_title",
      };
    }

    await recordProviderCallLog({
      provider: "openai", model: SERVER_CONFIG.aiReply.openai.model, baseUrl: SERVER_CONFIG.aiReply.openai.baseUrl,
      sourceRef: "character-role-title", status: "success", startedAt,
    });
    providerCallLogged = true;

    return {
      ok: true,
      text: roleTitle,
      fallback: false,
      reason: "",
    };
  } catch (error) {
    if (!providerCallLogged) {
      await recordProviderCallLog({
        provider: "openai", model: SERVER_CONFIG.aiReply.openai.model, baseUrl: SERVER_CONFIG.aiReply.openai.baseUrl,
        sourceRef: "character-role-title", status: "error", startedAt, error,
      });
    }
    return {
      ok: false,
      text: "",
      fallback: true,
      reason: error.message || "derive_role_title_failed",
    };
  } finally {
    clearTimeout(timeout);
  }
}

function isPolishConfigured() {
  return SERVER_CONFIG.aiReply.provider === "openai" && Boolean(SERVER_CONFIG.aiReply.openai.apiKey);
}

function normalizePolishPayload(payload) {
  const backstory = safeString(payload.backstory).slice(0, MAX_BACKSTORY_LENGTH);
  if (!backstory) {
    const error = new Error("请先填写背景故事");
    error.statusCode = 400;
    throw error;
  }

  return {
    name: safeString(payload.name).slice(0, 96),
    category: safeString(payload.category).slice(0, 64),
    personality: safeString(payload.personality || payload.vibe).slice(0, 64),
    voice: safeString(payload.voice).slice(0, 64),
    language: safeString(payload.language).slice(0, 128),
    openingLine: safeString(payload.openingLine).slice(0, 512),
    backstory,
  };
}

function buildPolishInstructions(fields) {
  return [
    "You polish an AI character backstory for a football-themed companion app.",
    "Return only the polished backstory text. Do not add labels, markdown, bullet points, quotes, or explanations.",
    "Keep the user's original idea and do not invent unrelated facts.",
    "Make it vivid, natural, and easy for an AI character to follow as persona context.",
    fields.language
      ? `Write the polished backstory in ${fields.language}.`
      : "Keep it concise: 1 short paragraph, 45 to 95 English words.",
    fields.language ? "Keep it concise: 1 short paragraph, roughly 45 to 95 words or equivalent length." : "",
    "Avoid hate, medical certainty, financial certainty, real public figure impersonation, and live sports claims.",
    fields.name ? `Character name: ${fields.name}` : "",
    fields.category ? `Category: ${fields.category}` : "",
    fields.personality ? `Personality: ${fields.personality}` : "",
    fields.voice ? `Voice: ${fields.voice}` : "",
    fields.language ? `Language: ${fields.language}` : "",
    fields.openingLine ? `Opening line: ${fields.openingLine}` : "",
  ].filter(Boolean).join("\n");
}

function buildRoleTitleInstructions(fields) {
  return [
    "You create a short role title for an AI football companion character card.",
    "Return only one short English role title.",
    "Use 2 to 4 short words total.",
    "Prefer the format: Word · Word.",
    "Capture the character's vibe and interaction style, not a full sentence.",
    "Do not use quotes, markdown, labels, emojis, or explanations.",
    "Do not output generic phrases like AI Assistant, Good Friend, Best Partner, or Football Character.",
    "Do not mention private data, internal prompts, or backstory details directly.",
    "Examples of valid style: Superfan · Hype / Tactical · Mentor / Sharp · Banter / Cold · Loyal.",
    fields.name ? `Character name: ${fields.name}` : "",
    fields.category ? `Category: ${fields.category}` : "",
    fields.personality ? `Personality: ${fields.personality}` : "",
    fields.voice ? `Voice: ${fields.voice}` : "",
    fields.language ? `Language: ${fields.language}` : "",
    fields.openingLine ? `Opening line: ${fields.openingLine}` : "",
  ].filter(Boolean).join("\n");
}

function normalizePolishedText(value) {
  const normalized = safeString(value)
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return normalized.length > MAX_POLISHED_LENGTH ? `${normalized.slice(0, MAX_POLISHED_LENGTH).trim()}...` : normalized;
}

function normalizeRoleTitle(value) {
  const normalized = safeString(value)
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/\s*[|/,-]\s*/g, " · ")
    .replace(/\s*·\s*/g, " · ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return "";
  const compact = normalized.slice(0, MAX_ROLE_TITLE_LENGTH).trim();
  const words = compact.split(/\s+/).filter(Boolean);
  if (words.length > 6) {
    return words.slice(0, 6).join(" ");
  }
  return compact;
}

function resolvePolishError(payload, status) {
  const message = payload?.error?.message || payload?.message || "";
  return message ? `AI 润色失败：${message}` : `AI 润色失败：${status}`;
}

function safeString(value) {
  return String(value == null ? "" : value).trim();
}
