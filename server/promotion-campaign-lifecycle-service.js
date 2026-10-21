import { getDbPool } from "./db.js";

const CAMPAIGN_LIFECYCLE_INTERVAL_MS = 60 * 1000;

let lifecycleTimer = null;
let lifecyclePromise = null;

export async function archiveExpiredPromotionCampaigns({ now = new Date(), db = getDbPool() } = {}) {
  const [result] = await db.execute(
    `UPDATE promotion_campaigns
     SET campaign_status = 'archived'
     WHERE campaign_status = 'active'
       AND ends_at IS NOT NULL
       AND ends_at <= ?`,
    [now]
  );
  return Number(result.affectedRows || 0);
}

export function startPromotionCampaignLifecycleScheduler() {
  if (lifecycleTimer) return;
  void runPromotionCampaignLifecycle();
  lifecycleTimer = setInterval(() => {
    void runPromotionCampaignLifecycle();
  }, CAMPAIGN_LIFECYCLE_INTERVAL_MS);
  lifecycleTimer.unref?.();
}

export function stopPromotionCampaignLifecycleScheduler() {
  if (lifecycleTimer) clearInterval(lifecycleTimer);
  lifecycleTimer = null;
}

export async function stopPromotionCampaignLifecycleSchedulerAndWait() {
  stopPromotionCampaignLifecycleScheduler();
  if (lifecyclePromise) await lifecyclePromise.catch(() => {});
}

async function runPromotionCampaignLifecycle() {
  if (lifecyclePromise) return lifecyclePromise;
  lifecyclePromise = archiveExpiredPromotionCampaigns()
    .catch((error) => {
      console.warn("[aiove] promotion campaign lifecycle reconciliation failed:", error.message);
    })
    .finally(() => {
      lifecyclePromise = null;
    });
  return lifecyclePromise;
}
