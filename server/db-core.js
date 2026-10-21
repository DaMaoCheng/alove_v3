import mysql from "mysql2/promise";
import { SERVER_CONFIG } from "./config.js";
import { closeDbAdvisoryLockPool } from "./db-advisory-lock-service.js";

let pool = null;

export function getDbPool() {
  if (!pool) {
    pool = mysql.createPool({
      ...SERVER_CONFIG.db,
      waitForConnections: true,
      connectionLimit: 10,
      namedPlaceholders: false,
      multipleStatements: true,
    });
  }
  return pool;
}

export async function closeDbPool() {
  await closeDbAdvisoryLockPool();
  if (pool) {
    const current = pool;
    pool = null;
    await current.end();
  }
}

export async function withTransaction(work) {
  const connection = await getDbPool().getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
