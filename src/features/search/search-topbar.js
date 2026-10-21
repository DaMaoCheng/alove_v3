import { ICONS } from "../../icons/icons.js";
import { createSiteCopy } from "../../i18n/site-copy.js";

export function createSearchTopbar({ query, pageLanguage = "English", onQueryChange, onCancel }) {
  const copy = createSiteCopy(pageLanguage);
  const topbar = document.createElement("div");
  topbar.className = "topbar search-topbar";
  topbar.innerHTML = `
    <button class="menu-btn" aria-label="${copy.t("common.openMenu")}">${ICONS.menu}</button>
    <div class="search-topbar-inner">
      <div class="search search-active">
        ${ICONS.search}
        <input id="searchInput" autocomplete="off" placeholder="${copy.t("search.placeholder")}" value="${escapeAttr(query)}" />
        <button class="search-x" type="button" aria-label="${copy.t("search.clear")}" ${query ? "" : "hidden"}>${ICONS.close}</button>
      </div>
      <button class="btn btn-ghost search-cancel" type="button">${copy.t("search.cancel")}</button>
    </div>
  `;
  topbar.querySelector(".menu-btn")?.addEventListener("click", () => document.body.classList.toggle("drawer-open"));
  const input = topbar.querySelector("#searchInput");
  const clearButton = topbar.querySelector(".search-x");
  input?.addEventListener("input", (event) => {
    const nextQuery = event.target.value;
    document.body.classList.remove("product-open");
    if (clearButton) clearButton.hidden = !nextQuery;
    onQueryChange?.(nextQuery);
  });
  clearButton?.addEventListener("click", () => {
    if (input instanceof HTMLInputElement) {
      input.value = "";
      input.focus();
    }
    document.body.classList.remove("product-open");
    clearButton.hidden = true;
    onQueryChange?.("");
  });
  topbar.querySelector(".search-cancel")?.addEventListener("click", () => {
    document.body.classList.remove("product-open");
    onCancel?.("discover");
  });
  return topbar;
}

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}
