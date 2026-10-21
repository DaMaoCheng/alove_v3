import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const pagePath = "src/features/create-character/create-character-page.js";
const previewPath = "src/features/create-character/create-character-preview.js";
const voicePath = "src/features/create-character/create-character-voice-preview.js";
const languagePath = "src/features/create-character/create-character-language-picker.js";

for (const path of [pagePath, previewPath, voicePath, languagePath]) {
  assert.ok(existsSync(path), `create character split file should exist: ${path}`);
}

const pageSource = readFileSync(pagePath, "utf8");
const previewSource = readFileSync(previewPath, "utf8");
const voiceSource = readFileSync(voicePath, "utf8");
const languageSource = readFileSync(languagePath, "utf8");

assert.match(pageSource, /bindVoicePreviewButtons/, "create page should bind voice preview module");
assert.match(pageSource, /bindLanguagePicker/, "create page should bind language picker module");
assert.doesNotMatch(pageSource, /let activeVoicePreviewAudio/, "create page should not own voice preview playback state");
assert.doesNotMatch(pageSource, /function stopActiveVoicePreview/, "create page should not own voice preview stop helper");
assert.doesNotMatch(pageSource, /function renderLanguageOptions/, "create page should not own language option rendering");
assert.doesNotMatch(pageSource, /function selectLanguage/, "create page should not own language selection rendering");
assert.doesNotMatch(pageSource, /data-create-preview-voice|PREVIEW_VOICE_PLACEHOLDER/, "create page should not update a voice preview field");
assert.ok(pageSource.split(/\r?\n/).length <= 230, "create page should be smaller after secondary split");
assert.doesNotMatch(previewSource, /cp-voice|data-create-preview-voice|Voice style/, "create side preview should not show voice style");

assert.match(voiceSource, /export function bindVoicePreviewButtons/, "voice module should export preview binder");
assert.match(voiceSource, /stopActiveVoicePreview/, "voice module should own preview stop helper");
assert.match(voiceSource, /page\.isConnected/, "voice module should stop playback when page unmounts");
assert.match(voiceSource, /visibilitychange/, "voice module should stop playback when hidden");
assert.match(voiceSource, /pagehide/, "voice module should stop playback on navigation");
assert.match(voiceSource, /beforeunload/, "voice module should stop playback before unload");

assert.match(languageSource, /export function bindLanguagePicker/, "language module should export picker binder");
assert.match(languageSource, /searchCharacterLanguages/, "language module should search supported languages");
assert.match(languageSource, /findCharacterLanguage/, "language module should resolve selected language");
assert.match(languageSource, /data-language-option/, "language module should render language options");
assert.match(languageSource, /onChange\("language"/, "language module should update language label");
assert.match(languageSource, /onChange\("languageCode"/, "language module should update language code");

console.log("create character page secondary split self-check passed");
