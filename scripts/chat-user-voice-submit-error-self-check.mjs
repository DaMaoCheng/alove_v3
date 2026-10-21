import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const chatPageSource = readFileSync("src/features/chat/chat-page.js", "utf8");
const voiceActionsSource = readFileSync("src/app/chat-voice-actions.js", "utf8");

assert.match(
  chatPageSource,
  /onVoiceSubmit:\s*async\s*\(voiceClip\)\s*=>\s*\{[\s\S]*await onSendVoice\?\.\(\{[\s\S]*voice:\s*voiceClip[\s\S]*\}\)/,
  "chat page should submit recorded voice clips to onSendVoice"
);
assert.match(
  chatPageSource,
  /if \(!result\?\.ok\)\s*\{[\s\S]*throw new Error\(result\?\.error \|\| ["']Voice message failed\.["']\)/,
  "chat page should throw voice submit failures back to the recorder UI instead of silently swallowing them"
);
assert.match(
  voiceActionsSource,
  /const userMessage = getUserFacingErrorMessage\(error,[\s\S]*fallbackType: "voice"[\s\S]*return \{ ok: false, error: userMessage \}/,
  "voice action should return user-facing error copy to the chat page"
);
assert.match(
  voiceActionsSource,
  /const rawReason = getRawErrorMessage\(error\);[\s\S]*reason: rawReason/,
  "voice action should keep raw errors for analytics"
);

console.log("chat user voice submit error self-check passed");
