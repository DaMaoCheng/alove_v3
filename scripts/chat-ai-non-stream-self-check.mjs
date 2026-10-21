import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const providerSource = readFileSync(new URL("../server/ai-reply-provider-service.js", import.meta.url), "utf8");
const characterBioSource = readFileSync(new URL("../server/character-short-bio-service.js", import.meta.url), "utf8");
const knowledgeSource = readFileSync(new URL("../server/knowledge-ai-service.js", import.meta.url), "utf8");

assert.match(
  providerSource,
  /chat_completions[\s\S]*?return \{[\s\S]*?stream:\s*false,[\s\S]*?messages:/,
  "chat completions chat reply request must explicitly disable streaming"
);
assert.match(
  providerSource,
  /return \{[\s\S]*?model:\s*openAiConfig\.model,[\s\S]*?stream:\s*false,[\s\S]*?reasoning:/,
  "responses chat reply request must explicitly disable streaming"
);
assert.doesNotMatch(
  providerSource,
  /stream:\s*true/,
  "chat reply provider must not enable streaming"
);
assert.match(
  providerSource,
  /export async function requestOpenAiReply\(promptContext, \{[\s\S]*?timeoutMs = SERVER_CONFIG\.aiReply\.openai\.timeoutMs,[\s\S]*?modelConfig = SERVER_CONFIG\.aiReply\.openai,[\s\S]*?\} = \{\}\)/,
  "chat reply non-stream rule should stay on the shared chat AI provider"
);
assert.doesNotMatch(
  characterBioSource,
  /stream:\s*false/,
  "non-stream enforcement should not be spread into character short bio AI in this change"
);
assert.doesNotMatch(
  knowledgeSource,
  /stream:\s*false/,
  "non-stream enforcement should not be spread into knowledge AI in this change"
);

console.log("chat AI non-stream self-check passed");
