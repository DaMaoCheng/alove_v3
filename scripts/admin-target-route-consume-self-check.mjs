import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [actions, viewFactory, consolePage, accountsController, navigation] = await Promise.all([
  readFile(new URL("../src/app/app-main-ui-actions.js", import.meta.url), "utf8"),
  readFile(new URL("../src/app/app-view-factory.js", import.meta.url), "utf8"),
  readFile(new URL("../src/features/admin-console/admin-console-page.js", import.meta.url), "utf8"),
  readFile(new URL("../src/features/admin-console/admin-accounts-controller.js", import.meta.url), "utf8"),
  readFile(new URL("../src/app/main.js", import.meta.url), "utf8"),
]);

assert.match(accountsController, /onTargetConsumed = null/, "accounts controller should accept a target-consumed callback");
assert.match(accountsController, /if \(requestedGuestSessionId\) \{\s*requestedGuestSessionId = "";\s*onTargetConsumed/, "guest target is consumed after loading");
assert.match(navigation, /consumeAdminTarget: mainUiActions.consumeAdminTarget/, "callback must be connected to application actions");
assert.match(consolePage, /onTargetConsumed,? onBack/, "admin page should forward the target-consumed callback");
assert.match(viewFactory, /onTargetConsumed: actions\.consumeAdminTarget/, "admin view should provide the target-consumed action");
assert.match(actions, /function consumeAdminTarget\(\)/, "main actions should clear the in-memory target");
assert.match(actions, /pushAdminPath\(true\)/, "target consumption should replace the URL");
assert.match(navigation, /pushAdminPath: \(replace = false\) => pushViewPath\(appState, "admin", replace\)/, "admin path action should support replaceState");

console.log("admin target route consume self-check passed");
