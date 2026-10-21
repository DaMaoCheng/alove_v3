import assert from "node:assert/strict";
import { bindAdminAccounts } from "../src/features/admin-console/admin-accounts-controller.js";

// Match mountApp: build/bind a detached page, then attach synchronously.
globalThis.window = {};
globalThis.document = { addEventListener() {} };
const requests = [];
globalThis.fetch = async (path) => {
  requests.push(String(path));
  return new Response(JSON.stringify({ items: [], summary: {}, total: 0 }));
};
const main = {
  isConnected: false,
  innerHTML: "initial formal-account template",
  querySelector() { return null; },
  querySelectorAll() { return []; },
};
bindAdminAccounts({ querySelector: () => main }, { targetGuestSessionId: "guest_mount_check" });
main.isConnected = true;
await new Promise((resolve) => setImmediate(resolve));
assert.ok(requests.some((path) => path.includes("/guests?") && path.includes("query=guest_mount_check")), "deep-link must request the guest list after mount");
assert.match(main.innerHTML, /guest-sessions-page/, "deep-link must replace the initial formal-account template");
console.log("admin guest mount self-check passed");
