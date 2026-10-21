import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const mainPath = "src/app/main.js";
const mainUiPath = "src/app/app-main-ui-actions.js";
const callPath = "src/app/app-call-actions.js";
const createPath = "src/app/app-create-actions.js";

for (const path of [mainPath, mainUiPath, callPath, createPath]) {
  assert.ok(existsSync(path), `app split file should exist: ${path}`);
}

const mainSource = readFileSync(mainPath, "utf8");
const mainUiSource = readFileSync(mainUiPath, "utf8");
const callSource = readFileSync(callPath, "utf8");
const createSource = readFileSync(createPath, "utf8");

assert.match(mainSource, /createCallActions/, "main should wire call actions");
assert.match(mainSource, /createAppCreateActions/, "main should wire create actions");
assert.match(mainSource, /createMainUiActions/, "main should wire ui helper actions");
assert.doesNotMatch(mainSource, /function handleCallClientEvent/, "main should not own call client event handling");
assert.doesNotMatch(mainSource, /function mergeCallMessagesIntoCurrentChat/, "main should not own call message merging");
assert.doesNotMatch(mainSource, /function formatCallLatencyText/, "main should not own call latency formatting");
assert.doesNotMatch(mainSource, /function setCreateField/, "main should not own create field mutation");
assert.doesNotMatch(mainSource, /function handleCreateCharacterSubmit/, "main should not own create submit navigation");
assert.doesNotMatch(mainSource, /function openProfile/, "main should not own profile overlay actions");
assert.doesNotMatch(mainSource, /function closeProfile/, "main should not own profile overlay actions");
assert.doesNotMatch(mainSource, /function setSearchQuery/, "main should not own search helper actions");
assert.ok(mainSource.split(/\r?\n/).length <= 360, "main should be substantially smaller after call/create split");

assert.match(mainUiSource, /export function createMainUiActions/, "main ui module should export helper factory");
assert.match(mainUiSource, /updateProfileModal/, "main ui module should own profile overlay refresh");
assert.match(mainUiSource, /function setSearchQuery/, "main ui module should own search helper actions");
assert.match(mainUiSource, /function setAdminView/, "main ui module should own admin helper actions");

assert.match(callSource, /export function createCallActions/, "call module should export action factory");
assert.match(callSource, /RealtimeCallClient/, "call module should own realtime client creation");
assert.match(callSource, /handleCallClientEvent/, "call module should handle client events");
assert.match(callSource, /mergeChatMessages\(appState\.chat\.messages/, "call module should merge call messages into chat");
assert.match(callSource, /formatCallLatencyText/, "call module should format latency diagnostics");
assert.match(callSource, /call-live-dot/, "call module should render live call dot markup");
assert.match(callSource, /updateCallModalDom/, "call module should update existing call modal DOM");

assert.match(createSource, /export function createAppCreateActions/, "create module should export action factory");
assert.match(createSource, /setCreateField/, "create module should own create field mutation");
assert.match(createSource, /handleCreateCharacterSubmit/, "create module should own create submit navigation");
assert.match(createSource, /characterActions\.resetCreateDraftState\(\)/, "create module should reset draft after successful creation");

console.log("app main split self-check passed");
