import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const appStateSource = readFileSync("src/app/app-state.js", "utf8");
const authStateSource = readFileSync("src/app/app-auth-state.js", "utf8");
const appChatActionsSource = readFileSync("src/app/app-chat-actions.js", "utf8");
const appViewFactorySource = readFileSync("src/app/app-view-factory.js", "utf8");
const chatPageSource = readFileSync("src/features/chat/chat-page.js", "utf8");
const composerTemplateSource = readFileSync("src/features/chat/chat-composer-template.js", "utf8");
const composerSource = readFileSync("src/features/chat/chat-composer.js", "utf8");
const composerTextSource = readFileSync("src/features/chat/chat-composer-text.js", "utf8");

assert.match(appStateSource, /draftByCharacterId:\s*\{\}/, "chat state should track per-character composer drafts");
assert.match(authStateSource, /appState\.chat\.draftByCharacterId\s*=\s*\{\}/, "auth reset should clear chat drafts");
assert.match(appChatActionsSource, /function setChatDraft\(\{ characterId = "", text = "" \} = \{\}\)/, "chat actions should expose a draft setter");
assert.match(appChatActionsSource, /\[normalizedCharacterId\]: String\(text \|\| ""\)/, "draft setter should store text by character id");
assert.match(appViewFactorySource, /draftText:\s*appState\.chat\.draftByCharacterId\[appState\.agent\] \|\| ""/, "chat view should pass current character draft to the page");
assert.match(appViewFactorySource, /onDraftChange:\s*actions\.setChatDraft/, "chat view should pass draft change action");
assert.match(chatPageSource, /draftText = ""/, "chat page should accept draft text");
assert.match(chatPageSource, /composerHtml\(currentCharacter\.name,[\s\S]*draftText/, "chat page should render draft text into composer");
assert.match(chatPageSource, /onDraftChange:\s*\(text\) => onDraftChange\?\.\(\{ characterId: currentCharacter\.id, text \}\)/, "chat page should bind draft changes to current character");
assert.match(composerTemplateSource, /value="\$\{escapeAttr\(draftText\)\}"/, "composer input should restore draft value after remount");
assert.match(composerSource, /onDraftChange/, "composer binder should pass draft callback to text input");
assert.match(composerTextSource, /onDraftChange\?\.\(String\(event\.target\?\.value \|\| ""\)\)/, "input event should persist current draft");
assert.match(composerTextSource, /onDraftChange\?\.\(""\)/, "successful local send should clear draft");

console.log("chat composer draft preserve self-check passed");
