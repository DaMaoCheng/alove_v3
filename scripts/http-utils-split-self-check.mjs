import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const facade = readSource("server/http-utils.js");
const requestUtils = readSource("server/http-request-utils.js");
const responseUtils = readSource("server/http-response-utils.js");
const cookieUtils = readSource("server/cookie-utils.js");
const staticService = readSource("server/static-file-service.js");

assert.ok(
  lineCount(facade) <= 20,
  "http-utils.js should stay a thin compatibility facade"
);
assert.match(facade, /from "\.\/http-request-utils\.js"/, "http-utils facade should export request helpers");
assert.match(facade, /from "\.\/http-response-utils\.js"/, "http-utils facade should export response helpers");
assert.match(facade, /from "\.\/cookie-utils\.js"/, "http-utils facade should export cookie helpers");
assert.match(facade, /from "\.\/static-file-service\.js"/, "http-utils facade should export static serving");

assert.match(requestUtils, /export async function readJson/, "request utils should own JSON body parsing");
assert.match(requestUtils, /export async function readRequestBuffer/, "request utils should own raw body buffers");
assert.match(requestUtils, /export function getRequestIp/, "request utils should own request IP extraction");

assert.match(responseUtils, /export function sendJson/, "response utils should own JSON responses");
assert.match(responseUtils, /export function sendError/, "response utils should own API error shaping");
assert.match(responseUtils, /Request failed\. Please try again later\./, "5xx errors should stay sanitized");
assert.match(responseUtils, /statusCode < 500/, "4xx user-facing errors should stay visible");

assert.match(cookieUtils, /export function setAuthCookie/, "cookie utils should own auth cookie writes");
assert.match(cookieUtils, /HttpOnly/, "auth cookies should stay HttpOnly");
assert.match(cookieUtils, /export function readAuthToken/, "cookie utils should own auth token reads");

assert.match(staticService, /const PUBLIC_STATIC_PREFIXES/, "static service should own public static prefixes");
assert.match(staticService, /"shared\/"/, "shared runtime modules should remain explicitly public until a build step replaces them");
assert.doesNotMatch(
  blockedStaticPrefixes(staticService),
  /"shared\/"/,
  "shared should not appear in both public and blocked static prefix lists"
);
assert.match(blockedStaticPrefixes(staticService), /"server\/"/, "server source should remain blocked from static serving");
assert.match(blockedStaticPrefixes(staticService), /"docs\/"/, "docs should remain blocked from static serving");
assert.match(blockedStaticPrefixes(staticService), /"logs\/"/, "logs should remain blocked from static serving");
assert.match(staticService, /hasHiddenPathSegment/, "hidden path segments should stay blocked");
assert.match(staticService, /shouldServeAppShell/, "SPA fallback should remain explicit");

console.log("http utils split self-check passed");

function readSource(pathname) {
  return readFileSync(new URL(`../${pathname}`, import.meta.url), "utf8");
}

function lineCount(source) {
  return source.split("\n").length;
}

function blockedStaticPrefixes(source) {
  const match = source.match(/const BLOCKED_STATIC_PREFIXES = Object\.freeze\(\[([\s\S]*?)\]\);/);
  return match?.[1] || "";
}
