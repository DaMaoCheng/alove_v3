import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const registerSource = readFileSync("src/pages/auth/register-page.js", "utf8");
const copySource = readFileSync("src/i18n/site-copy.js", "utf8");

assert.match(registerSource, /data-auth-field-message="email"/, "register page should keep an email-specific error slot");
assert.match(registerSource, /data-auth-field-message="code"/, "register page should keep a verification-code-specific error slot");
assert.match(registerSource, /data-auth-field-message="password"/, "register page should keep a password-specific error slot");
assert.match(registerSource, /function validatePasswordPolicy/, "register page should validate password policy before submit");
assert.match(registerSource, /setFieldMessage\(root, "password", copy\.t\("auth\.passwordNeedsMixed"\)\)/, "password composition errors should use the active site language below the password input");
assert.match(copySource, /"auth\.passwordNeedsMixed": "Password must include letters and numbers\."/, "English password composition copy should remain available");
assert.match(registerSource, /resolveRegisterErrorField/, "server errors should be routed to the matching register field");
assert.match(registerSource, /input\.readOnly = true/, "invite links should lock the prefilled invite code field");
assert.match(registerSource, /input\.setAttribute\("aria-readonly", "true"\)/, "locked invite code field should expose readonly state");
assert.match(registerSource, /input\.classList\.add\("invite-code-locked"\)/, "locked invite code field should use readonly styling");
assert.doesNotMatch(registerSource, /setAuthMessage\(form, result\.error \|\| "Unable to create account\."\)/, "register submit errors should not all render in the first global message slot");

console.log("register field errors self-check passed");
