import assert from "node:assert/strict";
import { getRequestIp, isTrustedProxyRequest } from "../server/http-request-utils.js";

function mockReq({ remoteAddress = "127.0.0.1", headers = {} } = {}) {
  return {
    headers,
    socket: { remoteAddress },
  };
}

assert.equal(
  getRequestIp(mockReq({
    remoteAddress: "127.0.0.1",
    headers: { "x-forwarded-for": "203.0.113.10, 198.51.100.2" },
  })),
  "203.0.113.10",
  "trusted local proxy should allow x-forwarded-for"
);

assert.equal(
  getRequestIp(mockReq({
    remoteAddress: "::ffff:127.0.0.1",
    headers: { "cf-connecting-ip": "203.0.113.20", "x-forwarded-for": "203.0.113.10" },
  })),
  "203.0.113.20",
  "trusted local proxy should prefer cf-connecting-ip"
);

assert.equal(
  getRequestIp(mockReq({
    remoteAddress: "198.51.100.9",
    headers: { "x-forwarded-for": "203.0.113.10" },
  })),
  "198.51.100.9",
  "untrusted remote address should ignore spoofed x-forwarded-for"
);

assert.equal(isTrustedProxyRequest("127.0.0.1"), true, "loopback proxy should be trusted by default");
assert.equal(isTrustedProxyRequest("198.51.100.9"), false, "external clients should not be trusted proxies by default");

console.log("trusted proxy IP self-check passed");
