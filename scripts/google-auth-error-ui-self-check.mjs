import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const authRoutes = readFileSync(new URL("../server/auth-routes.js", import.meta.url), "utf8");
const googleAuthService = readFileSync(new URL("../server/google-auth-service.js", import.meta.url), "utf8");

assert.match(authRoutes, /path === "\/api\/auth\/google\/callback"/, "Google callback route should exist");
assert.match(authRoutes, /title: copy\.t\("auth\.googleFailedTitle"\)/, "Google callback failures should use the site-language copy contract");
assert.match(authRoutes, /message: copy\.t\("auth\.googleTemporaryBody"\)/, "Google callback must not expose raw provider errors");
assert.match(authRoutes, /resolveGooglePageCopy\(siteSlug\)/, "Google callback should resolve the trusted site language");
assert.match(authRoutes, /clearGoogleOAuthCookies\(res\)/, "Google callback should clear temporary OAuth cookies on completion or failure");
assert.doesNotMatch(authRoutes, /Google sign-in expired\. Please try again\."[\s\S]{0,120}throw error/, "Expired Google callback should not bubble to JSON error handling");
assert.match(authRoutes, /href="\/\$\{safeSiteSlug\}\/login"/, "Google error page should link back to the current site login page");
assert.match(authRoutes, /copy\.t\("auth\.backToSignIn"\)/, "Google error page action should be localized");

assert.match(googleAuthService, /async function fetchGoogle\(url, options\)/, "Google fetch calls should go through a wrapper");
assert.match(googleAuthService, /Google sign-in is temporarily unavailable\. Please try again later\./, "Google network failures should use friendly English copy");
assert.match(googleAuthService, /error\.cause = cause/, "Google network wrapper should preserve the original error as cause");
assert.doesNotMatch(googleAuthService, /const response = await fetch\(GOOGLE_/, "Google API calls should not use raw fetch directly");

console.log("Google auth error UI self-check passed");
