import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("src/app/chat-data-actions.js", "utf8");

assert.match(source, /let chatLoadRequestId = 0/, "chat message loading should keep a request sequence");
assert.match(source, /const requestId = chatLoadRequestId \+ 1/, "each chat load should allocate a fresh request id");
assert.match(source, /chatLoadRequestId = requestId/, "latest chat load request id should be stored");
assert.match(source, /isCurrentChatLoad\(requestId, normalizedId\)/, "chat load should ignore stale responses");
assert.match(source, /requestId === chatLoadRequestId/, "stale guard should compare request id");
assert.match(source, /String\(appState\.agent \|\| ""\)\.trim\(\) === characterId/, "stale guard should ensure the response still belongs to the selected character");
assert.match(source, /finally \{[\s\S]*if \(!isCurrentChatLoad\(requestId, normalizedId\)\) return;[\s\S]*appState\.chat\.loading = false/, "only the current chat load should clear loading and remount");

console.log("chat load stale request self-check passed");
