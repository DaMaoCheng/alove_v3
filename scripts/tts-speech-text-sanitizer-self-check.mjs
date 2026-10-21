import assert from "node:assert/strict";
import { sanitizeTtsSpeechText } from "../server/tts-speech-text-sanitizer.js";

assert.equal(
  sanitizeTtsSpeechText("Goal!!! 😍 [smiles at you] **what a finish**"),
  "Goal! what a finish",
  "speech text should remove emoji, visual brackets, markdown, and repeated punctuation"
);

assert.equal(
  sanitizeTtsSpeechText("Here we go <break time=\"0.4s\" /> now."),
  "Here we go <break time=\"0.4s\" /> now.",
  "approved ElevenLabs break tags should be preserved"
);

assert.equal(
  sanitizeTtsSpeechText("Look <script>alert(1)</script> at this."),
  "Look at this.",
  "unsafe tags should be removed"
);

assert.equal(
  sanitizeTtsSpeechText("Line one\n\n\nLine two —— ready??"),
  "Line one\nLine two - ready?",
  "line breaks and punctuation should be normalized"
);

console.log("TTS speech text sanitizer self-check passed");
