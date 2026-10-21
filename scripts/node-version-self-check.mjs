import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const requirement = String(packageJson.engines?.node || ">=20.18.1").trim();
const current = process.versions.node;

const minimum = parseMinimumVersion(requirement);
const currentVersion = parseVersion(current);

assert.ok(minimum, `unsupported node engine requirement: ${requirement}`);
assert.ok(
  compareVersions(currentVersion, minimum) >= 0,
  `Node.js ${requirement} is required, current version is ${current}. Install Node.js ${formatVersion(minimum)} or newer.`
);

console.log(`node version self-check passed (${current}, requirement ${requirement})`);

function parseMinimumVersion(value) {
  const match = String(value || "").match(/^>=\s*(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  return match ? [match[1], match[2] || 0, match[3] || 0].map((part) => Number(part)) : null;
}

function parseVersion(value) {
  const [major = 0, minor = 0, patch = 0] = String(value || "").split(".").map((part) => Number(part) || 0);
  return [major, minor, patch];
}

function compareVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] > right[index]) return 1;
    if (left[index] < right[index]) return -1;
  }
  return 0;
}

function formatVersion(value = []) {
  return value.join(".");
}
