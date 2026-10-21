import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const securitySource = readFileSync("server/security-response-utils.js", "utf8");

assert.match(securitySource, /"Content-Security-Policy": cspEnforcedPolicy\(\)/, "enforced CSP should use the staged policy helper");
assert.match(securitySource, /function cspEnforcedPolicy\(\)/, "staged enforced CSP policy should be isolated");
assert.match(securitySource, /base-uri 'self'/, "enforced CSP should lock base-uri");
assert.match(securitySource, /object-src 'none'/, "enforced CSP should block object/embed/plugin content");
assert.match(securitySource, /form-action 'self'/, "enforced CSP should restrict form submissions to same-origin");
assert.match(securitySource, /frame-ancestors 'self'/, "enforced CSP should keep frame ancestor protection");

const enforcedBody = securitySource.match(/function cspEnforcedPolicy\(\) \{[\s\S]*?\n\}/)?.[0] || "";
assert.doesNotMatch(enforcedBody, /script-src|style-src|img-src|media-src|connect-src|font-src|default-src/, "stage 1 should not enforce resource-loading directives yet");
assert.match(securitySource, /function cspReportOnlyPolicy\(\)/, "full resource policy should remain report-only");
assert.match(securitySource, /script-src 'self'/, "script-src should remain in report-only policy for observation");
assert.match(securitySource, /img-src 'self' data: blob: https:/, "external image allowance should remain report-only");
assert.doesNotMatch(securitySource, /report-uri|report-to/i, "this phase should not add a public CSP report ingestion endpoint");

console.log("CSP staged enforcement self-check passed");
