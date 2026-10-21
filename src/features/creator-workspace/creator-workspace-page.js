import { ICONS } from "../../icons/icons.js";
import { createLogo } from "../../pages/login/login-logo.js";
import { createThemeToggle } from "../../pages/login/theme-toggle.js";
import { resolveUserDisplayName, userAvatarHtml } from "../shared-ui/user-avatar.js";
import { mountCreatorDashboard } from "./creator-dashboard-controller.js";
import { getCreatorAnalytics } from "../../services/creator-analytics-service.js";
import { registerViewDisposer } from "../../app/app-view-lifecycle.js";

export function createCreatorWorkspacePage({ user = {}, onBack }) {
  const shell = document.createElement("div");
  const displayName = resolveUserDisplayName(user);
  shell.className = "admin-shell creator-shell";
  shell.innerHTML = `
    <div class="admin-drawer-scrim"></div>
    <aside class="admin-nav creator-nav">
      <div class="an-brand"><span data-logo-slot></span><span class="an-badge creator-badge">Creator</span></div>
      <div class="an-scroll">
        <div class="cw-who">${userAvatarHtml({ user, className: "cw-account-avatar" })}<div><strong>${escapeHtml(displayName)}</strong><small>Creator account</small></div></div>
        <a class="an-item active" aria-current="page"><span>${ICONS.compass}</span><span>My dashboard</span></a>
      </div>
      <a class="an-back" data-back>${ICONS.back}<span>Back to app</span></a>
    </aside>
    <main class="admin-main"><div data-creator-dashboard-root></div></main>
  `;

  const logo = createLogo();
  logo.removeAttribute("href");
  shell.querySelector("[data-logo-slot]")?.replaceWith(logo);
  shell.querySelector(".admin-main")?.prepend(createCreatorTopbar(user, displayName));
  const disposeDashboard = mountCreatorDashboard(
    shell.querySelector("[data-creator-dashboard-root]"),
    { range: "30d", status: "loading" },
    { loadRangeState: getCreatorAnalytics }
  );
  shell.querySelector("[data-back]")?.addEventListener("click", () => onBack?.("discover"));
  shell.querySelector(".admin-drawer-scrim")?.addEventListener("click", closeCreatorDrawer);
  return registerViewDisposer(shell, () => {
    disposeDashboard();
    closeCreatorDrawer();
  });
}

function createCreatorTopbar(user, displayName) {
  const top = document.createElement("div");
  top.className = "admin-top";
  top.innerHTML = `
    <button class="admin-menu" type="button" aria-label="Open menu">${ICONS.menu}</button>
    <h1>Creator dashboard</h1>
    <div class="admin-top-r"><span data-theme-slot></span><div class="admin-user">${userAvatarHtml({ user, className: "admin-user-avatar" })}<span>${escapeHtml(displayName)}</span></div></div>
  `;
  top.querySelector("[data-theme-slot]")?.replaceWith(createThemeToggle());
  top.querySelector(".admin-menu")?.addEventListener("click", () => document.body.classList.toggle("admin-drawer-open"));
  return top;
}

function closeCreatorDrawer() {
  document.body.classList.remove("admin-drawer-open");
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[char]);
}
