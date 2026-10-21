import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { adminCharacterEditorHtml } from "../src/features/admin-console/admin-character-editor-template.js";
import { mapConsoleCharacterPayload } from "../src/features/admin-console/admin-character-mapper.js";

const commonCreateHtml = adminCharacterEditorHtml({
  mode: "common",
  title: "新建通用角色",
  isCreate: true,
  character: {
    id: "",
    name: "",
    avatarUrl: "",
    categoryId: "companion",
    visibility: "public",
    status: "published",
    personality: "Calm mentor",
    voice: "Warm & friendly",
    language: "",
    openingLine: "",
    backstory: "",
  },
});

assert.match(commonCreateHtml, /data-character-avatar-generate/, "common create modal should include AI avatar generation button");
assert.match(commonCreateHtml, /data-character-ai-polish/, "common create modal should include AI polish button");
assert.match(commonCreateHtml, /class="[^"]*\bcf-field\b[^"]*"/, "common create modal should reuse create-page field styling");
assert.match(commonCreateHtml, /class="[^"]*\bpick-row\b[^"]*"/, "common create modal should render category/personality as create-page pills");
assert.match(commonCreateHtml, /class="[^"]*\bvoice-row\b[^"]*"/, "common create modal should render voice with the create-page voice row");
assert.match(commonCreateHtml, /class="[^"]*\bvis-card\b[^"]*"/, "common create modal should render visibility as create-page cards");
assert.match(commonCreateHtml, /name="status" value="published"/, "common create modal should submit published status by default");
assert.match(commonCreateHtml, /name="visibility" value="public"/, "common create modal should submit the selected visibility");
assert.match(commonCreateHtml, />头像</, "common create modal should use Chinese labels");
assert.match(commonCreateHtml, /上传头像/, "common create upload button should be Chinese");
assert.match(commonCreateHtml, /AI智能生成/, "common create AI avatar button should be Chinese");
assert.match(commonCreateHtml, />角色名称</, "common create character name label should be Chinese");
assert.match(commonCreateHtml, />音色</, "common create voice label should be Chinese");
assert.match(commonCreateHtml, />公开角色</, "common create modal should expose public visibility copy in Chinese");
assert.match(commonCreateHtml, />私密角色</, "common create modal should expose private visibility copy in Chinese");
assert.doesNotMatch(commonCreateHtml, /Avatar|Character name|Category|Personality|Voice|Language|Opening line|Backstory|Visibility|Upload avatar|AI generate|Clone my voice/, "common create modal labels and buttons should not use English UI copy");
assert.doesNotMatch(commonCreateHtml, /填写后会创建一个新的通用角色。|修改后会同步保存到角色资料。/, "common create modal should not show description under title");
assert.doesNotMatch(commonCreateHtml, /data-admin-voice-clone/, "common create modal should not show voice clone controls yet");
assert.doesNotMatch(commonCreateHtml, /data-admin-status-option|Character publish status|已上架|已下架/, "common create modal should not show publish status options");
assert.doesNotMatch(commonCreateHtml, /data-value="Creator"|>Creator</, "common create modal should not offer creator category");
assert.doesNotMatch(commonCreateHtml, /name="roleTitle"/, "common create modal should not ask for role title");
assert.doesNotMatch(commonCreateHtml, /name="shortBio"/, "common create modal should not ask for short bio");
assert.doesNotMatch(commonCreateHtml, /语音 ID|voiceId/, "common create modal should not ask for voice id");

const formData = new FormData();
formData.set("avatarUrl", "/uploads/demo.webp");
formData.set("name", "Demo");
formData.set("category", "companion");
formData.set("status", "published");
formData.set("visibility", "public");
formData.set("personality", "Calm mentor");
formData.set("voice", "Warm & friendly");
formData.set("language", "English");
formData.set("openingLine", "Hi");
formData.set("backstory", "Current story");

const payload = mapConsoleCharacterPayload(formData, { mode: "common" });
assert.equal(payload.shortBio, "", "short bio should not be manually submitted from common create modal");
assert.equal(payload.voiceId, "", "voice id should not be manually submitted from common create modal");
assert.equal(payload.backstory, "Current story", "common create payload should use submitted backstory");

const controllerSource = readFileSync("src/features/admin-console/admin-common-characters-controller.js", "utf8");
assert.match(controllerSource, /createAdminCharacter\(payload\)/, "common create should call real admin create API");
assert.match(controllerSource, /bindAdminCharacterAiControls\(host\)/, "common create should bind shared AI controls");
assert.doesNotMatch(controllerSource, /\{\s*\.\.\.mapConsoleCharacterPayload\([^}]+visibility:\s*"public"/s, "common create should respect the selected visibility instead of forcing public");

const serverSource = readFileSync("server/character-admin-service.js", "utf8");
assert.match(serverSource, /generateCharacterShortBio/, "admin character creation should generate short bio on the server");
assert.doesNotMatch(serverSource, /fields\.visibility\s*=\s*"public"/, "admin character creation should not override submitted visibility");

console.log("admin common character create self-check passed");
