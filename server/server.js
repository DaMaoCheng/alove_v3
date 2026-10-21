import { createServer } from "node:http";
import { SERVER_CONFIG } from "./config.js";
import { closeDbPool, initializeDatabase } from "./db.js";
import { serveStatic } from "./http-utils.js";
import { configureNetworkProxy } from "./network-proxy.js";
import { startMemoryJobRunner, stopMemoryJobRunnerAndWait } from "./memory-job-runner-service.js";
import { startProactiveMessageScheduler, stopProactiveMessageSchedulerAndWait } from "./proactive-message-scheduler-service.js";
import {
  startPromotionCampaignLifecycleScheduler,
  stopPromotionCampaignLifecycleSchedulerAndWait,
} from "./promotion-campaign-lifecycle-service.js";
import { createRealtimeCallService } from "./call-realtime-service.js";
import { handleApiRoute } from "./routes.js";
import { buildHttpsRedirectUrl, shouldRedirectToHttps } from "./security-response-utils.js";
import { redirect } from "./http-utils.js";
import { guardAdminShellRoute } from "./admin-shell-guard.js";

async function main() {
  configureNetworkProxy();
  await initializeDatabase();
  startMemoryJobRunner();
  startProactiveMessageScheduler();
  startPromotionCampaignLifecycleScheduler();

  const server = createServer(async (req, res) => {
    if (shouldRedirectToHttps(req)) {
      redirect(res, buildHttpsRedirectUrl(req), 308);
      return;
    }
    if (await guardAdminShellRoute(req, res)) return;
    if (await handleApiRoute(req, res)) return;
    await serveStatic(req, res);
  });
  createRealtimeCallService({ server });

  server.listen(SERVER_CONFIG.port, SERVER_CONFIG.host, () => {
    console.info(`[aiove] server listening on http://${SERVER_CONFIG.host}:${SERVER_CONFIG.port}`);
  });

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.info(`[aiove] received ${signal}, shutting down...`);
    try {
      await stopProactiveMessageSchedulerAndWait();
      await stopPromotionCampaignLifecycleSchedulerAndWait();
      await stopMemoryJobRunnerAndWait();
      await closeHttpServer(server);
      await closeDbPool();
      console.info("[aiove] shutdown complete");
      process.exitCode = 0;
    } catch (error) {
      console.error("[aiove] shutdown failed:", error?.message || error);
      process.exitCode = 1;
    }
  };
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
}

function closeHttpServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

main().catch((error) => {
  console.error("[aiove] server failed:", error.message);
  process.exitCode = 1;
});
