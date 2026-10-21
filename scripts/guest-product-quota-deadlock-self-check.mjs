import assert from "node:assert/strict";

import {
  consumeGuestProductNetworkQuota,
  isGuestProductQuotaDeadlock,
} from "../server/product-search-routes.js";

const deadlock = Object.assign(new Error("Deadlock found"), { code: "ER_LOCK_DEADLOCK", errno: 1213, sqlState: "40001" });
assert.equal(isGuestProductQuotaDeadlock(deadlock), true);
assert.equal(isGuestProductQuotaDeadlock({ code: "ER_LOCK_WAIT_TIMEOUT", errno: 1205 }), false, "lock wait timeouts must not be retried as deadlocks");

let transactions = 0;
let quotaAttempts = 0;
const waits = [];
const result = await consumeGuestProductNetworkQuota({
  networkHash: "network",
  siteId: "site",
  withTransactionFn: async (work) => {
    transactions += 1;
    return work({ transaction: transactions });
  },
  consumeQuotaFn: async () => {
    quotaAttempts += 1;
    if (quotaAttempts < 3) throw deadlock;
    return "reserved";
  },
  sleepFn: async (delayMs) => waits.push(delayMs),
});
assert.equal(result, "reserved");
assert.equal(transactions, 3, "each retry must create a new transaction");
assert.equal(quotaAttempts, 3, "a successful retry must reserve quota once");
assert.deepEqual(waits, [20, 60], "deadlock retries should use bounded backoff");

let nonDeadlockAttempts = 0;
await assert.rejects(
  () => consumeGuestProductNetworkQuota({
    networkHash: "network",
    siteId: "site",
    withTransactionFn: async (work) => work({}),
    consumeQuotaFn: async () => {
      nonDeadlockAttempts += 1;
      throw Object.assign(new Error("lock wait timeout"), { code: "ER_LOCK_WAIT_TIMEOUT", errno: 1205 });
    },
    sleepFn: async () => assert.fail("non-deadlocks must not sleep or retry"),
  }),
  /lock wait timeout/
);
assert.equal(nonDeadlockAttempts, 1, "non-deadlocks must only attempt once");

await assert.rejects(
  () => consumeGuestProductNetworkQuota({
    networkHash: "network",
    siteId: "site",
    withTransactionFn: async (work) => work({}),
    consumeQuotaFn: async () => { throw deadlock; },
    sleepFn: async () => {},
  }),
  (error) => error?.statusCode === 503 && error?.publicCode === "GUEST_PRODUCT_QUOTA_DEADLOCK"
);

console.log("guest product quota deadlock self-check passed");
