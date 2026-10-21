import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const chatPageSource = readFileSync("src/features/chat/chat-message-renderer.js", "utf8");
const chatVoiceSource = readFileSync("src/features/chat/chat-voice.js", "utf8");
const chatVoiceCss = readFileSync("src/features/app-shell/styles/chat-voice.css", "utf8");

assert.match(
  chatPageSource,
  /hasPlayableVoice\s*\?\s*message\.voice\?\.durationSeconds\s*\|\|\s*estimateVoiceDuration\(message\.text\)\s*:\s*0/,
  "character messages should pass 0 seconds when voice is unavailable"
);

assert.match(
  chatPageSource,
  /hasPlayableVoice\s*\?\s*message\.voice\?\.audioUrl\s*\|\|\s*""\s*:\s*""/,
  "character messages should strip audio url unless the voice is ready"
);

assert.match(
  chatVoiceSource,
  /const displayedSeconds = disabled \? 0 : seconds;/,
  "voice button should display zero duration when disabled"
);

assert.match(
  chatVoiceSource,
  /String\(minutes\)\.padStart\(2,\s*"0"\)/,
  "voice duration should render two-digit minutes"
);

assert.match(
  chatVoiceCss,
  /\.voice-btn\.is-disabled \.vb-ic\{\s*background:var\(--tile-hover\);\s*color:var\(--muted\);\s*\}/,
  "disabled voice icon should be grey instead of accent colored"
);

console.log("chat voice unavailable UI self-check passed");
