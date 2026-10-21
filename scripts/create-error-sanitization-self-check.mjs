import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const createActions = readFileSync(new URL("../src/app/character-create-actions.js", import.meta.url), "utf8");
const avatarActions = readFileSync(new URL("../src/app/character-avatar-actions.js", import.meta.url), "utf8");
const avatarModal = readFileSync(new URL("../src/features/create-character/create-avatar-generation-modal.js", import.meta.url), "utf8");

assert.match(createActions, /createSiteCopy\(appState\.site\?\.pageLanguage\)/, "create actions should resolve safe errors from the active site language");
assert.match(createActions, /raw_reason: error\.message/, "create actions should still log the raw error reason");
assert.match(createActions, /appState\.create\.error = copy\.t\("create\.failed"\)/, "create action should display a localized safe error instead of raw remote errors");
assert.match(createActions, /appState\.create\.polishError = copy\.t\("create\.failed"\)/, "polish action should display a localized safe error instead of raw remote errors");
assert.match(avatarActions, /createSiteCopy\(appState\?\.site\?\.pageLanguage\)/, "avatar actions should resolve safe errors from the active site language");
assert.match(avatarActions, /raw_reason: error\.message/, "avatar actions should still log raw avatar errors");
assert.match(avatarActions, /appState\.create\.avatarError = copy\(\)\.t\("create\.avatarGenericError"\)/, "avatar generation/upload should display localized safe errors");
assert.match(avatarModal, /AVATAR_GENERATION_GENERIC_ERROR_MESSAGE = "This feature is currently unavailable\. Please try again later\."/, "avatar modal should define a generic English error");
assert.match(avatarModal, /error: AVATAR_GENERATION_GENERIC_ERROR_MESSAGE/, "avatar modal default error copy should use the generic English error");
assert.match(avatarModal, /escapeHtml\(labels\.error\)/, "avatar modal should display sanitized scenario copy instead of raw model errors");
assert.doesNotMatch(avatarModal, /escapeHtml\(error\?\.message/, "avatar modal must not display raw remote errors");

console.log("Create error sanitization self-check passed");
