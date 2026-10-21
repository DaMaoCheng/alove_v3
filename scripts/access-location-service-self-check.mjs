import assert from "node:assert/strict";
import { recordGuestLastAccess, recordUserLastAccess, resolveRequestAccess } from "../server/access-location-service.js";

const writes = [];
const db = {
  async execute(sql, params) {
    writes.push({ sql, params });
  },
};

const access = resolveRequestAccess({
  socket: { remoteAddress: "203.0.113.10" },
  headers: { "cf-ipcountry": "GB" },
});
assert.equal(access.ip, "203.0.113.10", "direct request should keep a valid IP");
assert.equal(access.region, "未知地区", "a direct client must not be able to forge a Cloudflare country header");

await recordUserLastAccess(db, { userId: "u_access_check", access });
await recordGuestLastAccess(db, { guestSessionId: "guest_access_check", access });
assert.equal(writes.length, 2, "account and guest access should use independent writes");
assert.match(writes[0].sql, /UPDATE users/, "account access should write only the users table");
assert.match(writes[1].sql, /UPDATE guest_sessions/, "guest access should write only the guest sessions table");
assert.equal(writes[0].params[0], "203.0.113.10");
assert.equal(writes[0].params[1], "未知地区");

await recordUserLastAccess(db, { userId: "", access });
assert.equal(writes.length, 2, "missing identity must not produce an access write");

await recordUserLastAccess({ async execute() { throw new Error("optional access write failed"); } }, { userId: "u_nonblocking", access });
console.log("access location service self-check passed");
