import { ICONS } from "../../icons/icons.js";
import { createLogo } from "../../pages/login/login-logo.js";
import { createThemeToggle } from "../../pages/login/theme-toggle.js";
import { resolveUserDisplayName, userAvatarHtml } from "../shared-ui/user-avatar.js";
import { ADMIN_NAV, titleForAdminView } from "./admin-console-data.js";

export function createAdminShell({ activeView, contentHtml, onOpenProfile, user = {} }) {
  const shell = document.createElement("div");
  shell.className = "admin-shell";
  shell.innerHTML = `
    <div class="admin-drawer-scrim"></div>
    <aside class="admin-nav">
      <div class="an-brand"><span data-logo-slot></span><span class="an-badge">后台</span></div>
      <div class="an-scroll">
        ${ADMIN_NAV.map(([key, icon, label]) => `<a class="an-item ${activeView === key ? "active" : ""}" data-admin-view="${key}">${icon}<span>${label}</span>${key === "feedback" ? `<i class="admin-feedback-dot" data-admin-feedback-indicator hidden aria-label="有未处理反馈"></i>` : ""}</a>`).join("")}
      </div>
      <a class="an-back" data-back>${ICONS.back}<span>返回应用</span></a>
    </aside>
    <div class="admin-main" id="adminMain">${contentHtml}</div>
  `;

  const logo = createLogo();
  logo.removeAttribute("href");
  shell.querySelector("[data-logo-slot]")?.replaceWith(logo);
  shell.querySelector(".admin-main")?.prepend(createAdminTopbar({ title: titleForAdminView(activeView), onOpenProfile, user }));
  return shell;
}

function createAdminTopbar({ title, onOpenProfile, user }) {
  const top = document.createElement("div");
  top.className = "admin-top";
  const displayName = resolveUserDisplayName(user);
  top.innerHTML = `
    <button class="admin-menu" aria-label="打开菜单">${ICONS.menu}</button>
    <h1>${escapeHtml(title)}</h1>
    <div class="admin-top-r"><span data-theme-slot></span><button class="admin-user" type="button" aria-label="打开账号资料">${userAvatarHtml({ user, className: "admin-user-avatar" })}<span>${escapeHtml(resolveAccountLabel(user.accountType))} · ${escapeHtml(displayName)}</span></button></div>
  `;
  top.querySelector("[data-theme-slot]")?.replaceWith(createThemeToggle());
  top.querySelector(".admin-menu")?.addEventListener("click", () => document.body.classList.toggle("admin-drawer-open"));
  top.querySelector(".admin-user")?.addEventListener("click", () => onOpenProfile?.("profile"));
  return top;
}

function resolveAccountLabel(accountType = "") {
  if (accountType === "admin") return "运营";
  if (accountType === "creator") return "创作者";
  return "用户";
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[char]);
}
