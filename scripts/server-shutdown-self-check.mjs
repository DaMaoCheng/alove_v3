import assert from "node:assert/strict";
import { spawn } from "node:child_process";

const PORT = String(process.env.SHUTDOWN_CHECK_PORT || 4199);
const START_TIMEOUT_MS = Number(process.env.SHUTDOWN_CHECK_START_TIMEOUT_MS || 20000);
const STOP_TIMEOUT_MS = Number(process.env.SHUTDOWN_CHECK_STOP_TIMEOUT_MS || 10000);

const child = spawn("node", ["--input-type=module", "-e", `
  import { acquireDedicatedDbAdvisoryLock } from "./server/db-advisory-lock-service.js";
  const release = await acquireDedicatedDbAdvisoryLock("shutdown-self-check", 1);
  await release();
  await import("./server/server.js");
`], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    PORT,
    HOST: "127.0.0.1",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let output = "";
child.stdout.on("data", (chunk) => {
  output += chunk.toString();
});
child.stderr.on("data", (chunk) => {
  output += chunk.toString();
});

try {
  await waitForOutput("server listening", START_TIMEOUT_MS);
  child.kill("SIGTERM");
  const code = await waitForExit(STOP_TIMEOUT_MS);
  assert.equal(code, 0, `server should exit with code 0 after SIGTERM, got ${code}. Output:\n${output}`);
  assert.ok(output.includes("shutdown complete"), `server should log shutdown complete. Output:\n${output}`);
  console.log("server shutdown self-check passed");
} catch (error) {
  child.kill("SIGKILL");
  throw error;
}

function waitForOutput(text, timeoutMs) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const timer = setInterval(() => {
      if (output.includes(text)) {
        clearInterval(timer);
        resolve();
        return;
      }
      if (Date.now() - startedAt > timeoutMs) {
        clearInterval(timer);
        reject(new Error(`timed out waiting for ${text}. Output:\n${output}`));
      }
    }, 100);
    child.once("exit", (code) => {
      clearInterval(timer);
      reject(new Error(`server exited before ${text}, code ${code}. Output:\n${output}`));
    });
  });
}

function waitForExit(timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`timed out waiting for server shutdown. Output:\n${output}`));
    }, timeoutMs);
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}
