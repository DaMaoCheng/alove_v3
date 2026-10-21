import { adminContentHtml } from "./admin-console-content.js";
import { createAdminShell } from "./admin-console-layout.js";
import { bindDropdowns } from "../shared-ui/dropdown.js";
import { bindAdminAccounts } from "./admin-accounts-controller.js";
import { bindAdminCarousel } from "./admin-carousel-controller.js";
import { bindAdminCommonCharacters } from "./admin-common-characters-controller.js";
import { bindAdminCreatorCharacters } from "./admin-creator-characters-controller.js";
import { bindAdminAgents } from "./admin-agents-controller.js";
import { bindAdminFeedback } from "./admin-feedback-controller.js";
import { bindAdminKitshop } from "./admin-kitshop-controller.js";
import { bindAdminKnowledge } from "./admin-knowledge-controller.js";
import { bindAdminLogs } from "./admin-logs-controller.js";
import { bindAdminMascot } from "./admin-mascot-controller.js";
import { bindAdminPromotionCampaigns } from "./admin-promotion-campaigns-controller.js";
import { bindAdminDiscountCodes } from "./admin-discount-codes-controller.js";
import { bindAdminReporting } from "./admin-reporting-controller.js";
import { bindAdminOverview } from "./admin-overview-controller.js";
import { bindAdminSites } from "./admin-sites-controller.js";
import { bindAdminExternalEmbeds } from "./admin-external-embeds-controller.js";
import { bindAdminFeedbackIndicator } from "./admin-feedback-indicator.js";
import { registerViewDisposer } from "../../app/app-view-lifecycle.js";

export function createAdminConsolePage({ activeView, onAdminViewChange, onOpenAccount, onOpenGuestSession, targetAccountId = "", targetGuestSessionId = "", onTargetConsumed, onBack, onOpenProfile, user = {} }) {
  const shell = createAdminShell({
    activeView,
    contentHtml: adminContentHtml(activeView),
    onOpenProfile,
    user,
  });

  registerViewDisposer(shell, bindAdminFeedbackIndicator(shell));

  shell.querySelectorAll("[data-admin-view]").forEach((item) => {
    item.addEventListener("click", () => onAdminViewChange(item.dataset.adminView));
  });
  bindDropdowns(shell);
  shell.querySelector("[data-back]")?.addEventListener("click", () => onBack("discover"));
  shell.querySelector(".admin-drawer-scrim")?.addEventListener("click", () => document.body.classList.remove("admin-drawer-open"));
  if (activeView === "logs") bindAdminLogs(shell);
  if (activeView === "overview") bindAdminOverview(shell);
  if (activeView === "agents") bindAdminAgents(shell);
  if (activeView === "creatorCharacters") bindAdminCreatorCharacters(shell);
  if (activeView === "commonCharacters") bindAdminCommonCharacters(shell);
  if (activeView === "carousel") bindAdminCarousel(shell);
  if (activeView === "kitshop") bindAdminKitshop(shell);
  if (activeView === "accounts") bindAdminAccounts(shell, { targetAccountId, targetGuestSessionId, onTargetConsumed });
  if (activeView === "feedback") bindAdminFeedback(shell, { onOpenAccount, onOpenGuestSession });
  if (activeView === "kb") bindAdminKnowledge(shell);
  if (activeView === "sites") bindAdminSites(shell);
  if (activeView === "externalEmbeds") bindAdminExternalEmbeds(shell);
  if (activeView === "mascot") bindAdminMascot(shell);
  if (activeView === "promotionCampaigns") bindAdminPromotionCampaigns(shell);
  if (activeView === "codes") bindAdminDiscountCodes(shell);
  if (activeView === "reporting") bindAdminReporting(shell);

  return shell;
}
