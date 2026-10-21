import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createToken, hashSessionToken } from "../server/security.js";

const token = createToken();
const tokenHash = hashSessionToken(token);

assert.match(token, /^[a-f0-9]{64}$/, "session token should stay a raw random hex value for the cookie");
assert.match(tokenHash, /^sha256:[a-f0-9]{64}$/, "session token hash should be stored with a stable sha256 prefix");
assert.equal(hashSessionToken(token), tokenHash, "session token hash should be deterministic");
assert.equal(hashSessionToken(tokenHash), tokenHash, "already-hashed session tokens should stay unchanged");
assert.notEqual(tokenHash, token, "stored token hash must not equal the raw session token");

const securitySource = readSource("server/security.js");
const sessionSource = readSource("server/auth-session-service.js");
const googleSource = readSource("server/google-auth-service.js");
const requestUserSource = readSource("server/request-user-service.js");
const migrationSource = readSource("scripts/migrate-session-token-hashes.mjs");

assert.match(securitySource, /export function hashSessionToken/, "security service should expose session token hashing");
assert.match(sessionSource, /const tokenHash = hashSessionToken\(token\);/, "email sessions should hash token before persistence");
assert.match(sessionSource, /WHERE u\.auth_token = \?/, "session lookup should keep indexed auth_token equality");
assert.match(sessionSource, /\[tokenHash\]/, "session lookup should query by hashed token");
assert.match(googleSource, /issueUserSession/, "Google login should reuse central session issuing");
assert.doesNotMatch(googleSource, /UPDATE users SET auth_token = \?/, "Google login must not write raw auth_token directly");
assert.match(requestUserSource, /hashSessionToken\(token\)/, "optional request user lookup should query by hashed token");
assert.match(migrationSource, /auth_token NOT LIKE 'sha256:%'/, "migration should only rewrite legacy plaintext tokens");

console.log("session token hash self-check passed");

function readSource(pathname) {
  return readFileSync(new URL(`../${pathname}`, import.meta.url), "utf8");
}
