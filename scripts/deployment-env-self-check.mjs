import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const envExample = readFileSync(".env.example", "utf8");
const deploymentChecklist = readFileSync("docs/deployment-checklist-2026-06-10.md", "utf8");

const configSource = readFileSync("server/config.js", "utf8");
const envExampleRequiredKeys = [...new Set([...configSource.matchAll(/(?:process\.)?env\.([A-Z0-9_]+)/g)].map((match) => match[1]))].sort();
const productionChecklistKeys = envExampleRequiredKeys;

const envKeys = parseEnvKeys(envExample);
for (const key of envExampleRequiredKeys) {
  assert.ok(envKeys.has(key), `.env.example should include ${key}`);
}

for (const key of envKeys) {
  assert.ok(envExampleRequiredKeys.includes(key), `.env.example includes unrecognized or obsolete runtime key ${key}`);
}

for (const key of productionChecklistKeys) {
  assert.ok(deploymentChecklist.includes(`${key}=`), `deployment checklist production env block should include ${key}`);
}

assert.ok(deploymentChecklist.includes("npm run preflight:multisite"), "deployment checklist should include multisite preflight command");
assert.ok(deploymentChecklist.includes("npm run smoke:multisite"), "deployment checklist should include multisite smoke command");
assert.ok(deploymentChecklist.includes("SMOKE_BASE_URL=https://your-domain.example npm run smoke:multisite"), "deployment checklist should include public-domain smoke command");
assert.ok(deploymentChecklist.includes("X-Forwarded-For"), "deployment checklist should mention X-Forwarded-For for IP routing");

console.log("deployment env self-check passed");

function parseEnvKeys(content) {
  const keys = new Set();
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index <= 0) continue;
    keys.add(trimmed.slice(0, index).trim());
  }
  return keys;
}
