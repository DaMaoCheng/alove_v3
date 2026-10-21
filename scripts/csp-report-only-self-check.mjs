import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const configSource = readFileSync("server/config.js", "utf8");
const securitySource = readFileSync("server/security-response-utils.js", "utf8");

assert.match(configSource, /cspReportOnlyEnabled: parseOptionalBoolean\(process\.env\.CSP_REPORT_ONLY_ENABLED, true\)/, "CSP report-only should be configurable and enabled by default");
assert.match(securitySource, /"Content-Security-Policy": cspEnforcedPolicy\(\)/, "enforced CSP should use the staged policy helper");
assert.match(securitySource, /"Content-Security-Policy-Report-Only": cspReportOnlyPolicy\(\)/, "report-only CSP header should be emitted separately");
assert.match(securitySource, /default-src 'self'/, "report-only policy should define default-src");
assert.match(securitySource, /style-src 'self' 'unsafe-inline' https:\/\/api\.fontshare\.com/, "report-only policy should allow existing Fontshare stylesheet and inline styles");
assert.match(securitySource, /font-src 'self' data: https:\/\/cdn\.fontshare\.com/, "report-only policy should allow Fontshare font files");
assert.match(securitySource, /img-src 'self' data: blob: https:/, "report-only policy should allow external product images during observation");
assert.match(securitySource, /media-src 'self' data: blob: https:/, "report-only policy should allow existing audio playback sources during observation");
assert.match(securitySource, /connect-src 'self' ws: wss:/, "report-only policy should allow same-origin HTTP and websocket calls");
assert.match(securitySource, /form-action 'self'/, "CSP policies should restrict form submissions");
assert.doesNotMatch(securitySource, /report-uri|report-to/i, "lowest-risk phase should not add a public CSP report ingestion endpoint");

console.log("CSP report-only self-check passed");
