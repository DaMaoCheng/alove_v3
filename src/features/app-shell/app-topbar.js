import { ICONS } from "../../icons/icons.js";
import { createThemeToggle } from "../../pages/login/theme-toggle.js";
import { bindNotifications, notificationBellHtml } from "../notifications/notification-panel.js";
import { createSiteCopy } from "../../i18n/site-copy.js";

export function createTopbar(placeholder, { guestMode = false, pageLanguage = "English" } = {}) {
  const copy = createSiteCopy(pageLanguage);
  const topbar = document.createElement("div");
  topbar.className = "topbar";
  topbar.innerHTML = `
    <button class="menu-btn" aria-label="${copy.t("common.openMenu")}">${ICONS.menu}</button>
    <button class="search search-trigger" type="button" aria-label="${copy.t("common.search")}" data-search-trigger>${ICONS.search}<span class="search-ph"><span>${placeholder}</span></span></button>
    <div class="topbar-spacer"></div>
    <div class="topbar-actions"><span data-theme-slot></span>${notificationBellHtml({ guestMode, pageLanguage })}</div>
  `;
  topbar.querySelector("[data-theme-slot]")?.replaceWith(createThemeToggle());
  topbar.querySelector(".menu-btn")?.addEventListener("click", () => {
    document.body.classList.toggle("drawer-open");
  });
  topbar.querySelector("[data-search-trigger]")?.addEventListener("click", () => {
    window.dispatchEvent(new CustomEvent("aiove:navigate", { detail: { view: "search" } }));
  });
  bindNotifications(topbar, { guestMode, pageLanguage });
  return topbar;
}
