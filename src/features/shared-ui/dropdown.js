import { ICONS } from "../../icons/icons.js";
import { createSiteCopy } from "../../i18n/site-copy.js";

export function dropdownHtml({ triggerHtml, items = [], align = "left", className = "" } = {}) {
  return `
    <div class="dd ${className}" data-dd>
      <button class="dd-trigger" type="button" data-dd-trigger>${triggerHtml}${ICONS.chevron || ""}</button>
      <div class="dd-menu dd-${align === "right" ? "right" : "left"}" role="menu">
        ${items.map(renderDropdownItem).join("")}
      </div>
    </div>
  `;
}

export function selectDropdownHtml({ name, value = "", items = [], placeholder = "Select", align = "left", className = "" } = {}) {
  const copy = createSiteCopy(globalThis.document?.documentElement?.lang || "English");
  const normalizedValue = String(value || "");
  const normalizedItems = items.map(([itemValue, label, icon, count]) => ({
    value: String(itemValue || ""),
    action: String(itemValue || ""),
    label,
    icon,
    count,
    active: String(itemValue || "") === normalizedValue,
  }));
  const selected = normalizedItems.find((item) => item.active);
  return `
    <div class="dd dd-select ${className}" data-dd data-dd-select>
      <input type="hidden" name="${escapeAttr(name || "")}" value="${escapeAttr(normalizedValue)}" data-dd-input />
      <button class="dd-trigger dd-select-trigger" type="button" data-dd-trigger>
        <span data-dd-current>${escapeHtml(selected?.label || (placeholder === "Select" ? copy.t("common.select") : placeholder))}</span>${ICONS.chevron || ""}
      </button>
      <div class="dd-menu dd-${align === "right" ? "right" : "left"}" role="menu">
        ${normalizedItems.map(renderDropdownItem).join("")}
      </div>
    </div>
  `;
}

export function bindDropdowns(root = document) {
  root.querySelectorAll("[data-dd-trigger]").forEach((trigger) => {
    if (trigger.dataset.ddBound === "true") return;
    trigger.dataset.ddBound = "true";
    trigger.addEventListener("click", (event) => {
      event.stopPropagation();
      const wrap = trigger.closest("[data-dd]");
      const isOpen = wrap?.classList.contains("open");
      closeDropdowns();
      if (!isOpen && wrap) {
        wrap.classList.add("open");
        setMenuWidth(wrap);
      }
    });
  });

  root.querySelectorAll("[data-dd-action]").forEach((item) => {
    if (item.dataset.ddItemBound === "true") return;
    item.dataset.ddItemBound = "true";
    item.addEventListener("click", (event) => {
      if (event.target.closest("[data-dd-leading-action]")) return;
      const wrap = item.closest("[data-dd]");
      if (wrap?.hasAttribute("data-dd-select")) {
        updateSelectDropdown(wrap, item);
      }
      closeDropdowns();
    });
  });

  if (!window.__aioveDropdownBound) {
    window.__aioveDropdownBound = true;
    document.addEventListener("click", closeDropdowns);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeDropdowns();
    });
  }
}

export function closeDropdowns() {
  document.querySelectorAll("[data-dd].open").forEach((item) => item.classList.remove("open"));
}

function renderDropdownItem(item) {
  if (item === "separator" || item?.separator) return `<div class="dd-sep"></div>`;
  const classes = ["dd-item"];
  if (item.active) classes.push("is-active");
  if (item.danger) classes.push("is-danger");
  const icon = item.icon ? `<span class="dd-ic" data-dd-leading-action>${item.icon}</span>` : "";
  const check = item.active ? `<span class="dd-check">${ICONS.check || ""}</span>` : "";
  const countHtml = item.count && Number.isFinite(Number(item.count.total))
    ? `<span class="dd-count" aria-label="${escapeAttr(`${Number(item.count.active || 0)} / ${Number(item.count.total || 0)}`)}"><strong>${escapeHtml(Number(item.count.active || 0).toLocaleString("zh-CN"))}</strong><small>/${escapeHtml(Number(item.count.total || 0).toLocaleString("zh-CN"))}</small></span>`
    : "";
  return `<button class="${classes.join(" ")}" type="button" role="menuitem" data-dd-action="${escapeAttr(item.action || "")}" data-dd-value="${escapeAttr(item.value || item.action || "")}">${icon}<span class="dd-label">${escapeHtml(item.label || "")}</span>${countHtml}${check}</button>`;
}

function setMenuWidth(wrap) {
  const trigger = wrap.querySelector("[data-dd-trigger]");
  const menu = wrap.querySelector(".dd-menu");
  if (trigger && menu) {
    menu.style.minWidth = `${trigger.getBoundingClientRect().width}px`;
  }
}

function updateSelectDropdown(wrap, item) {
  const input = wrap.querySelector("[data-dd-input]");
  const current = wrap.querySelector("[data-dd-current]");
  const value = item.dataset.ddValue || item.dataset.ddAction || "";
  const label = item.querySelector(".dd-label")?.textContent || "";
  if (input) {
    input.value = value;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }
  if (current) current.textContent = label;
  wrap.querySelectorAll(".dd-item").forEach((button) => {
    const active = button === item;
    button.classList.toggle("is-active", active);
    button.querySelector(".dd-check")?.remove();
    if (active) {
      button.insertAdjacentHTML("beforeend", `<span class="dd-check">${ICONS.check || ""}</span>`);
    }
  });
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
