import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const querySource = readFileSync("server/admin-site-query-service.js", "utf8");
const mapperSource = readFileSync("server/admin-site-mapper.js", "utf8");

assert.match(querySource, /LEFT JOIN mascot_settings ms ON ms\.site_id = s\.id AND ms\.setting_status = 'active'/, "admin site list should join active mascot settings");
assert.match(querySource, /COALESCE\(ms\.character_id, s\.mascot_character_id\) AS effective_mascot_character_id/, "admin site list should expose effective mascot id");
assert.match(querySource, /LEFT JOIN ai_characters m ON m\.id = COALESCE\(ms\.character_id, s\.mascot_character_id\)/, "admin site list should resolve mascot name from active setting first");
assert.match(mapperSource, /mascotCharacterId: row\.effective_mascot_character_id \|\| row\.mascot_character_id \|\| ""/, "site mapper should prefer effective mascot id");

console.log("admin site mascot sync self-check passed");
