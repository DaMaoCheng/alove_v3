import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const authServiceSource = readSource("server/auth-service.js");
const authLoginThrottleSource = readSource("server/auth-login-throttle-service.js");
const googleAuthSource = readSource("server/google-auth-service.js");
const authRoutesSource = readSource("server/auth-routes.js");
const sessionActionsSource = readSource("src/app/app-session-actions.js");
const appMainSource = readSource("src/app/main.js");

for (const [label, source] of [
  ["server/auth-service.js", authServiceSource],
  ["server/auth-login-throttle-service.js", authLoginThrottleSource],
  ["server/google-auth-service.js", googleAuthSource],
  ["server/auth-routes.js", authRoutesSource],
]) {
  assert.equal(hasCjkText(source), false, `${label} should not expose Chinese auth errors to auth pages`);
}

assert.match(
  googleAuthSource,
  /activateRegistrationMascotForDb/,
  "Google-created users should activate the same registration mascot as email registration"
);
assert.match(
  googleAuthSource,
  /resolveRegistrationSite/,
  "Google-created users should resolve and store the current site like email registration"
);
assert.match(
  googleAuthSource,
  /isNewUser/,
  "Google callback should return whether the OAuth login created a new account"
);
assert.match(
  authRoutesSource,
  /siteSlug/,
  "Google OAuth routes should preserve the current site slug through callback"
);
assert.match(
  authRoutesSource,
  /buildGoogleAuthSuccessPath\(result\.authResponse, siteSlug\)/,
  "Google callback should route successful OAuth users into the app instead of the login page"
);
assert.doesNotMatch(
  authRoutesSource,
  /redirect\(res,\s*`\/\$\{siteSlug\}\/login`\)/,
  "Google callback must not send successful users back to the login page"
);
assert.match(
  authRoutesSource,
  /\/\$\{safeSiteSlug\}\/chat\?agent=\$\{encodeURIComponent\(characterId\)\}/,
  "Google success route should enter the resolved site chat when a landing character exists"
);
assert.match(
  googleAuthSource,
  /landingCharacterId/,
  "Google login result should include the landing character for direct app entry"
);
assert.match(
  googleAuthSource,
  /guestClaim\?\.claimed\s*\?\s*guestClaim\.characterId/,
  "Google guest claim should land on the claimed mascot even when another activation is newer"
);
assert.match(
  appMainSource,
  /const initialAuthNotice = new URL\(window\.location\.href\)\.searchParams\.get\("authNotice"\)/,
  "Google cross-site notice should be captured before authenticated route restoration rewrites the URL"
);
assert.match(
  appMainSource,
  /if \(sessionResult\?\.authenticated\) showAuthNoticeFromLocation\(\)/,
  "captured Google auth notice should render only after session recovery"
);
assert.match(
  authLoginThrottleSource,
  /LOGIN_ERROR_MESSAGE\s*=\s*"Invalid email or password\."/,
  "Email login failures should use one generic message"
);
assert.doesNotMatch(
  `${authServiceSource}\n${authLoginThrottleSource}`,
  /Account not found\.|Incorrect password\.|Email and password are required\./,
  "Email login should not expose account enumeration messages"
);
assert.match(
  authLoginThrottleSource,
  /LOGIN_EMAIL_FAILURE_LIMIT/,
  "Email login should include per-account brute-force throttling"
);
assert.match(
  authLoginThrottleSource,
  /LOGIN_IP_FAILURE_LIMIT/,
  "Email login should include per-IP brute-force throttling"
);
assert.match(
  authRoutesSource,
  /requestIp:\s*getRequestIp\(req\)/,
  "Login route should pass request IP into login throttling"
);

assert.match(
  sessionActionsSource,
  /routeAfterAuthSuccess/,
  "Auth success should route existing users to last chat and new users to mascot chat"
);
assert.match(
  sessionActionsSource,
  /await routeAfterAuthSuccess\(\{\s*isNewUser: false,/,
  "Email login should route through auth landing instead of hard-coding discover"
);
assert.match(
  sessionActionsSource,
  /await routeAfterAuthSuccess\(\{\s*isNewUser: true,/,
  "Email registration should route new users through mascot chat landing"
);
assert.match(
  sessionActionsSource,
  /if \(requiresAuth\(routeView\)\) \{/,
  "Existing sessions opened on protected deep links should restore the requested route before auth landing fallback"
);
assert.match(
  sessionActionsSource,
  /const authorizedView = restoreAuthorizedRoute\(\{ replace: true \}\);/,
  "Existing sessions should keep authorized admin and other protected deep links"
);

console.log("auth login flow self-check passed");

function readSource(pathname) {
  return readFileSync(new URL(`../${pathname}`, import.meta.url), "utf8");
}

function hasCjkText(source) {
  const userFacingStrings = [...source.matchAll(/(?:new Error|throwUserError)\(\s*(["'`])([\s\S]*?)\1\s*\)/g)].map((match) => match[2]);
  return userFacingStrings.some((text) => /[\u3400-\u9fff]/.test(text));
}
