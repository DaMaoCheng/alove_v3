import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const checks = [
  {
    file: "server/chat-image-generation-service.js",
    patterns: [
      "maxRetries: 1",
      "MEMORY_JOB_TYPES.GENERATE_CHAT_IMAGE",
    ],
  },
  {
    file: "server/chat-image-job-service.js",
    patterns: [
      "shouldKeepChatImageGeneratingForRetry(job)",
      "markChatImageRetrying({ messageId, assetId, error }, job)",
      "error_message = NULL",
      "SET status = 'generating',",
      "SET status = 'failed',",
    ],
  },
  {
    file: "src/app/chat-image-status-poller.js",
    patterns: [
      "FAILED_POLL_GRACE_MS",
      "status === \"failed\"",
      "isRecentFailedChatImage(message)",
    ],
  },
];

const failures = [];

for (const check of checks) {
  const absolute = path.join(root, check.file);
  const source = fs.readFileSync(absolute, "utf8");
  for (const pattern of check.patterns) {
    if (!source.includes(pattern)) {
      failures.push(`${check.file} missing: ${pattern}`);
    }
  }
}

if (failures.length) {
  console.error("Chat image retry-state self-check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Chat image retry-state self-check passed.");
