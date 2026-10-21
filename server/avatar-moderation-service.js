import { SERVER_CONFIG } from "./config.js";
import { recordProviderCallLog } from "./ai-reply-log-service.js";

const OPENAI_CHAT_COMPLETIONS_PATH = "/chat/completions";
const BLOCKED_CATEGORIES = new Set(["sexual", "nudity", "political"]);

export async function moderateAvatarImage({ buffer, contentType = "" } = {}) {
  if (!SERVER_CONFIG.aiReply.openai.apiKey) {
    throwServiceError("Avatar safety check is not configured.", 500);
  }
  if (!buffer?.length) {
    throwServiceError("Avatar file is empty.", 400);
  }

  const result = await requestImageModeration({ buffer, contentType });
  const blockedCategories = Array.isArray(result.blockedCategories) ? result.blockedCategories : [];
  if (result.allowed !== true || blockedCategories.some((item) => BLOCKED_CATEGORIES.has(item))) {
    return {
      ok: false,
      allowed: false,
      error: "This avatar is not allowed. Please choose another image.",
      categories: blockedCategories,
    };
  }

  return { ok: true, allowed: true, categories: [] };
}

async function requestImageModeration({ buffer, contentType }) {
  const startedAt = Date.now();
  let providerCallLogged = false;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SERVER_CONFIG.avatarModeration.timeoutMs);

  try {
    const response = await fetch(`${SERVER_CONFIG.aiReply.openai.baseUrl}${OPENAI_CHAT_COMPLETIONS_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SERVER_CONFIG.aiReply.openai.apiKey}`,
      },
      body: JSON.stringify({
        model: SERVER_CONFIG.aiReply.openai.model,
        messages: [
          {
            role: "system",
            content: [
              "You are an image safety classifier for user profile avatars.",
              "Return strict JSON only: {\"allowed\": boolean, \"blockedCategories\": string[]}.",
              "Block if the image contains sexual content, nudity, pornographic framing, explicit body exposure, political figures, political campaign material, political symbols, political propaganda, or political event imagery.",
              "Use category names only from: sexual, nudity, political.",
            ].join(" "),
          },
          {
            role: "user",
            content: [
              { type: "text", text: "Classify this avatar image. Return JSON only." },
              { type: "image_url", image_url: { url: `data:${normalizeContentType(contentType)};base64,${buffer.toString("base64")}` } },
            ],
          },
        ],
        response_format: { type: "json_object" },
      }),
      signal: controller.signal,
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(readModerationError(payload, response.status));
      error.statusCode = response.status >= 400 && response.status < 600 ? response.status : 502;
      throw error;
    }
    const result = normalizeModerationResult(payload?.choices?.[0]?.message?.content);
    await recordProviderCallLog({
      provider: "openai", model: SERVER_CONFIG.aiReply.openai.model, baseUrl: SERVER_CONFIG.aiReply.openai.baseUrl,
      sourceRef: "avatar-moderation", status: "success", startedAt,
    });
    providerCallLogged = true;
    return result;
  } catch (error) {
    if (!providerCallLogged) {
      await recordProviderCallLog({
        provider: "openai", model: SERVER_CONFIG.aiReply.openai.model, baseUrl: SERVER_CONFIG.aiReply.openai.baseUrl,
        sourceRef: "avatar-moderation", status: "error", startedAt, error,
      });
    }
    if (error?.name === "AbortError") throwServiceError("Avatar safety check timed out. Please try again.", 504);
    if (error?.statusCode) throw error;
    throwServiceError(error.message || "Avatar safety check failed. Please try again.", 502);
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeModerationResult(rawText) {
  try {
    const parsed = JSON.parse(String(rawText || "").trim());
    const categories = Array.isArray(parsed.blockedCategories)
      ? parsed.blockedCategories.map((item) => String(item || "").trim().toLowerCase()).filter(Boolean)
      : [];
    return {
      allowed: parsed.allowed === true,
      blockedCategories: categories,
    };
  } catch {
    throwServiceError("Avatar safety check returned an invalid response. Please try again.", 502);
  }
}

function normalizeContentType(value) {
  const normalized = String(value || "").split(";")[0].trim().toLowerCase();
  return normalized || "image/jpeg";
}

function readModerationError(payload, statusCode) {
  const apiMessage = String(payload?.error?.message || payload?.error || payload?.message || "").trim();
  if (apiMessage) return apiMessage;
  if (statusCode === 401) return "Avatar safety check authentication failed.";
  return "Avatar safety check failed. Please try again.";
}

function throwServiceError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  throw error;
}
