import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const seedSource = readFileSync("server/db-bootstrap-seeds.js", "utf8");
const seedMatch = seedSource.match(/export async function seedDefaultMascotCharacters\(\) \{[\s\S]*?export async function seedDefaultMascotSettings\(\)/);
assert.ok(seedMatch, "default mascot seed block should exist");
const seedBlock = seedMatch[0];

assert.match(seedBlock, /'elevenlabs', 'm98EUhgNJclFM2V0xXhQ', 'ALOVE Front Desk PVC'/, "default mascot seed should use the verified PVC voice");
assert.match(seedBlock, /'status', 'ready'/, "default mascot seed voiceClone should be ready");
assert.match(seedBlock, /'voiceId', 'm98EUhgNJclFM2V0xXhQ'/, "default mascot seed profile should keep the PVC voice id");
assert.match(seedBlock, /'slotType', 'professional_voice_clone'/, "default mascot seed should keep PVC clone metadata");
assert.doesNotMatch(seedBlock, /elevenlabs_clone_pending|Pending cloned front desk voice|pending_voice_id/, "default mascot seed should not reintroduce pending voice config");
assert.match(seedBlock, /source_ref = 'mascot-seed'/, "template greeting sync should allow the system seed row");
assert.match(seedBlock, /source_ref = 'template-edit' AND greeting IN \(\?, \?, \?, \?\)/, "template greeting sync should only migrate the known system-authored greetings");
assert.doesNotMatch(seedBlock, /source_ref IN \('mascot-seed', 'template-edit'\)/, "template greeting sync must not overwrite every later administrator edit");
assert.match(seedBlock, /MILLIE_PLATFORM_SPEAKING_STYLE/, "Millie should keep a concise speaking-style layer separate from the full persona");
assert.match(seedBlock, /Log in for exclusive offers/, "both front desk greetings should explain the authenticated offer benefit");
assert.match(seedBlock, /feedback via the button in the top-right corner of the home page/, "both front desk greetings should expose the home-page feedback entry");
assert.match(seedBlock, /menu in the top-left/, "both front desk greetings should expose the app navigation entry");
assert.doesNotMatch(
  seedBlock,
  /\[MILLIE_PLATFORM_GREETING,\s*MILLIE_PLATFORM_PERSONA,\s*MILLIE_PLATFORM_PERSONA,/,
  "Millie's full persona must not be injected again as speaking style",
);

console.log("mascot default PVC seed self-check passed");
