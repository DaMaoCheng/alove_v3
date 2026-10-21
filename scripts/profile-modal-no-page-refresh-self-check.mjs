import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const mainSource = readFileSync("src/app/main.js", "utf8");
const mainUiActionsSource = readFileSync("src/app/app-main-ui-actions.js", "utf8");
const actionsSource = readFileSync("src/app/app-profile-actions.js", "utf8");
const modalContentSource = readFileSync("src/features/profile-modal/profile-modal-content.js", "utf8");
const modalEventsSource = readFileSync("src/features/profile-modal/profile-modal-events.js", "utf8");
const modalSource = readFileSync("src/features/profile-modal/profile-modal.js", "utf8");
const sidebarSource = readFileSync("src/features/app-shell/app-sidebar.js", "utf8");
const profileModalCss = readFileSync("src/features/app-shell/styles/profile-modal.css", "utf8");
const setProfileTabSource = extractFunction(mainUiActionsSource, "setProfileTab");

assert.match(mainUiActionsSource, /profileActions\.loadProfile\(\{\s*silent:\s*true\s*\}\)/, "opening profile should not immediately remount the whole shell just to enter loading state");
assert.match(mainUiActionsSource, /function normalizeProfileTab\(tab\)[\s\S]*tab === "invite" \? "invite"/, "profile tab normalization should allow invite tab");
assert.match(mainUiActionsSource, /import \{ updateProfileModal \} from "\.\.\/features\/profile-modal\/profile-modal\.js"/, "main UI actions should update an existing profile modal instead of recreating it");
assert.doesNotMatch(setProfileTabSource, /renderProfileOverlay\(\);/, "profile tab switching should not rerender the modal");
assert.doesNotMatch(setProfileTabSource, /mountApp\(\);/, "profile tab switching should not remount the whole app shell");
assert.match(mainUiActionsSource, /function mountProfileAware\(\)/, "profile data refresh should use an overlay-aware mount path");
assert.match(mainUiActionsSource, /appState\.profile\.open && renderProfileOverlay\(appState\)/, "profile data refresh should update the modal in place when it is open");
assert.doesNotMatch(mainUiActionsSource, /currentHost\.replaceWith/, "profile overlay updates should not replace the modal host");
assert.match(mainUiActionsSource, /return updateProfileModal\(currentHost, \{/, "profile data refresh should update the existing modal host");
assert.match(actionsSource, /loadProfile\(\{\s*force = false,\s*silent = false\s*\} = \{\}\)/, "profile loading should support silent mode");
assert.match(actionsSource, /if \(!silent\) mountApp\(\)/, "silent profile loading should skip the loading-state remount");

assert.match(modalContentSource, /class="pm-close" type="button"/, "profile close button should not submit or navigate");
assert.match(modalContentSource, /<button class="pm-tab \$\{activeTab === key \? "active" : ""\}" type="button" data-profile-tab="\$\{key\}"/, "profile tabs should be plain buttons");
assert.match(modalContentSource, /data-profile-panel="profile"/, "profile tab panel should be present in the modal body");
assert.match(modalContentSource, /data-profile-panel="invite"/, "invite tab panel should be present in the modal body");
assert.match(modalContentSource, /class="ivc-copy" type="button" data-copy-invite-code/, "invite code copy button should be a plain button");
assert.match(modalContentSource, /Copy code/, "invite card should copy only the invite code");
assert.match(modalContentSource, /class="share-btn" type="button" data-copy-invite-link/, "invite link copy button should be a plain button");
assert.match(modalContentSource, /Copy link/, "invite share action should copy the invite link");
assert.match(modalContentSource, /window\.location\.origin/, "invite copied link should include the current full origin");
assert.match(modalContentSource, /\$\{getInviteOrigin\(\)\}\$\{fullPath\}/, "invite copied link should be a full URL, not a relative path");
assert.match(modalContentSource, /class="share-btn ghost is-disabled" type="button" disabled aria-disabled="true"/, "invite email button should be disabled until email sharing exists");
assert.match(modalContentSource, /class="pm-admin-link" type="button" data-profile-nav/, "profile nav buttons should be plain buttons");
assert.match(modalContentSource, /class="pm-admin-link pm-logout-link" type="button" data-profile-logout/, "profile logout should be a plain button");

assert.match(modalSource, /export function updateProfileModal/, "profile modal should expose an in-place update helper");
assert.match(modalSource, /body\.innerHTML = profileModalBodyHtml/, "profile data refresh should only replace the modal body content");
assert.doesNotMatch(modalSource, /\.replaceWith\(/, "profile modal helper should not replace the modal host");
assert.ok((modalEventsSource.match(/event\.preventDefault\(\)/g) || []).length >= 6, "profile modal click actions should prevent default browser actions");
assert.ok((modalEventsSource.match(/event\.stopPropagation\(\)/g) || []).length >= 6, "profile modal click actions should stay inside the modal");
assert.match(modalEventsSource, /data-copy-invite-code/, "profile modal should handle invite code copy separately");
assert.match(modalEventsSource, /data-copy-invite-link/, "profile modal should handle invite link copy separately");
assert.match(modalEventsSource, /copyInviteValue/, "profile modal should use a shared clipboard helper for invite copy actions");
assert.match(modalEventsSource, /applyProfileTab\(root, nextTab\)/, "tab clicks should switch panels locally before updating app state");
assert.match(modalEventsSource, /panel\.hidden = panel\.dataset\.profilePanel !== tab/, "tab switching should use hidden panels instead of remounting");
assert.match(sidebarSource, /<button class="user-tile" type="button"/, "sidebar profile opener should not submit or navigate");
assert.match(sidebarSource, /item\.addEventListener\("click", \(event\) => \{[\s\S]*event\.preventDefault\(\)/, "sidebar navigation links should prevent default anchor navigation");
assert.match(sidebarSource, /\.user-tile"\)\?\.addEventListener\("click", \(event\) => \{[\s\S]*event\.preventDefault\(\)/, "sidebar profile opener should prevent default browser actions");
assert.match(profileModalCss, /\.share-btn\.is-disabled,[\s\S]*\.share-btn:disabled/, "disabled invite email button should have a disabled style");
assert.match(profileModalCss, /pointer-events:\s*none/, "disabled invite email button should be non-interactive");

console.log("profile modal no page refresh self-check passed");

function extractFunction(source, name) {
  const pattern = new RegExp(`function ${name}\\([^)]*\\) \\{`);
  const match = source.match(pattern);
  assert.ok(match, `${name} function should exist`);
  const start = match.index;
  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  assert.fail(`${name} function should be parseable`);
}
