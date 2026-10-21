import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const modalSource = readFileSync(new URL("../src/features/create-character/create-avatar-generation-modal.js", import.meta.url), "utf8");
const styleSource = readFileSync(new URL("../src/features/app-shell/styles/create-character.css", import.meta.url), "utf8");

assert.match(modalSource, /manualPrompt: "Custom prompt"/, "default copy should include concise manual prompt button text");
assert.match(modalSource, /useBackstory: "Use story"/, "default copy should include concise backstory generation button text");
assert.match(modalSource, /usePrompt: "Generate"/, "default copy should include concise manual prompt generation text");
assert.match(modalSource, /data-aigen-manual/, "avatar modal should render a manual prompt toggle button");
assert.match(modalSource, /data-aigen-prompt-wrap/, "avatar modal should wrap manual prompt field for show-hide behavior");
assert.match(modalSource, /body\.dataset\.aigenMode = "backstory"/, "avatar modal should start in backstory mode when backstory exists");
assert.match(modalSource, /body\.dataset\.aigenMode = "manual"/, "avatar modal should support manual prompt mode");
assert.match(modalSource, /setAvatarGenerationMode/, "avatar modal should switch between backstory and manual modes without remounting");
assert.match(modalSource, /sourceBackstory = mode === "manual" \? manualPrompt : backstory/, "generation payload should use manual prompt only in manual mode");
assert.match(modalSource, /if \(mode === "manual" && !manualPrompt\)/, "manual mode should require a prompt before generation");
assert.match(modalSource, /data-aigen-retry/, "avatar failure state should render a retry button");
assert.match(modalSource, /ICONS\.refresh/, "avatar failure retry button should reuse the refresh icon");
assert.match(modalSource, /retryPrompt: latestPrompt/, "avatar generation retry should preserve the latest manual prompt");
assert.match(modalSource, /retryMode: mode/, "avatar generation retry should return to the pre-generation mode");
assert.match(modalSource, /onRetryPrompt\?\.\(retryPrompt, retryMode\)/, "avatar failure retry should return to the generation setup without auto-submitting");

assert.match(styleSource, /\.aigen-actions/, "avatar modal should style a two-button action row");
assert.match(styleSource, /\.aigen-manual/, "manual prompt button should have a subdued style");
assert.match(styleSource, /\.aigen-prompt-wrap\[hidden\]/, "manual prompt wrapper should hide cleanly when not active");
assert.match(styleSource, /\.aigen-actions\.has-retry/, "avatar failure retry row should reserve a circular retry button column");
assert.match(styleSource, /\.aigen-retry/, "avatar failure retry button should have a circular style");

console.log("avatar generation manual prompt UI self-check passed");
