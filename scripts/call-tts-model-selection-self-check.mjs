import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SERVER_CONFIG } from "../server/config.js";
import { parseStructuredChatReply } from "../server/chat-reply-structure-service.js";
import {
  VOICE_MODEL_MODE_REALTIME_CALL_FAST,
  resolveReplyVoiceModel,
} from "../server/chat-text-message-service.js";
import {
  findCharacterLanguage,
  normalizeCharacterLanguage,
} from "../shared/language-library.js";

const config = {
  qualityModel: "eleven_v3",
  fastModel: "eleven_flash_v2_5",
};

for (const code of ["en", "zh", "ja", "hr", "tl", "pt", "no"]) {
  const decision = resolveReplyVoiceModel({
    mode: VOICE_MODEL_MODE_REALTIME_CALL_FAST,
    languageCode: code,
    config,
  });
  assert.equal(decision.model, "eleven_flash_v2_5", `${code} should use Flash in realtime call mode`);
  assert.equal(decision.reason, "flash_supported", `${code} should report flash_supported`);
}

for (const code of ["bn", "ur", "fa", "he", "th"]) {
  const decision = resolveReplyVoiceModel({
    mode: VOICE_MODEL_MODE_REALTIME_CALL_FAST,
    languageCode: code,
    config,
  });
  assert.equal(decision.model, "eleven_v3", `${code} should fall back to v3 in realtime call mode`);
  assert.equal(decision.reason, "flash_unsupported_fallback_v3", `${code} should report unsupported fallback`);
}

const unknownDecision = resolveReplyVoiceModel({
  mode: VOICE_MODEL_MODE_REALTIME_CALL_FAST,
  languageCode: "xx",
  config,
});
assert.equal(unknownDecision.model, "eleven_v3", "unknown language should fall back to v3");
assert.equal(unknownDecision.reason, "unknown_language_fallback_v3");

const normalChatDecision = resolveReplyVoiceModel({
  mode: "",
  languageCode: "en",
  config,
});
assert.equal(normalChatDecision.model, "eleven_v3", "normal chat should keep the quality model");
assert.equal(normalChatDecision.reason, "quality_default");

const turboConfig = { qualityModel: "eleven_v4_turbo", fastModel: "eleven_v4_turbo" };
for (const code of ["en", "es", "zh", "he", "th", "xx"]) {
  const decision = resolveReplyVoiceModel({ mode: VOICE_MODEL_MODE_REALTIME_CALL_FAST, languageCode: code, config: turboConfig });
  assert.equal(decision.model, "eleven_v4_turbo", "Turbo must not inherit the old Flash language restriction");
  assert.equal(decision.reason, "v4_turbo_realtime");
}
assert.equal(resolveReplyVoiceModel({ languageCode: "es", config: turboConfig }).model, "eleven_v4_turbo");
assert.equal(parseStructuredChatReply("A plain reply.").voiceMeta.model, SERVER_CONFIG.elevenLabs.qualityModel, "plain replies must not reintroduce a hardcoded old model");

for (const [alias, code] of [
  ["zh-cn", "zh"],
  ["zh_CN", "zh"],
  ["cmn", "zh"],
  ["pt-BR", "pt"],
  ["br", "pt"],
  ["fil", "tl"],
  ["tagalog", "tl"],
  ["nb", "no"],
  ["nor", "no"],
]) {
  assert.equal(findCharacterLanguage(alias)?.code, code, `${alias} should resolve to ${code}`);
}

assert.equal(normalizeCharacterLanguage("he")?.flashSupported, false, "Hebrew should not be marked Flash supported");
assert.equal(normalizeCharacterLanguage("th")?.flashSupported, false, "Thai should not be marked Flash supported");

const callSource = [
  "server/call-realtime-service.js",
  "server/call-turn-service.js",
  "server/call-diagnostics-service.js",
].map((path) => readFileSync(path, "utf8")).join("\n");
assert.match(callSource, /voiceModelMode:\s*VOICE_MODEL_MODE_REALTIME_CALL_FAST/, "realtime call should request fast TTS mode explicitly");
assert.match(callSource, /ttsModelReason/, "call timing log should include TTS model fallback reason");

console.log("call TTS model selection self-check passed");
