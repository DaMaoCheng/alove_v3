import assert from "node:assert/strict";
import { closeDbPool, getDbPool, initializeDatabase } from "../server/db.js";
import { acquireDedicatedDbAdvisoryLock, closeDbAdvisoryLockPool } from "../server/db-advisory-lock-service.js";

async function main() {
  process.env.NODE_ENV = "test";
  await initializeDatabase();
  const lockTasks = Array.from({ length: 12 }, (_, index) => holdDedicatedLock(index));
  const businessQueries = Promise.all(Array.from({ length: 10 }, () => getDbPool().execute("SELECT 1 AS ok")));
  const businessResults = await Promise.race([
    businessQueries,
    new Promise((_, reject) => setTimeout(() => reject(new Error("business database pool was starved by advisory locks")), 2000)),
  ]);
  assert.equal(businessResults.length, 10);
  assert.ok(businessResults.every(([rows]) => Number(rows[0]?.ok || 0) === 1));
  await Promise.all(lockTasks);
  console.log("database advisory lock pool self-check passed");
}

async function holdDedicatedLock(index) {
  const release = await acquireDedicatedDbAdvisoryLock(`self_check_guest_reply:${index}`, 2);
  try {
    await new Promise((resolve) => setTimeout(resolve, 75));
  } finally {
    await release();
  }
}

try {
  await main();
} finally {
  await closeDbAdvisoryLockPool();
  await closeDbPool();
}
