import { resolveKnowledgeAiConfig } from "../server/config.js";
import { getKnowledgeAiConfig, isKnowledgeAiConfigured } from "../server/knowledge-ai-config.js";
const service = await import("../server/knowledge-ai-service.js");

const chatConfig = {
  provider: "openai",
  openai: {
    apiKey: "chat-key",
    baseUrl: "https://chat.example/v1",
    model: "chat-model",
    apiMode: "chat_completions",
    timeoutMs: 12345,
  },
};
const inherited = resolveKnowledgeAiConfig({}, chatConfig);
assertEqual(inherited.provider, "openai", "inherits provider");
assertEqual(inherited.openai.apiKey, "chat-key", "inherits api key");
assertEqual(inherited.openai.baseUrl, "https://chat.example/v1", "inherits base url");
assertEqual(inherited.openai.model, "chat-model", "inherits model");
assertEqual(inherited.openai.apiMode, "chat_completions", "inherits api mode");
assertEqual(inherited.openai.timeoutMs, 12345, "inherits timeout");
assertEqual(isKnowledgeAiConfigured(inherited), true, "configured through inherited chat key");

const overridden = resolveKnowledgeAiConfig({
  KNOWLEDGE_AI_API_KEY: "knowledge-key",
  KNOWLEDGE_AI_BASE_URL: "https://knowledge.example/v1/",
  KNOWLEDGE_AI_MODEL: "knowledge-model",
  KNOWLEDGE_AI_API_MODE: "responses",
  KNOWLEDGE_AI_TIMEOUT_MS: "54321",
}, chatConfig);
assertEqual(overridden.openai.apiKey, "knowledge-key", "overrides api key");
assertEqual(overridden.openai.baseUrl, "https://knowledge.example/v1", "normalizes base url");
assertEqual(overridden.openai.model, "knowledge-model", "overrides model");
assertEqual(overridden.openai.apiMode, "responses", "overrides api mode");
assertEqual(overridden.openai.timeoutMs, 54321, "overrides timeout");

for (const name of ["generateKnowledgeOutline", "splitKnowledgeSections", "summarizeKnowledgeSections", "extractKnowledgeKeywords", "requestKnowledgeAiJson"]) {
  if (typeof service[name] !== "function") throw new Error(`Missing export ${name}`);
}

let unsupportedTaskFailed = false;
try {
  await service.requestKnowledgeAiJson({ task: "unknown", payload: {}, config: overridden });
} catch (error) {
  unsupportedTaskFailed = error.code === "knowledge_ai_unsupported_task" && error.statusCode === 400;
}
if (!unsupportedTaskFailed) throw new Error("Unsupported task should fail loudly");

const unconfigured = {
  provider: "openai",
  openai: {
    apiKey: "",
    baseUrl: "https://knowledge.example/v1",
    model: "knowledge-model",
    apiMode: "responses",
    timeoutMs: 1,
  },
};
let unconfiguredFailed = false;
try {
  await service.requestKnowledgeAiJson({ task: "outline", payload: {}, config: unconfigured });
} catch (error) {
  unconfiguredFailed = error.code === "knowledge_ai_not_configured";
}
if (!unconfiguredFailed) throw new Error("Unconfigured knowledge AI should fail loudly");

if (getKnowledgeAiConfig() === undefined) throw new Error("centralized knowledge config should be available");
console.log("knowledge ai config self-check passed");

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}
