import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const authService = readSource("server/auth-service.js");
const throttleService = readSource("server/auth-login-throttle-service.js");
const sessionService = readSource("server/auth-session-service.js");
const emailCodeService = readSource("server/email-code-service.js");
const registrationSiteService = readSource("server/registration-site-service.js");

assert.ok(
  lineCount(authService) <= 180,
  "auth-service.js should stay as a thin auth facade instead of growing back into the all-in-one module"
);
assert.match(authService, /from "\.\/auth-login-throttle-service\.js"/, "auth-service should delegate login throttling");
assert.match(authService, /from "\.\/auth-session-service\.js"/, "auth-service should delegate session reads and writes");
assert.match(authService, /from "\.\/email-code-service\.js"/, "auth-service should delegate email code handling");
assert.match(authService, /from "\.\/registration-site-service\.js"/, "auth-service should delegate registration site and invite rules");

assert.match(throttleService, /LOGIN_EMAIL_FAILURE_LIMIT/, "login throttle service should own email failure limits");
assert.match(throttleService, /LOGIN_IP_FAILURE_LIMIT/, "login throttle service should own IP failure limits");
assert.doesNotMatch(authService, /loginFailureBuckets/, "auth-service should not own login throttle buckets");

assert.match(sessionService, /export async function requireAuth/, "session service should own requireAuth");
assert.match(sessionService, /export async function getCurrentUser/, "session service should own current-user payloads");
assert.doesNotMatch(authService, /WHERE u\.auth_token = \?/, "auth-service should not own session token SQL");

assert.match(emailCodeService, /export async function sendEmailCode/, "email code service should own sending verification codes");
assert.match(emailCodeService, /export async function consumeEmailCode/, "email code service should own consuming verification codes");
assert.doesNotMatch(authService, /email_verification_codes/, "auth-service should not own email verification SQL");

assert.match(registrationSiteService, /export async function resolveRegistrationSite/, "registration site service should own site resolution");
assert.match(registrationSiteService, /export async function resolveReferralInvite/, "registration site service should own invite validation");

console.log("auth service split self-check passed");

function readSource(pathname) {
  return readFileSync(new URL(`../${pathname}`, import.meta.url), "utf8");
}

function lineCount(source) {
  return source.split("\n").length;
}
