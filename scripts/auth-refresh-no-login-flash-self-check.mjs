import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const mainSource = readFileSync("src/app/main.js", "utf8");
const navigationSource = readFileSync("src/app/app-navigation.js", "utf8");

assert.match(mainSource, /document\.body\.dataset\.view = "boot"/, "startup should enter boot view before auth verification");
assert.match(mainSource, /app\.replaceChildren\(createAppBootScreen\(\)\)/, "startup should render the boot screen before route hydration");
assert.match(mainSource, /await sessionActions\.hydrateExistingSession\(\)/, "startup should verify the persisted session before mounting the final view");
assert.ok(
  mainSource.indexOf("app.replaceChildren(createAppBootScreen())") < mainSource.indexOf("await sessionActions.hydrateExistingSession()"),
  "boot screen should be rendered before session verification",
);
assert.doesNotMatch(
  navigationSource,
  /if \(requiresAuth\(initialView\)\) \{\s*return "login";\s*\}/,
  "protected refresh routes should not unconditionally fall back to login while a stored session is being verified",
);
assert.match(
  navigationSource,
  /requiresAuth\(initialView\)[\s\S]*appState\.session\.authenticated \|\| canUseGuestView\(appState, initialView\) \? resolveViewForSession\(appState, initialView\) : "login"/,
  "protected refresh routes should preserve the requested app view for a stored session or an enabled guest view",
);

console.log("auth refresh no-login-flash self-check passed");
