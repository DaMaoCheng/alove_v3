import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { adminCharacterEditorHtml } from "../src/features/admin-console/admin-character-editor-template.js";
import { mapConsoleCharacterPayload } from "../src/features/admin-console/admin-character-mapper.js";
import { normalizeAdminCharacterPayload } from "../server/character-normalizers.js";

const privateEditHtml = adminCharacterEditorHtml({
  mode: "common",
  title: "编辑通用角色",
  character: {
    id: "char_private_demo",
    name: "Private Demo",
    avatarUrl: "",
    categoryId: "companion",
    roleTitle: "Companion · Test",
    shortBio: "This is the AI generated short bio.",
    visibility: "private",
    status: "published",
    personality: "Cheeky banter",
    voice: "Nova",
    voiceId: "EXAVITQu4vr4xnSDxMaL",
    language: "English",
    openingLine: "Hi",
    backstory: "Current story",
  },
});

assert.match(privateEditHtml, /admin-common-edit-form/, "common edit modal should use the common edit form variant");
assert.match(privateEditHtml, /class="[^"]*\bcf-field\b[^"]*"/, "common edit modal should reuse create-page field styling");
assert.match(privateEditHtml, /name="roleTitle"/, "common edit modal should expose role title");
assert.match(privateEditHtml, /knowledge-summary-text/, "common edit modal should show AI-generated short bio as readonly text");
assert.doesNotMatch(privateEditHtml, /name="shortBio"/, "common edit modal should not submit short bio");
assert.match(privateEditHtml, /data-admin-visibility-option/, "common edit modal should use visibility cards");
assert.match(privateEditHtml, /name="visibility" value="private"/, "common edit modal should preserve private visibility in the submitted value");
assert.match(privateEditHtml, /class="vis-card is-selected"[^>]*data-value="private"/, "private visibility card should be selected for private characters");
assert.doesNotMatch(privateEditHtml, /<input type="hidden" name="visibility" value="public" \/>/, "common edit modal should not force a hidden public visibility");
assert.match(privateEditHtml, /admin-common-edit-meta/, "common edit modal should render owner/id meta in a wrapping-safe row");
assert.match(privateEditHtml, />头像</, "common edit modal should use Chinese labels");
assert.match(privateEditHtml, /上传头像/, "common edit upload button should be Chinese");
assert.match(privateEditHtml, /AI智能生成/, "common edit AI avatar button should be Chinese");
assert.match(privateEditHtml, /删除头像/, "common edit remove avatar button should be Chinese");
assert.match(privateEditHtml, />音色</, "common edit voice label should be Chinese");
assert.match(privateEditHtml, /data-dd-value="nova"[\s\S]*is-active|is-active[\s\S]*data-dd-value="nova"/, "common edit voice dropdown should select the saved voice preset");
assert.doesNotMatch(privateEditHtml, /Clone my voice|克隆音色|data-admin-voice-clone/, "common edit modal should not show voice clone controls yet");
assert.doesNotMatch(privateEditHtml, /修改后会同步保存到角色资料。|填写后会创建一个新的通用角色。/, "common edit modal should not show the description under title");

const legacyVoiceEditHtml = adminCharacterEditorHtml({
  mode: "common",
  title: "编辑通用角色",
  character: {
    id: "char_legacy_voice",
    name: "Legacy Voice",
    categoryId: "companion",
    visibility: "public",
    status: "published",
    voice: "Warm & friendly",
  },
});
assert.match(legacyVoiceEditHtml, /data-dd-value="Warm &amp; friendly"[\s\S]*is-active|is-active[\s\S]*data-dd-value="Warm &amp; friendly"/, "common edit voice dropdown should show legacy saved voice text when it is not a preset");

const formData = new FormData();
formData.set("avatarUrl", "");
formData.set("name", "Private Demo");
formData.set("roleTitle", "Companion · Test");
formData.set("category", "companion");
formData.set("status", "published");
formData.set("visibility", "private");
formData.set("personality", "Cheeky banter");
formData.set("voice", "nova");
formData.set("language", "English");
formData.set("languageCode", "en");
formData.set("openingLine", "Hi");
formData.set("backstory", "Current story");

const payload = mapConsoleCharacterPayload(formData, { mode: "common" });
assert.equal(payload.visibility, "private", "common edit payload should preserve submitted private visibility");
assert.equal(payload.shortBio, "", "common edit payload should not manually change short bio when the field is absent");

const normalized = normalizeAdminCharacterPayload(payload, {
  category_id: "companion",
  role_title: "Companion · Test",
  short_bio: "Existing AI short bio",
  persona_prompt: "Current story",
  speaking_style: "Cheeky banter",
  voice_provider: "elevenlabs",
  voice_id: "EXAVITQu4vr4xnSDxMaL",
  voice_style: "Nova",
  profile_json: JSON.stringify({ language: "English", languageCode: "en" }),
  visibility: "private",
  character_status: "published",
});
assert.equal(normalized.shortBio, "Existing AI short bio", "server normalization should preserve AI-generated short bio when edit form omits it");

const templateSource = readFileSync("src/features/admin-console/admin-character-editor-template.js", "utf8");
assert.doesNotMatch(templateSource, /if \(!isCreator\) return `<input type="hidden" name="visibility" value="public"/, "common edit should not contain the old force-public visibility rule");

const css = [
  "src/features/app-shell/styles/admin-console.css",
  "src/features/app-shell/styles/admin-character-editor.css",
].map((path) => readFileSync(path, "utf8")).join("\n");
assert.match(css, /\.admin-common-edit-form \.cf-avatar-row/, "common edit avatar row should have its own responsive layout");
assert.match(css, /\.character-avatar-remove\{[\s\S]*white-space:normal/, "avatar remove button should allow wrapping");
assert.match(css, /\.character-avatar-actions \.btn/, "avatar action buttons should have wrapping-safe sizing");
assert.match(css, /\.admin-common-edit-form \.cf-avatar-actions\{[\s\S]*justify-self:start/, "common edit avatar actions should stay left aligned near the avatar");

console.log("admin common character edit layout self-check passed");
