import assert from "node:assert/strict";
import { normalizeCreateCharacterPayload } from "../server/character-normalizers.js";

const fields = normalizeCreateCharacterPayload({
  name: "Voice Test",
  categoryId: "companion",
  vibe: "Calm mentor",
  voice: "nova",
  language: "English",
  openingLine: "Hello",
  backstory: "A calm football companion with enough detail for validation.",
  visibility: "private",
});

assert.equal(fields.voice, "Nova", "create flow should store the short display voice label");
assert.equal(fields.voiceProvider, "elevenlabs", "create flow should store the ElevenLabs provider");
assert.equal(fields.voiceId, "EXAVITQu4vr4xnSDxMaL", "create flow should store the raw ElevenLabs voice id");
assert.equal(fields.voiceSampleUrl, "/uploads/voice/presets/nova.mp3", "create flow should store the preset preview url");

const labelFields = normalizeCreateCharacterPayload({
  name: "Label Test",
  categoryId: "companion",
  vibe: "Calm mentor",
  voice: "Nova",
  language: "English",
  openingLine: "Hello",
  backstory: "A calm football companion with enough detail for validation.",
});
assert.equal(labelFields.voiceId, fields.voiceId, "create flow should also resolve the preset display label");

assert.throws(
  () => normalizeCreateCharacterPayload({
    name: "Bad Voice Test",
    categoryId: "companion",
    vibe: "Calm mentor",
    voice: "Warm & friendly",
    language: "English",
    openingLine: "Hello",
    backstory: "A calm football companion with enough detail for validation.",
  }),
  /请选择角色声音/,
  "old local-only voice labels should not pass the user create flow"
);

console.log("create ElevenLabs voice mapping self-check passed");
