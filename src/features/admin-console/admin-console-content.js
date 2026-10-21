import { adminAgentEditorHtml, adminAgentListHtml } from "./admin-console-agents-template.js";
import { adminAccountsHtml } from "./admin-console-accounts-template.js";
import { adminCarouselHtml } from "./admin-console-carousel-template.js";
import { adminCommonCharactersHtml } from "./admin-console-common-characters-template.js";
import { adminCreatorCharactersHtml } from "./admin-console-creator-characters-template.js";
import { adminFeedbackHtml } from "./admin-feedback-template.js";
import { adminKitshopHtml } from "./admin-kitshop-template.js";
import { adminLogsErrorHtml, adminLogsHtml, adminLogsLoadingHtml, adminLogsRowsHtml } from "./admin-console-logs-template.js";
import { adminMascotHtml } from "./admin-console-mascot-template.js";
import { adminPromotionCampaignsHtml } from "./admin-console-promotion-campaigns-template.js";
import { adminDiscountCodesHtml } from "./admin-discount-codes-template.js";
import { adminReportingHtml } from "./admin-reporting-template.js";
import { adminOverviewHtml } from "./admin-console-overview-template.js";
import { adminSitesHtml } from "./admin-console-sites-template.js";
import { adminExternalEmbedsHtml } from "./admin-console-external-embeds-template.js";
import {
  adminCostsHtml,
  adminKnowledgeBaseHtml,
  adminLeadsHtml,
  adminPaymentsHtml,
} from "./admin-console-static-tabs.js";

export function adminContentHtml(view) {
  if (view === "creatorCharacters") return adminCreatorCharactersHtml();
  if (view === "commonCharacters") return adminCommonCharactersHtml();
  if (view === "sites") return adminSitesHtml();
  if (view === "externalEmbeds") return adminExternalEmbedsHtml();
  if (view === "mascot") return adminMascotHtml();
  if (view === "carousel") return adminCarouselHtml();
  if (view === "kitshop") return adminKitshopHtml();
  if (view === "promotionCampaigns") return adminPromotionCampaignsHtml();
  if (view === "accounts") return adminAccountsHtml();
  if (view === "kb") return adminKnowledgeBaseHtml();
  if (view === "leads") return adminLeadsHtml();
  if (view === "codes") return adminDiscountCodesHtml();
  if (view === "reporting") return adminReportingHtml();
  if (view === "payments") return adminPaymentsHtml();
  if (view === "costs") return adminCostsHtml();
  if (view === "feedback") return adminFeedbackHtml();
  if (view === "logs") return adminLogsHtml();
  return adminOverviewHtml();
}

export {
  adminAgentEditorHtml,
  adminAgentListHtml,
  adminLogsErrorHtml,
  adminLogsLoadingHtml,
  adminLogsRowsHtml,
};
