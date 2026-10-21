import { getAdminDiscountCodeOptions, listAdminDiscountCodes } from "../../services/discount-code-service.js";
import { bindDropdowns } from "../shared-ui/dropdown.js";
import { adminLogsErrorHtml } from "./admin-console-content.js";
import { adminDiscountCodeFiltersHtml, adminDiscountCodeListHtml } from "./admin-discount-codes-template.js";
import { openDiscountCodeEditor } from "./admin-discount-code-editor.js";

export function bindAdminDiscountCodes(shell) {
  const list = shell.querySelector("[data-discount-code-list]");
  const queryInput = shell.querySelector("[data-discount-code-query]");
  const newButton = shell.querySelector("[data-discount-code-new]");
  if (!list) return;

  let items = [];
  let options = { sites: [], creators: [] };
  let filters = { query: "", site: "", ownershipType: "", status: "" };
  let loadSequence = 0;

  const renderFilters = () => {
    const html = adminDiscountCodeFiltersHtml({ sites: options.sites, ...filters });
    setFilterHtml(shell, "site", html.site);
    setFilterHtml(shell, "owner", html.owner);
    setFilterHtml(shell, "status", html.status);
    bindDropdowns(shell);
    bindFilter(shell, "discountCodeSite", "site", load);
    bindFilter(shell, "discountCodeOwner", "ownershipType", load);
    bindFilter(shell, "discountCodeStatus", "status", load);
  };

  const load = async () => {
    const sequence = ++loadSequence;
    list.innerHTML = `<div class="log-empty">正在加载折扣码...</div>`;
    try {
      const result = await listAdminDiscountCodes(filters);
      if (sequence !== loadSequence) return;
      items = result.items;
      list.innerHTML = adminDiscountCodeListHtml(items);
    } catch (error) {
      if (sequence !== loadSequence) return;
      list.innerHTML = adminLogsErrorHtml(error.message || "折扣码列表读取失败");
    }
  };

  const openEditor = (item = null) => {
    openDiscountCodeEditor({ item, options, onSaved: load });
  };

  list.addEventListener("click", (event) => {
    const edit = event.target.closest("[data-discount-code-edit]");
    if (!edit) return;
    event.preventDefault();
    const item = items.find((current) => current.id === edit.dataset.discountCodeEdit);
    if (item) openEditor(item);
  });
  newButton?.addEventListener("click", () => openEditor());
  queryInput?.addEventListener("input", () => {
    filters.query = String(queryInput.value || "").trim();
    window.clearTimeout(queryInput.__discountCodeTimer || 0);
    queryInput.__discountCodeTimer = window.setTimeout(load, 250);
  });

  void (async () => {
    try {
      options = await getAdminDiscountCodeOptions();
      renderFilters();
      await load();
    } catch (error) {
      list.innerHTML = adminLogsErrorHtml(error.message || "折扣码页面初始化失败");
    }
  })();

  function bindFilter(root, inputName, filterName, onChange) {
    root.querySelector(`[name="${inputName}"]`)?.addEventListener("change", (event) => {
      filters[filterName] = event.target.value || "";
      void onChange();
    });
  }
}

function setFilterHtml(shell, name, html) {
  const host = shell.querySelector(`[data-discount-code-${name}-filter]`);
  if (host) host.innerHTML = html;
}
