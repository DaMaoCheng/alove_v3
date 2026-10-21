import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const speechSource = readFileSync("server/chat-reply-speech-service.js", "utf8");
const orchestratorSource = readFileSync("server/chat-reply-orchestrator-service.js", "utf8");
const textSource = readFileSync("server/chat-text-message-service.js", "utf8");
const voiceSource = readFileSync("server/chat-voice-message-service.js", "utf8");

assert.match(
  speechSource,
  /displayText:\s*replyText/,
  "shared speech alignment should always use the final visible reply text as displayText"
);
assert.match(
  speechSource,
  /speechText:\s*replyText/,
  "shared speech alignment should fall back to the final visible reply text when model speech output diverges"
);
assert.match(
  speechSource,
  /stripTtsControlTags/,
  "shared speech alignment should compare stripped TTS tags before accepting model speech text"
);
assert.match(
  orchestratorSource,
  /const speechText = [\s\S]*?resolveReplySpeechText/,
  "reply orchestrator should centralize speech text alignment"
);
assert.match(textSource, /persistCharacterReplyForDb/, "text reply should route through the shared reply persistence flow");
assert.match(voiceSource, /persistCharacterReplyForDb/, "voice reply should route through the shared reply persistence flow");
assert.doesNotMatch(textSource, /replyResult\.speechText \|\| replyResult\.text/, "text reply entry should not reintroduce divergent speech/text fallback");
assert.doesNotMatch(voiceSource, /replyResult\.speechText \|\| replyResult\.text/, "voice reply entry should not reintroduce divergent speech/text fallback");

console.log("chat reply voice/text alignment self-check passed");
