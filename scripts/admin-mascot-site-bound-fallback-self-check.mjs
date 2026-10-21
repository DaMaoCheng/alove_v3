import assert from "node:assert/strict";
import { closeDbPool, getDbPool, initializeDatabase } from "../server/db.js";
import { listAdminMascotSettings } from "../server/admin-mascot-service.js";

await initializeDatabase();
const db = getDbPool();

try {
  const [[site]] = await db.execute(
    `SELECT s.id, s.mascot_character_id, c.name AS mascot_name
     FROM sites s
     LEFT JOIN ai_characters c ON c.id = s.mascot_character_id
     WHERE s.id = 'site_fkk'
     LIMIT 1`
  );
  assert.equal(site?.mascot_name, "Millie", "FKK site should point to Millie for this regression check");

  const result = await listAdminMascotSettings();
  const fkk = result.sites.find((item) => item.id === "site_fkk");
  assert.ok(fkk, "admin mascot settings should include FKK site");
  assert.equal(fkk.mascotCharacterId, site.mascot_character_id, "FKK should expose the bound mascot character id");
  assert.equal(fkk.mascot?.id, site.mascot_character_id, "FKK mascot row should use site mascot id when setting is missing");
  assert.equal(fkk.mascot?.name, "Millie", "FKK mascot row should display Millie when setting is missing");
  assert.ok(
    ["FKK绑定", "FKK覆盖"].includes(fkk.mascot?.source),
    "FKK mascot row should identify either the site-bound fallback source or an active override source"
  );

  console.log("admin mascot site-bound fallback self-check passed");
} finally {
  await closeDbPool();
}
