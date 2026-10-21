import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = ["server/memory-job-runner-service.js", "server/memory-job-worker.js"].map(path => readFileSync(path, "utf8")).join("\n");

assert.match(source, /CLAIM_RETRY_DELAYS_MS/, "memory job runner should define claim retry delays");
assert.match(source, /claimNextMemoryJobWithRetry/, "memory job runner should wrap job claims with retry handling");
assert.match(source, /isDeadlockError\(error\)/, "memory job runner should detect deadlock errors");
assert.match(source, /ER_LOCK_DEADLOCK/, "deadlock detection should cover MySQL ER_LOCK_DEADLOCK");
assert.match(source, /errno === 1213/, "deadlock detection should cover MySQL deadlock errno");
assert.match(source, /sqlState === ["']40001["']/, "deadlock detection should cover transaction rollback SQL state");
assert.match(source, /memory job claim skipped after deadlock retries/, "runner should skip the current batch after repeated claim deadlocks");
assert.match(source, /memory job batch skipped/, "runner should catch batch-level errors instead of creating unhandled rejections");
assert.match(source, /await sleep\(CLAIM_RETRY_DELAYS_MS\[attempt\]\)/, "deadlock retries should use short backoff");

console.log("memory job deadlock self-check passed");
