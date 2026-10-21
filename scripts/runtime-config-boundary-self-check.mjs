import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const serverRoot = "server";
const allowedDirectReaders = new Map([
  ["server/config.js", null],
  ["server/product-source-http-service.js", new Set(["NODE_ENV", "AIOVE_ALLOW_LOCAL_PRODUCT_SOURCE_SELF_CHECK"])],
]);

for (const file of listJavaScriptFiles(serverRoot)) {
  const source = readFileSync(file, "utf8");
  if (!source.includes("process.env")) continue;

  const normalizedFile = relative(process.cwd(), file).replaceAll("\\", "/");
  assert.ok(allowedDirectReaders.has(normalizedFile), `${normalizedFile} must read runtime settings through SERVER_CONFIG`);
  const allowedKeys = allowedDirectReaders.get(normalizedFile);
  if (allowedKeys === null) continue;

  assert.doesNotMatch(source, /process\.env\s*\[/, `${normalizedFile} must not read dynamic environment variable names`);
  const usedKeys = [...source.matchAll(/process\.env\.([A-Z0-9_]+)/g)].map((match) => match[1]);
  for (const key of usedKeys) {
    assert.ok(allowedKeys.has(key), `${normalizedFile} direct environment read is not allowlisted: ${key}`);
  }
}

const configSource = readFileSync("server/config.js", "utf8");
assert.match(configSource, /knowledgeAi:\s*resolveKnowledgeAiConfig/, "Knowledge AI must be built inside SERVER_CONFIG");
assert.doesNotMatch(readFileSync("server/knowledge-ai-config.js", "utf8"), /process\.env/, "Knowledge AI facade must not read process.env");
assert.doesNotMatch(readFileSync("server/product-source-shopify-admin-service.js", "utf8"), /process\.env/, "Shopify runtime service must not read process.env");

const legacyKeys = [
  "ALIYUN_ASR_API_KEY",
  "ALIYUN_ASR_BASE_URL",
  "ALIYUN_ASR_CNY_PER_SECOND",
  "ALIYUN_ASR_MODEL",
  "ALIYUN_ASR_TIMEOUT_MS",
  "DASHSCOPE_API_KEY",
  "FFMPEG_BIN",
  "FFPROBE_BIN",
];
const envExample = readFileSync(".env.example", "utf8");
for (const key of legacyKeys) {
  assert.doesNotMatch(envExample, new RegExp(`^${key}=`, "m"), `.env.example must not restore unused key ${key}`);
}

console.log("runtime config boundary self-check passed");

function listJavaScriptFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...listJavaScriptFiles(fullPath));
    else if (entry.isFile() && entry.name.endsWith(".js")) files.push(fullPath);
  }
  return files;
}
