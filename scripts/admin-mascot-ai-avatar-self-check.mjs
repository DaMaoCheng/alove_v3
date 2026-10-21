import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const controllerSource = readFileSync(new URL("../src/features/admin-console/admin-mascot-controller.js", import.meta.url), "utf8");
const aiSource = readFileSync(new URL("../src/features/admin-console/admin-mascot-avatar-ai-controls.js", import.meta.url), "utf8");
const templateSource = readFileSync(new URL("../src/features/admin-console/admin-console-mascot-template.js", import.meta.url), "utf8");
const overlaySource = readFileSync(new URL("../src/features/app-shell/styles/overlays.css", import.meta.url), "utf8");

assert.match(templateSource, /data-mascot-avatar-generate/, "mascot editor should render AI avatar generation button");
assert.match(controllerSource, /bindAdminMascotAvatarAiControls\(host\)/, "mascot modal should bind AI avatar controls");
assert.match(aiSource, /openAvatarGenerationModal/, "mascot AI controls should reuse shared avatar generation modal");
assert.match(aiSource, /hostClassName: "admin-aigen-host"/, "mascot AI modal should use admin overlay z-index host");
assert.match(aiSource, /backstory: readFormValue\(form, "personaPrompt"\)/, "mascot AI prompt should use the current persona field");
assert.match(aiSource, /openingLine: readFormValue\(form, "greeting"\)/, "mascot AI prompt should use current greeting field");
assert.match(aiSource, /uploadAvatar/, "mascot generated avatar should upload through shared avatar pipeline");
assert.match(aiSource, /data-character-avatar-value/, "mascot generated avatar should write the existing avatar hidden field");
assert.match(overlaySource, /\.admin-aigen-host\{ z-index:10020 !important; \}/, "admin AI avatar modal should stay above admin editor modal");

console.log("admin mascot AI avatar self-check passed");
