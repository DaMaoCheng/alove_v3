import { SERVER_CONFIG } from "./config.js";

export function getKnowledgeAiConfig() {
  return SERVER_CONFIG.knowledgeAi;
}

export function isKnowledgeAiConfigured(config = getKnowledgeAiConfig()) {
  return config.provider === "openai" && Boolean(config.openai.apiKey);
}
