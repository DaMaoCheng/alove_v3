import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveProviderLogLabel } from "../server/ai-reply-log-service.js";

assert.equal(resolveProviderLogLabel("openai", "https://clclapi.com/v1"), "clcl", "CLCL endpoints must be labelled as CLCL");
assert.equal(resolveProviderLogLabel("openai", "https://api.venice.ai/api/v1"), "venice", "Venice endpoints must be labelled as Venice");
assert.equal(resolveProviderLogLabel("anything", "https://api.elevenlabs.io/v1"), "elevenlabs", "ElevenLabs endpoints must be labelled as ElevenLabs");
assert.equal(resolveProviderLogLabel("brave", "https://api.search.brave.com/res/v1"), "brave", "Brave endpoints must be labelled as Brave");

const auditedServices = [
  "server/ai-reply-provider-service.js",
  "server/ai-json-provider-service.js",
  "server/product-intent-classifier-service.js",
  "server/chat-image-intent-classifier-service.js",
  "server/chat-order-intent-service.js",
  "server/knowledge-ai-service.js",
  "server/avatar-moderation-service.js",
  "server/character-polish-service.js",
  "server/image-generation-provider-service.js",
  "server/elevenlabs-tts-service.js",
  "server/elevenlabs-stt-service.js",
  "server/call-provider-socket-service.js",
  "server/brave-search-service.js",
];

for (const file of auditedServices) {
  const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
  assert.match(source, /recordProviderCallLog|requestAiJsonWithProviderFallback/, `${file} must write or delegate provider-call audit records`);
}

const logService = readFileSync(new URL("../server/ai-reply-log-service.js", import.meta.url), "utf8");
assert.match(logService, /provider_success/, "provider successes must remain visible in the admin log union");
assert.match(logService, /provider_error/, "provider failures must remain visible in the admin log union");
assert.match(logService, /never upstream response bodies,\s*\/\/ prompts, credentials/, "provider logs must keep the no-sensitive-content boundary");

console.log("provider call audit self-check passed");
