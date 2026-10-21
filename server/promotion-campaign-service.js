export { getPromotionCampaignById } from "./promotion-campaign-query-service.js";
export { createPromotionCampaign, updatePromotionCampaign } from "./promotion-campaign-write-service.js";

import { mapPromotionCampaignRow } from "./promotion-campaign-mapper.js";
import { listPromotionCampaignRows } from "./promotion-campaign-query-service.js";
import { emptyCampaignStats, loadPromotionCampaignStats } from "./promotion-campaign-stats-service.js";

export async function listPromotionCampaigns({ status, site, query } = {}) {
  const rows = await listPromotionCampaignRows({ status, site, query });
  const statsByCampaignId = await loadPromotionCampaignStats(rows.map((row) => row.id));
  const items = rows.map((row) => ({ ...mapPromotionCampaignRow(row), stats: statsByCampaignId.get(row.id) || emptyCampaignStats() }));

  return {
    ok: true,
    items,
  };
}
