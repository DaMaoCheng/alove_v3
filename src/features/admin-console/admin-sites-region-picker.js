import { searchAdminGeoRegions } from "../../services/admin-site-service.js";

export function bindSiteRegionPicker(host, { getRegions = () => [], setRegions = () => {} } = {}) {
  const picker = host.querySelector("[data-site-region-picker]");
  if (!picker) return;
  const input = picker.querySelector("[data-site-region-value]");
  const tags = picker.querySelector("[data-site-region-tags]");
  const search = picker.querySelector("[data-site-region-search]");
  const optionsHost = picker.querySelector("[data-site-region-options]");
  const trigger = picker.querySelector("[data-site-region-trigger]");
  const menu = picker.querySelector("[data-site-region-menu]");
  const selected = new Set(String(input?.value || "").split(",").map((item) => item.trim()).filter(Boolean));
  let open = false;
  let lastQuery = "";
  let searching = false;
  let message = "";

  const render = () => {
    const regions = getRegions();
    const query = String(search?.value || "").trim().toLowerCase();
    const matches = filterRegions(regions, query);
    if (input) input.value = Array.from(selected).join(",");
    renderTags(tags, regions, selected);
    picker.classList.toggle("is-open", open);
    trigger?.setAttribute("aria-expanded", open ? "true" : "false");
    if (menu) menu.hidden = !open;
    if (!optionsHost) return;
    optionsHost.innerHTML = [
      ...matches.map((region) => regionOptionHtml(region, regions, selected.has(region.id))),
      onlineSearchHtml({ query, searching, message, hasLocalMatches: matches.length > 0 }),
    ].join("");
  };

  optionsHost?.addEventListener("click", async (event) => {
    const option = event.target.closest("[data-site-region-option]");
    if (option) {
      const id = option.dataset.siteRegionOption || "";
      if (selected.has(id)) selected.delete(id);
      else selected.add(id);
      render();
      return;
    }
    const online = event.target.closest("[data-site-region-online]");
    if (!online || searching) return;
    const query = String(search?.value || "").trim();
    if (query.length < 2) return;
    searching = true;
    message = "";
    render();
    try {
      const result = await searchAdminGeoRegions(query);
      setRegions(result.regions || []);
      message = result.message || (result.items?.length ? "已更新地区库" : "未找到匹配地区");
    } catch (error) {
      message = error.message || "在线搜索失败";
    } finally {
      searching = false;
      render();
    }
  });

  tags?.addEventListener("click", (event) => {
    const remove = event.target.closest("[data-site-region-remove]");
    if (!remove) return;
    event.stopPropagation();
    selected.delete(remove.dataset.siteRegionRemove || "");
    render();
  });

  search?.addEventListener("input", () => {
    const query = String(search.value || "").trim();
    if (query !== lastQuery) message = "";
    lastQuery = query;
    render();
  });

  trigger?.addEventListener("click", () => {
    open = !open;
    render();
    if (open) window.setTimeout(() => search?.focus(), 0);
  });

  trigger?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    trigger.click();
  });

  host.addEventListener("click", (event) => {
    if (picker.contains(event.target)) return;
    if (!open) return;
    open = false;
    render();
  });

  render();
}

export function mergeRegions(current = [], next = []) {
  const map = new Map();
  [...current, ...next].forEach((region) => {
    if (region?.id) map.set(region.id, region);
  });
  return Array.from(map.values()).sort((left, right) => Number(left.displayOrder || 0) - Number(right.displayOrder || 0));
}

function filterRegions(regions = [], query = "") {
  const normalized = String(query || "").trim().toLowerCase();
  if (!normalized) return regions;
  return regions.filter((region) => regionSearchText(region).includes(normalized));
}

function renderTags(host, regions, selected) {
  if (!host) return;
  const selectedRegions = regions.filter((region) => selected.has(region.id));
  host.innerHTML = selectedRegions.length
    ? selectedRegions.map((region) => `<button type="button" data-site-region-remove="${escapeAttr(region.id)}">${escapeHtml(regionPathLabel(region, regions))}<span>×</span></button>`).join("")
    : `<span class="muted">未指定，使用默认站点兜底</span>`;
}

function regionOptionHtml(region, regions, active) {
  return `<button class="site-region-option ${active ? "is-active" : ""}" type="button" data-site-region-option="${escapeAttr(region.id)}"><span>${escapeHtml(regionPathLabel(region, regions))}</span><small>${escapeHtml(region.code || "")}</small></button>`;
}

function onlineSearchHtml({ query, searching, message, hasLocalMatches }) {
  if (!query || query.length < 2) return "";
  const label = searching ? "搜索中..." : hasLocalMatches ? "继续在线搜索" : "在线搜索";
  return `<div class="site-region-online"><button class="btn btn-ghost sm" type="button" data-site-region-online ${searching ? "disabled" : ""}>${label}</button>${message ? `<span>${escapeHtml(message)}</span>` : ""}</div>`;
}

function regionPathLabel(region, regions = []) {
  const chain = [];
  let current = region;
  const byId = new Map(regions.map((item) => [item.id, item]));
  while (current?.id) {
    chain.unshift(regionLabel(current));
    current = byId.get(current.parentId);
  }
  return chain.join(" / ") || regionLabel(region);
}

function regionLabel(region = {}) {
  return region.nameZh || region.nameEn || region.code || region.id || "-";
}

function regionSearchText(region = {}) {
  return [region.id, region.code, region.nameZh, region.nameEn, ...(region.aliases || [])].join(" ").toLowerCase();
}

function escapeHtml(value = "") {
  return String(value == null ? "" : value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[char]);
}

function escapeAttr(value = "") {
  return escapeHtml(value);
}
