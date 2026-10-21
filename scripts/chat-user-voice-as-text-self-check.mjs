import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const routesSource = readFileSync("server/chat-routes.js", "utf8");
const voiceMessageSource = readFileSync("server/chat-voice-message-service.js", "utf8");
const messageStoreSource = readFileSync("server/chat-message-store.js", "utf8");
const voiceActionsSource = readFileSync("src/app/chat-voice-actions.js", "utf8");

assert.doesNotMatch(
  routesSource,
  /saveChatVoiceUpload/,
  "chat voice route should not persist raw user audio after ASR"
);
assert.match(
  routesSource,
  /createUserVoiceMessage\(\{[\s\S]*asr:\s*transcript[\s\S]*\}\)/,
  "chat voice route should pass ASR metadata to the text-message creation path"
);
assert.doesNotMatch(
  voiceMessageSource,
  /insertVoiceAsset\(/,
  "user voice messages should not create user_message voice assets"
);
assert.doesNotMatch(
  voiceMessageSource,
  /normalizeVoicePayload/,
  "user voice messages should not require a stored voice payload"
);
assert.match(
  voiceMessageSource,
  /contentType:\s*["']text["']/,
  "ASR voice input should still land as normal text messages"
);
assert.match(
  voiceMessageSource,
  /sourceRef:\s*["']voice-asr["']/,
  "ASR voice input should keep a lightweight source marker for diagnostics"
);
assert.match(
  messageStoreSource,
  /source_ref\s+IN\s+\(["']user-input["'],\s*["']voice-asr["']\)/,
  "AI reply scheduling should treat ASR text as normal user text input"
);
assert.match(
  messageStoreSource,
  /\(content_type = 'text' AND source_ref = 'voice-asr'\)/,
  "voice reply lookup should accept the persisted ASR text message shape"
);
assert.match(
  voiceActionsSource,
  /scheduleDelayedReply\?\.\(normalizedCharacterId, userTextMessage\.id\)/,
  "ASR text messages should schedule AI replies just like typed text messages"
);

console.log("chat user voice as text self-check passed");
