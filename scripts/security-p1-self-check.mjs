import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const configSource = readFileSync("server/config.js", "utf8");
const cookieSource = readFileSync("server/cookie-utils.js", "utf8");
const responseSource = readFileSync("server/http-response-utils.js", "utf8");
const staticSource = readFileSync("server/static-file-service.js", "utf8");
const serverSource = readFileSync("server/server.js", "utf8");
const securitySource = readFileSync("server/security-response-utils.js", "utf8");

assert.match(configSource, /cookieSecure: parseOptionalBoolean\(process\.env\.COOKIE_SECURE, isHttpsUrl\(process\.env\.PUBLIC_BASE_URL\)\)/, "cookie secure should default on for HTTPS public base URL");
assert.match(configSource, /forceHttps: parseOptionalBoolean\(process\.env\.FORCE_HTTPS, isHttpsUrl\(process\.env\.PUBLIC_BASE_URL\)\)/, "force HTTPS should default on for HTTPS public base URL");
assert.match(configSource, /hstsEnabled: parseOptionalBoolean\(process\.env\.HSTS_ENABLED, isHttpsUrl\(process\.env\.PUBLIC_BASE_URL\)\)/, "HSTS should default on for HTTPS public base URL");
assert.match(cookieSource, /secureCookieAttribute\(\)/, "auth cookies should include the shared secure cookie helper");
assert.match(cookieSource, /SERVER_CONFIG\.security\.cookieSecure \? \["Secure"\] : \[\]/, "secure cookie helper should use configured production flag");
assert.match(responseSource, /securityHeaders\(\)/, "JSON and HTML responses should include security headers");
assert.match(staticSource, /securityHeaders\(\)/, "static responses should include security headers");
assert.match(serverSource, /shouldRedirectToHttps\(req\)/, "server should enforce HTTPS redirect before routes");
assert.match(serverSource, /buildHttpsRedirectUrl\(req\)/, "server should build HTTPS redirect URL from the request");
assert.match(securitySource, /Strict-Transport-Security/, "security headers should include HSTS when enabled");
assert.match(securitySource, /Referrer-Policy/, "security headers should include Referrer-Policy");
assert.match(securitySource, /Permissions-Policy/, "security headers should include Permissions-Policy");
assert.match(securitySource, /Content-Security-Policy/, "security headers should include a CSP frame policy");
assert.match(securitySource, /LOCAL_HOSTS/, "HTTPS redirect should skip local health checks and local development hosts");
assert.match(securitySource, /cf-visitor/, "HTTPS detection should understand Cloudflare visitor scheme");
assert.match(securitySource, /cf-ray/, "HTTPS detection should tolerate Cloudflare proxy requests without redirect loops");
assert.match(securitySource, /x-forwarded-ssl/, "HTTPS detection should support common proxy SSL headers");

console.log("security P1 self-check passed");
