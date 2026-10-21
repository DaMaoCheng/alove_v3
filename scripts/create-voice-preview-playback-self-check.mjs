import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const pageSource = [
  "src/features/create-character/create-character-page.js",
  "src/features/create-character/create-character-voice-preview.js",
].map((path) => readFileSync(path, "utf8")).join("\n");
const templateSource = readFileSync("src/features/create-character/create-character-template.js", "utf8");

assert.match(templateSource, /data-voice-preview/, "voice preset options should expose preview buttons");
assert.match(pageSource, /ICONS\.pause/, "playing preview button should switch to the pause icon");
assert.match(pageSource, /ICONS\.play/, "stopped preview button should restore the play icon");
assert.match(pageSource, /stopActiveVoicePreview/, "voice preview playback should have a shared stop helper");
assert.match(pageSource, /page\.isConnected/, "voice preview should stop when the create page is no longer mounted");
assert.match(pageSource, /visibilitychange/, "voice preview should stop when the current page becomes hidden");
assert.match(pageSource, /pagehide/, "voice preview should stop on browser page navigation");
assert.match(pageSource, /beforeunload/, "voice preview should stop before browser refresh or close");

console.log("create voice preview playback self-check passed");
