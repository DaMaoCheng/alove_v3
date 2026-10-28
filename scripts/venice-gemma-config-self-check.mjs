import assert from "node:assert/strict";
import { SERVER_CONFIG } from "../server/config.js";

const replyChain = SERVER_CONFIG.aiReply.replyChain;
const [venice, openai, deepseek] = replyChain;

assert.equal(venice.id, "venice", "Venice must be the first chat reply provider");
assert.equal(venice.baseUrl, "https://api.venice.ai/api/v1", "Venice must use its OpenAI-compatible API base URL");
assert.equal(venice.model, "deepseek-v4-1-flash-1017-uncensored", "Venice must use the user-selected primary model");
assert.equal(venice.apiMode, "chat_completions", "Venice must use chat completions instead of Responses API");
assert.equal(venice.requestBodyExtras?.venice_parameters?.include_venice_system_prompt, false, "ALOVE must not append Venice's default system prompt");
assert.equal(openai.id, "openai", "the configured OpenAI-compatible slot remains the first fallback; its model may be official DeepSeek");
assert.equal(deepseek.id, "deepseek", "the configured legacy fallback must remain the second fallback slot");
assert.equal(deepseek.model, SERVER_CONFIG.aiReply.fallbackOpenai.model, "the second fallback must reuse the existing configured DeepSeek model");

console.log("Venice primary chat configuration self-check passed");
