import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { SELF_CHECK_MANIFEST, listManifestCommands } from "./self-check-manifest.mjs";

const deploymentSource = readFileSync("scripts/deployment-check.mjs", "utf8");
const directGateScripts = Array.from(deploymentSource.matchAll(/\["node", \["(scripts\/[^"]+)"\]\]/g), (match) => match[1]);
const directGateNpmCommands = Array.from(deploymentSource.matchAll(/\["npm", \["run", "([^"]+)"\]\]/g), (match) => `npm run ${match[1]}`);

const directGateCommands = [...directGateScripts.map((script) => `node ${script}`), ...directGateNpmCommands];

assert.equal(SELF_CHECK_MANIFEST.deploymentGate.command, "npm run check:deployment");
assert.equal(SELF_CHECK_MANIFEST.deploymentGate.commandSource, "scripts/deployment-check.mjs");
assert.ok(SELF_CHECK_MANIFEST.deploymentGate.domains.length >= 8, "deployment gate should declare its covered domains");
assert.deepEqual(directGateNpmCommands, ["npm run preflight:multisite", "npm run smoke:multisite"], "deployment gate should finish with multisite preflight and HTTP smoke");
assert.equal(new Set(directGateScripts).size, directGateScripts.length, "deployment gate should not run a direct script twice");
for (const script of directGateScripts) assert.ok(existsSync(script), `deployment gate script is missing: ${script}`);
assert.deepEqual(
  Object.keys(SELF_CHECK_MANIFEST.deploymentGate.requiredCriticalCommands).sort(),
  [...SELF_CHECK_MANIFEST.deploymentGate.domains].sort(),
  "every declared deployment domain should have critical command anchors",
);
for (const [domain, commands] of Object.entries(SELF_CHECK_MANIFEST.deploymentGate.requiredCriticalCommands)) {
  assert.ok(SELF_CHECK_MANIFEST.deploymentGate.domains.includes(domain), `critical check domain is undeclared: ${domain}`);
  for (const command of commands) {
    assert.ok(directGateCommands.includes(command), `critical deployment command is not in the gate: ${command}`);
  }
}

const optionalCommands = listManifestCommands("optionalRuntime");
const targetedCommands = listManifestCommands("targetedCritical");
const manualCommands = listManifestCommands("manual");
assert.equal(new Set(optionalCommands).size, optionalCommands.length, "optional runtime checks should be unique");
assert.equal(new Set(targetedCommands).size, targetedCommands.length, "targeted critical checks should be unique");
assert.equal(new Set(manualCommands).size, manualCommands.length, "manual checks should be unique");
for (const entry of [...SELF_CHECK_MANIFEST.optionalRuntime, ...SELF_CHECK_MANIFEST.targetedCritical]) {
  const script = entry.command.match(/(?:^|\s)node\s+(scripts\/[^\s]+)/)?.[1];
  assert.ok(script, `manifest command must invoke a script with node: ${entry.command}`);
  assert.ok(existsSync(script), `manifest script is missing: ${script}`);
  assert.ok(entry.purpose.length >= 12, `manifest purpose is too vague: ${entry.command}`);
}
for (const entry of [...SELF_CHECK_MANIFEST.conditionalGate, ...SELF_CHECK_MANIFEST.manual]) {
  assert.ok(entry.command && entry.purpose.length >= 12, "conditional/manual checks require a command and purpose");
}

console.log("self-check manifest self-check passed");
