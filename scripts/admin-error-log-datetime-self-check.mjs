import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const logsTemplate = readFileSync(new URL("../src/features/admin-console/admin-console-logs-template.js", import.meta.url), "utf8");

assert.match(logsTemplate, /year: "numeric"/, "error log timestamps should include year");
assert.match(logsTemplate, /month: "2-digit"/, "error log timestamps should include month");
assert.match(logsTemplate, /day: "2-digit"/, "error log timestamps should include day");
assert.match(logsTemplate, /hour: "2-digit"/, "error log timestamps should include hour");
assert.match(logsTemplate, /minute: "2-digit"/, "error log timestamps should include minute");
assert.doesNotMatch(logsTemplate, /return date\.toLocaleTimeString/, "error log timestamps should not be time-only");

console.log("Admin error log datetime self-check passed");
