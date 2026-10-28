import { createId } from "./security.js";
import { getKnowledgeAiConfig, isKnowledgeAiConfigured } from "./knowledge-ai-config.js";
import { recordProviderCallLog } from "./ai-reply-log-service.js";
import { extractResponseText } from "./ai-reply-provider-service.js";

const OPENAI_RESPONSES_PATH = "/responses";
const OPENAI_CHAT_COMPLETIONS_PATH = "/chat/completions";
const MAX_SOURCE_TEXT_CHARS = 60000;

const TASK_PROMPTS = Object.freeze({
  outline: "You organize raw knowledge-base text into a clear, useful outline for retrieval.",
  section_split: "You split raw knowledge-base text into retrieval-friendly knowledge sections.",
  section_summary: "You summarize knowledge sections for later retrieval and admin review.",
  keyword_extract: "You extract exact and fuzzy retrieval keywords from knowledge sections.",
});

export async function generateKnowledgeOutline({ title = "", sourceText = "", language = "简体中文" } = {}) {
  return requestKnowledgeAiJson({
    task: "outline",
    payload: {
      title,
      language,
      sourceText: limitSourceText(sourceText),
      outputSchema: {
        title: "string",
        summary: "string",
        outline: [{ title: "string", summary: "string", order: "number" }],
      },
    },
  });
}

export async function splitKnowledgeSections({ title = "", sourceText = "", outline = [], language = "简体中文" } = {}) {
  return requestKnowledgeAiJson({
    task: "section_split",
    payload: {
      title,
      language,
      outline,
      sourceText: limitSourceText(sourceText),
      outputSchema: {
        sections: [{
          title: "string",
          summary: "string",
          content: "string",
          exactKeywords: ["string"],
          fuzzyKeywords: ["string"],
          order: "number",
        }],
      },
    },
  });
}

export async function summarizeKnowledgeSections({ title = "", sections = [], language = "简体中文" } = {}) {
  return requestKnowledgeAiJson({
    task: "section_summary",
    payload: {
      title,
      language,
      sections,
      outputSchema: {
        sections: [{ title: "string", summary: "string", order: "number" }],
      },
    },
  });
}

export async function extractKnowledgeKeywords({ title = "", sections = [], language = "简体中文" } = {}) {
  return requestKnowledgeAiJson({
    task: "keyword_extract",
    payload: {
      title,
      language,
      sections,
      outputSchema: {
        sections: [{ title: "string", exactKeywords: ["string"], fuzzyKeywords: ["string"], order: "number" }],
      },
    },
  });
}

export async function requestKnowledgeAiJson({ task, payload, config = getKnowledgeAiConfig() } = {}) {
  const normalizedTask = normalizeTask(task);
  if (!isKnowledgeAiConfigured(config)) {
    throw createKnowledgeAiError("Knowledge AI service is not configured", "knowledge_ai_not_configured");
  }

  const startedAt = Date.now();
  const requestId = createId("kb_ai");
  const responseText = await requestOpenAiCompatibleJson({
    config,
    task: normalizedTask,
    requestId,
    payload: {
      requestId,
      task: normalizedTask,
      ...payload,
    },
  });

  try {
    return {
      ok: true,
      requestId,
      task: normalizedTask,
      durationMs: Date.now() - startedAt,
      data: JSON.parse(stripJsonFence(responseText)),
    };
  } catch (error) {
    throw createKnowledgeAiError(`Knowledge AI returned invalid JSON: ${error.message}`, "knowledge_ai_invalid_json");
  }
}

function normalizeTask(task) {
  const normalized = String(task || "").trim().toLowerCase();
  if (!Object.hasOwn(TASK_PROMPTS, normalized)) {
    throw createKnowledgeAiError(`Unsupported knowledge AI task: ${task || ""}`, "knowledge_ai_unsupported_task", 400);
  }
  return normalized;
}

async function requestOpenAiCompatibleJson({ config, task, requestId, payload }) {
  const startedAt = Date.now();
  let providerCallLogged = false;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.openai.timeoutMs);

  try {
    const response = await fetch(buildRequestUrl(config), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.openai.apiKey}`,
      },
      body: JSON.stringify(buildRequestBody({ config, task, payload })),
      signal: controller.signal,
    });

    const responsePayload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = createKnowledgeAiError(normalizeOpenAiError(responsePayload, response.status), "knowledge_ai_request_failed");
      error.statusCode = response.status;
      throw error;
    }

    const text = extractResponseText(responsePayload, { apiMode: config.openai.apiMode }).trim();
    if (!text) {
      throw createKnowledgeAiError("Knowledge AI returned an empty response", "knowledge_ai_empty_response");
    }
    await recordProviderCallLog({
      requestId, provider: config.provider, model: config.openai.model, baseUrl: config.openai.baseUrl,
      sourceRef: `knowledge-ai:${task}`, status: "success", startedAt,
    });
    providerCallLogged = true;
    return text;
  } catch (error) {
    if (!providerCallLogged) {
      await recordProviderCallLog({
        requestId, provider: config.provider, model: config.openai.model, baseUrl: config.openai.baseUrl,
        sourceRef: `knowledge-ai:${task}`, status: "error", startedAt, error,
      });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function buildRequestUrl(config) {
  const path = config.openai.apiMode === "chat_completions" ? OPENAI_CHAT_COMPLETIONS_PATH : OPENAI_RESPONSES_PATH;
  return `${config.openai.baseUrl}${path}`;
}

function buildRequestBody({ config, task, payload }) {
  const systemPrompt = [
    TASK_PROMPTS[task],
    "Return JSON only. Do not include markdown fences, comments, or explanatory prose.",
    "Keep section titles concise. Preserve operational facts and avoid inventing policy details.",
  ].join("\n");
  const userContent = JSON.stringify(payload, null, 2);

  if (config.openai.apiMode === "chat_completions") {
    return {
      model: config.openai.model,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
    };
  }

  return {
    model: config.openai.model,
    instructions: systemPrompt,
    input: [{ role: "user", content: userContent }],
    text: { format: { type: "json_object" } },
  };
}

function stripJsonFence(text) {
  return String(text || "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function limitSourceText(text) {
  const normalized = String(text || "").replace(/\r\n/g, "\n").trim();
  return normalized.length > MAX_SOURCE_TEXT_CHARS ? normalized.slice(0, MAX_SOURCE_TEXT_CHARS) : normalized;
}

function normalizeOpenAiError(payload, status) {
  const message = payload?.error?.message || payload?.message || "";
  return message ? `Knowledge AI ${status}: ${message}` : `Knowledge AI request failed with status ${status}`;
}

function createKnowledgeAiError(message, code, statusCode = 502) {
  const error = new Error(message || "Knowledge AI request failed");
  error.code = code;
  error.statusCode = statusCode;
  return error;
}
