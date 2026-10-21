import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { adminCharacterEditorHtml } from "../src/features/admin-console/admin-character-editor-template.js";

const commonEditHtml = adminCharacterEditorHtml({
  mode: "common",
  title: "编辑通用角色",
  character: {
    id: "char_demo_001",
    name: "Mina",
    avatarUrl: "",
    categoryId: "companion",
    visibility: "public",
    status: "published",
    shortBio: "自动生成的简介",
    backstory: "当前弹窗里的背景故事",
  },
});

assert.match(commonEditHtml, /admin-common-edit-form/, "common edit modal should use the create-page style edit form");
assert.match(commonEditHtml, /knowledge-summary-text/, "common edit modal should show short bio as readonly generated text");
assert.doesNotMatch(commonEditHtml, /name="shortBio"/, "common edit modal should not expose short bio as an editable field");
assert.doesNotMatch(commonEditHtml, /readonly-text/, "common edit modal should not use old boxed readonly short bio style");
assert.match(commonEditHtml, /data-character-avatar-generate/, "common edit modal should include AI avatar generation button");
assert.match(commonEditHtml, /data-character-ai-polish/, "common edit modal should include AI polish button");

const creatorEditHtml = adminCharacterEditorHtml({
  mode: "creator",
  title: "编辑网红角色",
  character: {
    id: "creator_demo_001",
    name: "Creator",
    avatarUrl: "",
    categoryId: "creator",
    visibility: "public",
    status: "published",
    shortBio: "简介",
    backstory: "背景故事",
  },
});

assert.doesNotMatch(creatorEditHtml, /name="roleTitle"|角色定位/, "creator edit modal should not expose manual role title field");
assert.match(creatorEditHtml, /data-character-avatar-generate/, "creator edit modal should include AI avatar generation button");
assert.match(creatorEditHtml, /data-character-ai-polish/, "creator edit modal should include AI polish button");

const controllerSource = readFileSync("src/features/admin-console/admin-common-characters-controller.js", "utf8");
assert.match(controllerSource, /bindAdminCharacterAiControls\(host\)/, "common character controller should bind shared AI controls");
assert.doesNotMatch(controllerSource, /admin-character-ai-create-controls|bindAdminCharacterAiCreateControls/, "common character controller should not reference old create-only AI controls");

const aiControlsSource = readFileSync("src/features/admin-console/admin-character-ai-controls.js", "utf8");
assert.match(aiControlsSource, /readCharacterPayload\(form\)/, "AI polish should read the current form payload");
assert.match(aiControlsSource, /readFormValue\(form, "backstory"\)/, "AI polish payload should use the current backstory textarea value");

const adminCss = [
  readFileSync("src/features/app-shell/styles/admin-console.css", "utf8"),
  readFileSync("src/features/app-shell/styles/admin-knowledge.css", "utf8"),
].join("\n");
assert.match(adminCss, /\.knowledge-summary-text\{/, "knowledge summary text style should be available to common edit short bio");
assert.doesNotMatch(adminCss, /\.readonly-text\{/, "old boxed readonly text style should be removed");

console.log("admin common character edit AI self-check passed");
