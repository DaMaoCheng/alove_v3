import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("src/features/chat/chat-message-renderer.js", "utf8");

assert.match(source, /const MONTH_LABELS = Object\.freeze\(\["Jan", "Feb", "Mar"/, "chat message timestamps should use English short month labels");
assert.match(source, /function isSameLocalDate\(left, right\)/, "chat message timestamps should compare local calendar dates");
assert.match(source, /if \(isSameLocalDate\(date, now\)\) return time;/, "today's chat messages should stay time-only");
assert.match(source, /return `\$\{month\} \$\{day\}\$\{yearPart\}, \$\{time\}`;/, "older chat messages should include month, day, and time");
assert.match(source, /function formatHourMinute\(date\)/, "chat message timestamps should use a stable 24-hour HH:mm formatter");
assert.doesNotMatch(source, /return date\.toLocaleTimeString\(\[\]/, "chat message timestamps should not always be time-only");

console.log("chat message time format self-check passed");
