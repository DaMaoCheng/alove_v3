import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const configSource = readFileSync("server/config.js", "utf8");
const providerSource = readFileSync("server/ai-reply-provider-service.js", "utf8");

assert.match(configSource, /reasoningEffort: normalizeOpenAiReasoningEffort\(process\.env\.OPENAI_REASONING_EFFORT\)/, "server config should read OPENAI_REASONING_EFFORT");
assert.match(configSource, /function normalizeOpenAiReasoningEffort\(value\)/, "server config should normalize reasoning effort");
assert.match(configSource, /\["minimal", "low", "medium", "high"\]/, "reasoning effort should support minimal through high");
assert.doesNotMatch(providerSource, /reasoning_effort:/, "chat completions request should not send reasoning_effort because clcl chat completions rejects it");
assert.match(providerSource, /reasoning: \{ effort: openAiConfig\.reasoningEffort \}/, "responses request should send the selected model reasoning effort");

console.log("AI reasoning effort self-check passed");
