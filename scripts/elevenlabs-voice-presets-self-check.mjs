import assert from "node:assert/strict";
import { existsSync, statSync } from "node:fs";
import { ELEVENLABS_VOICE_PRESETS, getElevenLabsVoicePreset } from "../shared/voice-presets.js";

const ORIGINAL_ELEVENLABS_NAMES = new Set([
  "Sarah",
  "Jessica",
  "Alice",
  "Lily",
  "Bella",
  "Roger",
  "Eric",
  "George",
  "Charlie",
  "Daniel",
  "River",
]);

assert.equal(ELEVENLABS_VOICE_PRESETS.length, 11, "should expose exactly 11 ElevenLabs preset voices");

const ids = new Set();
for (const preset of ELEVENLABS_VOICE_PRESETS) {
  assert.ok(preset.id, "preset should have a stable app id");
  assert.ok(!ids.has(preset.id), `preset id should be unique: ${preset.id}`);
  ids.add(preset.id);
  assert.ok(preset.label.length <= 8, `preset label should stay short: ${preset.label}`);
  assert.ok(!ORIGINAL_ELEVENLABS_NAMES.has(preset.label), `preset label should not reuse ElevenLabs original name: ${preset.label}`);
  assert.equal(preset.provider, "elevenlabs", `${preset.id} should use ElevenLabs provider`);
  assert.match(preset.voiceId, /^[A-Za-z0-9]+$/, `${preset.id} should keep the raw ElevenLabs voice id`);
  assert.equal(preset.qualityModel, "eleven_v4_turbo", `${preset.id} should use the Turbo model`);
  assert.equal(preset.fastModel, "eleven_v4_turbo", `${preset.id} should record the Turbo realtime model`);
  assert.match(preset.sampleUrl, /^\/uploads\/voice\/presets\/.+\.mp3$/, `${preset.id} should have a served preview url`);
  assert.equal(getElevenLabsVoicePreset(preset.id)?.voiceId, preset.voiceId, `${preset.id} should be resolvable by id`);
  assert.equal(getElevenLabsVoicePreset(preset.label)?.voiceId, preset.voiceId, `${preset.id} should be resolvable by label`);

  const localPath = preset.sampleUrl.replace(/^\//, "");
  assert.ok(existsSync(localPath), `${preset.id} preview audio should exist at ${localPath}`);
  assert.ok(statSync(localPath).size > 1024, `${preset.id} preview audio should not be empty`);
}

console.log("ElevenLabs voice presets self-check passed");
