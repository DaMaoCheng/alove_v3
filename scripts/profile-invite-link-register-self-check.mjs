import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getInitialViewFromPath, requiresAuth } from "../src/app/access-control.js";

const profileModalSource = readFileSync("src/features/profile-modal/profile-modal-content.js", "utf8");
const registerSource = readFileSync("src/pages/auth/register-page.js", "utf8");
const authCss = readFileSync("src/features/app-shell/styles/auth.css", "utf8");
const authServiceSource = readFileSync("src/services/auth-service.js", "utf8");

assert.match(profileModalSource, /function buildInviteLink/, "profile modal should build invite links in one place");
assert.match(profileModalSource, /window\.location\.origin/, "copied invite links should include protocol and host");
assert.match(profileModalSource, /return `\$\{getInviteOrigin\(\)\}\$\{fullPath\}`;/, "copied invite links should be absolute URLs");
assert.match(profileModalSource, /\/\$\{encodeURIComponent\(slug\)\}\/register/, "copied invite links should target the register page");
assert.match(profileModalSource, /\?invite=\$\{encodeURIComponent\(inviteCode\)\}/, "copied invite links should carry the invite code query");
assert.match(profileModalSource, /data-copy-invite-link data-invite-link="\$\{escapeAttr\(inviteLink\)\}"/, "copy link button should copy the full invite link");

assert.match(registerSource, /params\.get\("invite"\) \|\| params\.get\("inviteCode"\)/, "register page should read invite code query params");
assert.match(registerSource, /input\.value = code;/, "register page should prefill the invite code field");
assert.match(registerSource, /input\.readOnly = true;/, "prefilled invite code should be locked");
assert.match(registerSource, /input\.setAttribute\("aria-readonly", "true"\)/, "prefilled invite code should expose readonly state");
assert.match(registerSource, /input\.classList\.add\("invite-code-locked"\)/, "prefilled invite code should get readonly styling");
assert.match(authCss, /\.field input\[readonly\]\.invite-code-locked/, "locked invite code should have auth form readonly styling");
assert.match(authServiceSource, /getCurrentUser\(\)[\s\S]*notifyUnauthorized: false/, "auth hydration should not force public register links back to login on 401");
assert.equal(getInitialViewFromPath("/footballkituk/register"), "register", "site invite link should open the register view");
assert.equal(getInitialViewFromPath("/footballkituk/register?invite=AIOVE-TEST"), "register", "site invite link query should not change register routing");
assert.equal(requiresAuth("register"), false, "register page should be reachable before login");

console.log("profile invite link register self-check passed");
