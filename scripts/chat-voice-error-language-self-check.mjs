import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const chatPageSource = readFileSync("src/features/chat/chat-page.js", "utf8");
const composerSource = readFileSync("src/features/chat/chat-composer.js", "utf8");
const voiceSource = readFileSync("src/features/chat/chat-composer-voice.js", "utf8");

assert.match(chatPageSource, /bindChatComposer\(wrap,[\s\S]*\bpageLanguage,\s*[\s\S]*\bonSubmit:/, "chat page should pass pageLanguage to composer controls");
assert.match(composerSource, /pageLanguage = "English"/, "composer should accept pageLanguage with English fallback");
assert.match(composerSource, /bindChatVoiceControls\(root, \{ character, pageLanguage, onVoiceSubmit/, "composer should pass pageLanguage to voice controls");
assert.match(voiceSource, /function getVoiceErrorCopy/, "voice errors should use a localized copy resolver");
assert.match(voiceSource, /createSiteCopy\(pageLanguage\)/, "voice error copy should resolve from the shared site language bundle");
assert.match(voiceSource, /copy\.t\("chat\.voiceFailedTitle"\)/, "voice errors should use the localized title key");
assert.match(voiceSource, /copy\.t\("common\.gotIt"\)/, "voice errors should use the localized confirmation key");
assert.doesNotMatch(voiceSource, /showVoiceError\(error\.message \|\| "语音发送失败，请稍后再试。"\)/, "voice send failure should not pass a hard-coded Chinese dialog message");

console.log("chat voice error language self-check passed");
