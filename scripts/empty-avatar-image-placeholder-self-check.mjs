import assert from "node:assert/strict";
import { characterAvatarHtml } from "../src/features/shared-ui/character-avatar.js";
import { adminCharacterEditorHtml } from "../src/features/admin-console/admin-character-editor-template.js";
import { mascotEditorModalHtml } from "../src/features/admin-console/admin-console-mascot-template.js";
import { createCharacterPageHtml } from "../src/features/create-character/create-character-template.js";

const directPlaceholder = characterAvatarHtml({ placeholder: "image", className: "test-avatar" });
assert.match(directPlaceholder, /avatar-image-placeholder/, "shared avatar helper should support image icon placeholder");
assert.match(directPlaceholder, /<svg viewBox="0 0 24 24"/, "image placeholder should reuse the shared image icon svg");
assert.doesNotMatch(directPlaceholder, /letter-avatar/, "image placeholder should not render a letter avatar");

const createPageHtml = createCharacterPageHtml({
  createState: { name: "", avatarUrl: "", avatarPreviewUrl: "", cat: "Companion", vibe: "Calm mentor", voice: "Warm & friendly" },
  category: { label: "Companion" },
  user: {},
});
assert.match(createPageHtml, /cf-avatar-visual avatar-image-placeholder/, "create character page should show image icon for empty avatar");
assert.doesNotMatch(createPageHtml, /cf-avatar-visual letter-avatar/, "create character page empty avatar should not show first-letter fallback");

const commonCreateHtml = adminCharacterEditorHtml({
  mode: "common",
  title: "新建通用角色",
  isCreate: true,
  character: { name: "", avatarUrl: "", categoryId: "companion", visibility: "private", status: "published" },
});
assert.match(commonCreateHtml, /cf-avatar[^>]*data-character-avatar-preview[^>]*data-character-avatar-placeholder="image"/, "new common character modal should mark avatar preview as image placeholder mode");
assert.match(commonCreateHtml, /avatar-image-placeholder/, "new common character modal should show image icon for empty avatar");
assert.doesNotMatch(commonCreateHtml, /letter-avatar/, "new common character modal empty avatar should not show first-letter fallback");

const mascotCreateHtml = mascotEditorModalHtml({ mode: "site-new", mascot: {}, sites: [], knowledgeBases: [] });
assert.match(mascotCreateHtml, /agent-avatar-preview[^>]*data-character-avatar-placeholder="image"/, "new front desk modal should mark avatar preview as image placeholder mode");
assert.match(mascotCreateHtml, /avatar-image-placeholder/, "new front desk modal should show image icon for empty avatar");
assert.doesNotMatch(mascotCreateHtml, /letter-avatar/, "new front desk modal empty avatar should not show first-letter fallback");

console.log("empty avatar image placeholder self-check passed");
