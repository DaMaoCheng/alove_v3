import { listAdminSites, setDefaultAdminSite } from "../../services/admin-site-service.js";
import { listAdminMascotSettings } from "../../services/admin-mascot-service.js";
import { showToast } from "../shared-ui/toast.js";
import { adminLogsErrorHtml } from "./admin-console-content.js";
import { adminSitesTableHtml } from "./admin-console-sites-template.js";
import { openSiteEditor } from "./admin-sites-editor.js";

export function bindAdminSites(shell) {
  const table = shell.querySelector("[data-sites-table]");
  if (!table) return;

  let items = [];
  let regions = [];
  let mascots = [];

  const sortSites = () => {
    items.sort((left, right) => {
      if (left.isDefault !== right.isDefault) return left.isDefault ? -1 : 1;
      return String(left.name || "").localeCompare(String(right.name || ""));
    });
  };

  const renderTable = () => {
    table.innerHTML = adminSitesTableHtml({ items });
  };

  const applySavedSite = (saved, previousId = "") => {
    if (!saved) return;
    items = previousId
      ? items.map((item) => item.id === saved.id ? saved : item)
      : [...items, saved];
    sortSites();
    renderTable();
  };

  const openEditor = (site = null) => openSiteEditor(site, {
    regions,
    mascots,
    setRegions: (nextRegions) => { regions = nextRegions; },
    onSaved: applySavedSite,
  });

  const setDefaultSite = async (siteId, button) => {
    if (!siteId || button?.disabled) return;
    const originalText = button?.textContent || "设为默认";
    if (button) {
      button.disabled = true;
      button.textContent = "设置中...";
    }
    try {
      const result = await setDefaultAdminSite(siteId);
      const saved = result.item;
      if (saved) {
        items = items.map((item) => ({
          ...item,
          isDefault: item.id === saved.id,
          ...(item.id === saved.id ? saved : {}),
        }));
        sortSites();
        renderTable();
      }
      showToast("默认站点已更新");
    } catch (error) {
      showToast(error.message || "默认站点设置失败");
      if (button) {
        button.disabled = false;
        button.textContent = originalText;
      }
    }
  };

  const load = async () => {
    table.innerHTML = adminSitesTableHtml({ loading: true });
    try {
      const [result, mascotResult] = await Promise.all([
        listAdminSites(),
        listAdminMascotSettings().catch(() => null),
      ]);
      items = result.items || [];
      regions = result.regions || [];
      mascots = collectSiteMascotOptions(mascotResult);
      sortSites();
      renderTable();
    } catch (error) {
      table.innerHTML = adminLogsErrorHtml(error.message || "站点列表读取失败");
    }
  };

  shell.addEventListener("click", (event) => {
    const newSiteButton = event.target.closest("[data-site-new]");
    if (newSiteButton) {
      event.preventDefault();
      openEditor(null);
      return;
    }

    const editButton = event.target.closest("[data-site-edit]");
    if (editButton) {
      event.preventDefault();
      const site = items.find((item) => item.id === editButton.dataset.siteEdit);
      if (site) openEditor(site);
      return;
    }

    const defaultButton = event.target.closest("[data-site-default]");
    if (!defaultButton) return;
    event.preventDefault();
    void setDefaultSite(defaultButton.dataset.siteDefault, defaultButton);
  });

  load();
}

function collectSiteMascotOptions(result = null) {
  const choices = new Map();
  const add = (mascot) => {
    const id = String(mascot?.id || "").trim();
    if (!id || choices.has(id)) return;
    choices.set(id, {
      id,
      name: String(mascot?.name || "").trim(),
      avatarUrl: String(mascot?.avatarUrl || "").trim(),
    });
  };
  add(result?.template);
  (result?.sites || []).forEach((site) => add(site?.mascot));
  (result?.unboundMascots || []).forEach(add);
  return Array.from(choices.values()).sort((left, right) => left.name.localeCompare(right.name, "zh-CN") || left.id.localeCompare(right.id));
}
