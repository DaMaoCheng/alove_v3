import assert from "node:assert/strict";

import { buildApiRouteErrorLog } from "../server/routes.js";

const context = { path: "/api/example" };
const requestUrl = new URL("http://127.0.0.1:4173/api/example");
const req = { method: "GET", headers: {}, socket: { remoteAddress: "127.0.0.1" } };

for (const statusCode of [400, 401, 403, 404, 409, 422]) {
  assert.equal(
    buildApiRouteErrorLog({ statusCode, message: "Expected request rejection" }, context, req, requestUrl),
    null,
    `expected HTTP ${statusCode} rejections must not pollute app error logs`
  );
}

const limited = buildApiRouteErrorLog({ statusCode: 429, message: "Rate limit reached" }, context, req, requestUrl);
assert.equal(limited?.level, "warning", "rate limits should remain observable as warnings");
assert.equal(limited?.statusCode, 429);
assert.equal(limited?.endpoint, "/api/example");

const failed = buildApiRouteErrorLog({ statusCode: 503, message: "Upstream unavailable" }, context, req, requestUrl);
assert.equal(failed?.level, "error", "server failures must remain errors");
assert.equal(failed?.statusCode, 503);

const malformed = buildApiRouteErrorLog({ statusCode: 200, message: "Unexpected failure" }, context, req, requestUrl);
assert.equal(malformed?.level, "error", "invalid error statuses must fail closed as HTTP 500");
assert.equal(malformed?.statusCode, 500);

console.log("api route error classification self-check passed");
