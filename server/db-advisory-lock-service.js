import mysql from "mysql2/promise";
import { SERVER_CONFIG } from "./config.js";
import { createPublicError } from "./public-error-utils.js";

const LOCK_POOL_CONNECTION_LIMIT = 4;
const LOCK_POOL_QUEUE_LIMIT = 16;
let lockPool = null;

export async function acquireDbAdvisoryLock(connection, lockName, timeoutSeconds = 10) {
  const normalizedName = String(lockName || "").trim().slice(0, 64);
  if (!normalizedName) throw new Error("Database advisory lock name is required");
  const [rows] = await connection.execute("SELECT GET_LOCK(?, ?) AS locked", [normalizedName, Math.max(0, Number(timeoutSeconds || 0))]);
  if (Number(rows[0]?.locked || 0) !== 1) throw createPublicError("Guest traffic is busy. Please try again.", 429);
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    await connection.execute("SELECT RELEASE_LOCK(?)", [normalizedName]);
  };
}

export async function acquireDedicatedDbAdvisoryLock(lockName, timeoutSeconds = 10) {
  let connection;
  try {
    connection = await getDbAdvisoryLockPool().getConnection();
  } catch {
    throw createPublicError("Guest traffic is busy. Please try again.", 429);
  }
  try {
    const releaseLock = await acquireDbAdvisoryLock(connection, lockName, timeoutSeconds);
    let released = false;
    return async () => {
      if (released) return;
      released = true;
      try {
        await releaseLock();
      } finally {
        connection.release();
      }
    };
  } catch (error) {
    connection.release();
    throw error;
  }
}

export async function closeDbAdvisoryLockPool() {
  if (!lockPool) return;
  const current = lockPool;
  lockPool = null;
  await current.end();
}

function getDbAdvisoryLockPool() {
  if (!lockPool) {
    lockPool = mysql.createPool({
      ...SERVER_CONFIG.db,
      waitForConnections: true,
      connectionLimit: LOCK_POOL_CONNECTION_LIMIT,
      queueLimit: LOCK_POOL_QUEUE_LIMIT,
      namedPlaceholders: false,
      multipleStatements: false,
    });
  }
  return lockPool;
}
