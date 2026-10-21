import assert from "node:assert/strict";
import { createCharacterPageHtml } from "../src/features/create-character/create-character-template.js";

const html = createCharacterPageHtml({
  createState: {
    name: "",
    avatarUrl: "",
    avatarPreviewUrl: "",
    cat: "companion",
    vibe: "Calm mentor",
    voice: "Warm & friendly",
    language: "",
    openingLine: "",
    backstory: "",
    isPublic: false,
  },
  category: { key: "companion", label: "Companion" },
  user: { role: "personal" },
});

assert.match(html, /class="voice-row"/, "voice field should render a two-column row");
assert.match(html, /data-dd-select/, "voice field should use the shared dropdown component");
assert.match(html, /name="voice"/, "voice dropdown should submit the voice value");
assert.match(html, /class="voice-option-play"/, "each voice option should render a play icon before the label");
assert.match(html, /data-voice-preview="\/uploads\/voice\/presets\/nova\.mp3"/, "voice option should bind a real preset preview audio url");
assert.match(html, />Nova</, "voice dropdown should use the custom short preset names");
assert.doesNotMatch(html, />Sarah</, "voice dropdown should not expose ElevenLabs original voice names");
assert.match(html, /class="voice-clone-btn"/, "clone voice should be a separate side button");
assert.match(html, /data-voice-clone/, "clone voice button should have its own action hook");
assert.match(html, /class="[^"]*\bcreate-language-dd\b[^"]*"/, "language field should use a searchable dropdown");
assert.match(html, /data-language-search/, "language field should have a search input");
assert.match(html, />Chinese \(Mandarin\)</, "language dropdown should expose standardized language labels");
assert.doesNotMatch(html, /placeholder="e\.g\. English, Español, 日本語"/, "language field should not be a free text input");
assert.doesNotMatch(html, /data-key="voice"/, "voice presets should not render as old pick capsules");
assert.doesNotMatch(html, /pick-pro/, "clone voice should not be rendered as a pro capsule inside the preset list");

console.log("create voice dropdown UI self-check passed");
