import { listAdminSites } from "../../services/admin-site-service.js";
import { listAdminPromotionCampaigns } from "../../services/promotion-campaign-service.js";
import { bindDropdowns } from "../shared-ui/dropdown.js";
import { adminLogsErrorHtml } from "./admin-console-content.js";
import {
  adminPromotionCampaignFiltersHtml,
  adminPromotionCampaignListHtml,
} from "./admin-console-promotion-campaigns-template.js";
import { openPromotionCampaignEditor } from "./admin-promotion-campaigns-editor.js";

export function bindAdminPromotionCampaigns(shell) {
  const list = shell.querySelector("[data-promotion-campaign-list]");
  const queryInput = shell.querySelector("[data-promotion-campaign-query]");
  const siteFilterHost = shell.querySelector("[data-promotion-campaign-site-filter]");
  const statusFilterHost = shell.querySelector("[data-promotion-campaign-status-filter]");
  const newButton = shell.querySelector("[data-promotion-campaign-new]");
  if (!list) return;

  let items = [];
  let sites = [];
  let filters = { query: "", site: "", status: "" };

  const renderFilters = () => {
    const html = adminPromotionCampaignFiltersHtml({ sites, site: filters.site, status: filters.status });
    if (siteFilterHost) siteFilterHost.innerHTML = html.site;
    if (statusFilterHost) statusFilterHost.innerHTML = html.status;
    bindDropdowns(shell);
    shell.querySelector('[name="promotionCampaignSite"]')?.addEventListener("change", () => {
      filters.site = shell.querySelector('[name="promotionCampaignSite"]')?.value || "";
      void load();
    });
    shell.querySelector('[name="promotionCampaignStatus"]')?.addEventListener("change", () => {
      filters.status = shell.querySelector('[name="promotionCampaignStatus"]')?.value || "";
      void load();
    });
  };

  const render = () => {
    list.innerHTML = adminPromotionCampaignListHtml(items);
  };

  const openEditor = (item = null) => {
    openPromotionCampaignEditor({
      item,
      sites,
      onSaved: async () => {
        await load();
      },
    });
  };

  const load = async () => {
    list.innerHTML = `<div class="log-empty">正在加载活动...</div>`;
    try {
      const result = await listAdminPromotionCampaigns(filters);
      items = result.items || [];
      render();
    } catch (error) {
      list.innerHTML = adminLogsErrorHtml(error.message || "活动列表读取失败");
    }
  };

  const boot = async () => {
    try {
      const siteResult = await listAdminSites();
      sites = siteResult.items || [];
      renderFilters();
      await load();
    } catch (error) {
      list.innerHTML = adminLogsErrorHtml(error.message || "活动页面初始化失败");
    }
  };

  list.addEventListener("click", (event) => {
    const editButton = event.target.closest("[data-promotion-campaign-edit]");
    if (!editButton) return;
    event.preventDefault();
    const item = items.find((current) => current.id === editButton.dataset.promotionCampaignEdit);
    if (item) openEditor(item);
  });

  newButton?.addEventListener("click", () => openEditor(null));
  queryInput?.addEventListener("input", () => {
    filters.query = String(queryInput.value || "").trim();
    window.clearTimeout(queryInput.__promotionCampaignTimer || 0);
    queryInput.__promotionCampaignTimer = window.setTimeout(() => {
      void load();
    }, 250);
  });

  boot();
}
