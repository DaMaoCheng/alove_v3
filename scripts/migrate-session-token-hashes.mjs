import { initializeDatabase, getDbPool, closeDbPool } from "../server/db.js";
import { hashSessionToken } from "../server/security.js";

const DRY_RUN = process.argv.includes("--dry-run");
const BATCH_SIZE = 200;

await initializeDatabase();
const db = getDbPool();

let scanned = 0;
let migrated = 0;

try {
  while (true) {
    const [rows] = await db.execute(
      `SELECT id, auth_token
       FROM users
       WHERE auth_token IS NOT NULL
         AND auth_token <> ''
         AND auth_token NOT LIKE 'sha256:%'
       ORDER BY updated_at ASC, id ASC
       LIMIT ${BATCH_SIZE}`
    );
    if (!rows.length) break;
    scanned += rows.length;

    for (const row of rows) {
      const tokenHash = hashSessionToken(row.auth_token);
      if (!tokenHash) continue;
      if (!DRY_RUN) {
        await db.execute(
          `UPDATE users
           SET auth_token = ?, updated_at = NOW(3)
           WHERE id = ?
             AND auth_token = ?`,
          [tokenHash, row.id, row.auth_token]
        );
      }
      migrated += 1;
    }

    if (DRY_RUN) break;
  }

  console.log(JSON.stringify({
    ok: true,
    dryRun: DRY_RUN,
    scanned,
    migrated,
  }, null, 2));
} finally {
  await closeDbPool();
}
