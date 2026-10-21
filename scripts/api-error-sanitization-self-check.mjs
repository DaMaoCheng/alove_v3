import assert from "node:assert/strict";
import { sendError } from "../server/http-utils.js";
import { createPublicError } from "../server/public-error-utils.js";

const internal = captureSendError(new Error("ER_BAD_FIELD_ERROR: SELECT password_hash FROM users"));
assert.equal(internal.statusCode, 500, "unknown errors should default to HTTP 500");
assert.equal(internal.payload.error, "Request failed. Please try again later.", "unknown errors should not expose raw internals");
assert.doesNotMatch(internal.body, /SELECT|password_hash|ER_BAD_FIELD/i, "raw internal error text must not be returned");

const upstream = new Error("Shopify Admin API HTTP 401: token shpat_secret");
upstream.statusCode = 502;
const upstreamResult = captureSendError(upstream);
assert.equal(upstreamResult.statusCode, 502, "5xx upstream errors should keep their status");
assert.equal(upstreamResult.payload.error, "Request failed. Please try again later.", "5xx upstream errors should be sanitized");
assert.doesNotMatch(upstreamResult.body, /shpat|Shopify Admin API HTTP 401/i, "5xx upstream details must not be returned");

const userError = new Error("Invalid email or password.");
userError.statusCode = 401;
const userResult = captureSendError(userError);
assert.equal(userResult.statusCode, 401, "4xx user errors should keep their status");
assert.equal(userResult.payload.error, "Please sign in first.", "unmarked 4xx errors should use safe default messages");
assert.equal(userResult.payload.code, "AUTH_REQUIRED", "unmarked 401 should return a safe public code");

const unsafeBadRequest = new Error("ER_BAD_FIELD_ERROR: SELECT password_hash FROM users");
unsafeBadRequest.statusCode = 400;
const unsafeBadRequestResult = captureSendError(unsafeBadRequest);
assert.equal(unsafeBadRequestResult.statusCode, 400, "4xx errors should keep their status");
assert.equal(unsafeBadRequestResult.payload.error, "Invalid request.", "unmarked 4xx errors should be sanitized");
assert.equal(unsafeBadRequestResult.payload.code, "INVALID_REQUEST", "unmarked 400 should return a safe public code");
assert.doesNotMatch(unsafeBadRequestResult.body, /SELECT|password_hash|ER_BAD_FIELD/i, "unmarked 4xx internals must not be returned");

const throttle = createPublicError("Too many sign-in attempts. Please try again later.", 429, "login_throttled");
const throttleResult = captureSendError(throttle);
assert.equal(throttleResult.statusCode, 429, "429 throttle errors should keep their status");
assert.equal(throttleResult.payload.error, "Too many sign-in attempts. Please try again later.", "marked public errors should keep user-facing messages");
assert.equal(throttleResult.payload.code, "LOGIN_THROTTLED", "marked public errors should expose sanitized public codes");

const ttmallUnavailable = createPublicError("TTMall is temporarily unavailable. Please try again later.", 503, "TTMALL_ACCOUNT_UPSTREAM_UNAVAILABLE");
const ttmallUnavailableResult = captureSendError(ttmallUnavailable);
assert.equal(ttmallUnavailableResult.statusCode, 503, "controlled TTMall upstream errors should keep their status");
assert.equal(ttmallUnavailableResult.payload.error, "TTMall is temporarily unavailable. Please try again later.", "controlled TTMall failures should retain their safe recovery message");
assert.equal(ttmallUnavailableResult.payload.code, "TTMALL_ACCOUNT_UPSTREAM_UNAVAILABLE", "controlled TTMall failures should retain their safe public code");

console.log("api error sanitization self-check passed");

function captureSendError(error) {
  const response = {
    statusCode: 0,
    headers: {},
    body: "",
    writeHead(statusCode, headers = {}) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    end(body = "") {
      this.body = String(body || "");
    },
  };
  sendError(response, error);
  return {
    statusCode: response.statusCode,
    headers: response.headers,
    body: response.body,
    payload: JSON.parse(response.body),
  };
}
