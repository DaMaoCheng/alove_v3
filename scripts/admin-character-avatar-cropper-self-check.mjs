import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const avatarControlsSource = readFileSync(new URL("../src/features/admin-console/admin-character-avatar-controls.js", import.meta.url), "utf8");
const commonControllerSource = readFileSync(new URL("../src/features/admin-console/admin-common-characters-controller.js", import.meta.url), "utf8");
const creatorControllerSource = readFileSync(new URL("../src/features/admin-console/admin-creator-characters-controller.js", import.meta.url), "utf8");
const mascotControllerSource = readFileSync(new URL("../src/features/admin-console/admin-mascot-controller.js", import.meta.url), "utf8");
const commonTemplateSource = readFileSync(new URL("../src/features/admin-console/admin-character-editor-common-template.js", import.meta.url), "utf8");
const creatorTemplateSource = readFileSync(new URL("../src/features/admin-console/admin-character-editor-creator-template.js", import.meta.url), "utf8");
const mascotTemplateSource = readFileSync(new URL("../src/features/admin-console/admin-console-mascot-template.js", import.meta.url), "utf8");

assert.match(avatarControlsSource, /import \{ handleAvatarFile, openAvatarFilePicker \}/, "admin avatar upload should reuse shared avatar cropper file handler");
assert.match(avatarControlsSource, /openAvatarFilePicker\(fileInput\)/, "admin avatar upload button should open the shared file picker helper");
assert.match(avatarControlsSource, /handleAvatarFile\(event,\s*\{[\s\S]*onCropped:/, "admin avatar upload should wait for cropper result before upload");
assert.match(avatarControlsSource, /uploadCroppedAvatar/, "admin avatar upload should upload the cropped blob");
assert.doesNotMatch(avatarControlsSource, /compressImageFile/, "admin avatar upload should not bypass cropper by directly compressing source files");

assert.match(commonControllerSource, /bindAdminCharacterAvatarControls\(host\)/, "common character editor should bind shared avatar controls");
assert.match(creatorControllerSource, /bindAdminCharacterAvatarControls\(host\)/, "creator character editor should bind shared avatar controls");
assert.match(mascotControllerSource, /bindAdminCharacterAvatarControls\(host\)/, "mascot editor should bind shared avatar controls");

assert.match(commonTemplateSource, /data-character-avatar-upload/, "common character editor should render upload avatar button");
assert.match(creatorTemplateSource, /data-character-avatar-upload/, "creator character editor should render upload avatar button");
assert.match(mascotTemplateSource, /data-character-avatar-upload/, "mascot editor should render upload avatar button");

assert.match(commonTemplateSource, /data-character-avatar-generate/, "common character editor should keep AI avatar controls");
assert.match(creatorTemplateSource, /data-character-avatar-generate/, "creator character editor should keep AI avatar controls");
assert.match(mascotTemplateSource, /data-mascot-avatar-generate/, "mascot editor should keep AI avatar controls");

console.log("admin character avatar cropper self-check passed");
