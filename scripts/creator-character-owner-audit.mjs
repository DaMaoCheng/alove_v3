import { closeDbPool, getDbPool } from "../server/db-core.js";

try {
  const [tables] = await getDbPool().query(
    `SELECT 1
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_characters'
     LIMIT 1`
  );
  if (!tables.length) {
    console.log("creator character owner audit skipped: ai_characters does not exist yet");
  } else {
    const [duplicates] = await getDbPool().query(
      `SELECT owner_uid, COUNT(*) AS character_count
       FROM ai_characters
       WHERE category_id = 'creator'
         AND character_status <> 'archived'
         AND owner_uid IS NOT NULL
       GROUP BY owner_uid
       HAVING COUNT(*) > 1
       ORDER BY character_count DESC, owner_uid ASC`
    );
    if (duplicates.length) {
      const summary = duplicates.map((row) => `${row.owner_uid} (${row.character_count})`).join(", ");
      throw new Error(`Creator character owner audit failed: ${summary}`);
    }
    console.log("creator character owner audit passed");
  }
} finally {
  await closeDbPool();
}
