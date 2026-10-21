import { ICONS } from "../../icons/icons.js";
import { createLogo } from "../../pages/login/login-logo.js";
import { characterAvatarHtml } from "../shared-ui/character-avatar.js";
import { resolveUserDisplayName, userAvatarHtml } from "../shared-ui/user-avatar.js";
import { collapseSidebarRail, expandSidebarRail } from "./sidebar-rail.js";
import { createSiteCopy } from "../../i18n/site-copy.js";
import { bindGuestDiscoverGuide, guestDiscoverGuideHtml, shouldRenderGuestDiscoverGuide } from "./guest-discover-guide.js";

const SHOW_KIT_SHOP_ENTRY = true;

export function createSidebar({ view, agent, accountType = "personal", user = {}, contacts = [], guestMode = false, pageLanguage = "English", onNavigate, onOpenProfile }) {
  const copy = createSiteCopy(pageLanguage);
  const canSeeCreator = accountType === "creator";
  const canSeeAdmin = accountType === "admin";
  const displayName = escapeHtml(guestMode ? copy.t("nav.guest") : resolveUserDisplayName(user));
  const email = escapeHtml(guestMode ? copy.t("nav.loginOrRegister") : (user.email || copy.t("nav.signedIn")));
  const showGuestDiscoverGuide = guestMode && shouldRenderGuestDiscoverGuide();
  const wrap = document.createElement("div");
  wrap.innerHTML = `
    <div class="drawer-scrim"></div>
    <aside class="sidebar${showGuestDiscoverGuide ? " has-guest-discover-guide" : ""}">
      <button class="drawer-close" type="button" aria-label="${escapeAttribute(copy.t("nav.close"))}">${ICONS.close}</button>
      <div class="sidebar-head">
        <span class="logo-tap"></span>
        <button class="rail-toggle" type="button" aria-label="${escapeAttribute(copy.t("nav.collapse"))}">${ICONS.rail}</button>
      </div>
      <div class="sidebar-scroll">
        ${navItem("discover", ICONS.compass, copy.t("nav.discover"), view === "discover")}
        ${guestMode ? "" : navItem("create", ICONS.spark, copy.t("nav.create"), view === "create")}
        ${SHOW_KIT_SHOP_ENTRY ? navItem("kitshop", ICONS.shop, copy.t("nav.kitshop"), view === "kitshop") : ""}
        ${canSeeCreator ? `<a class="nav-item ${view === "creator" ? "active" : ""}" data-key="creator" data-view="creator">${ICONS.spark}<span>${escapeHtml(copy.t("nav.creator"))}</span></a>` : ""}
        ${canSeeAdmin ? `<a class="nav-item" data-key="admin" data-view="admin">${ICONS.shield || ICONS.wallet}<span>${escapeHtml(copy.t("nav.admin"))}</span></a>` : ""}
        <div class="nav-sep"></div>
        ${contacts.map((contact) => renderContactNavItem({ contact, view, agent, copy })).join("")}
        ${guestMode ? `<a class="nav-item nav-create-mini" data-view="register">${ICONS.plus}<span>${escapeHtml(copy.t("nav.createAccount"))}</span></a>` : `<a class="nav-item nav-create-mini" data-view="create">${ICONS.plus}<span>${escapeHtml(copy.t("nav.createCharacter"))}</span></a>`}
      </div>
      <button class="user-tile" type="button" aria-label="${escapeAttribute(guestMode ? copy.t("nav.loginOrRegister") : copy.t("nav.profile"))}" data-guest-mode="${guestMode ? "true" : "false"}">
        ${userAvatarHtml({ user, className: "user-avatar" })}
        <div class="ut-text"><div class="u-name">${displayName}</div><div class="u-meta">${email}</div></div>
      </button>
      ${showGuestDiscoverGuide ? guestDiscoverGuideHtml(copy.t("nav.moreCharacters")) : ""}
    </aside>
  `;

  const sidebarLogo = createLogo();
  sidebarLogo.removeAttribute("href");
  sidebarLogo.setAttribute("role", "button");
  sidebarLogo.tabIndex = 0;
  wrap.querySelector(".logo-tap")?.append(sidebarLogo);
  bindSidebarEvents(wrap, { guestMode, onNavigate, onOpenProfile });
  if (showGuestDiscoverGuide) bindGuestDiscoverGuide(wrap);

  const fragment = document.createDocumentFragment();
  fragment.append(...wrap.childNodes);
  return fragment;
}

function bindSidebarEvents(root, { guestMode, onNavigate, onOpenProfile }) {
  root.querySelectorAll("[data-view]").forEach((item) => {
    item.addEventListener("click", (event) => {
      event.preventDefault();
      onNavigate(item.dataset.view, item.dataset.agent);
    });
  });
  root.querySelector(".rail-toggle")?.addEventListener("click", (event) => {
    event.preventDefault();
    collapseSidebarRail();
  });
  root.querySelector(".logo-tap")?.addEventListener("click", (event) => {
    event.preventDefault();
    expandSidebarRail();
  });
  root.querySelector(".logo-tap")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      expandSidebarRail();
    }
  });
  root.querySelector(".drawer-close")?.addEventListener("click", (event) => {
    event.preventDefault();
    document.body.classList.remove("drawer-open");
  });
  root.querySelector(".drawer-scrim")?.addEventListener("click", () => document.body.classList.remove("drawer-open"));
  root.querySelector(".user-tile")?.addEventListener("click", (event) => {
    event.preventDefault();
    if (guestMode) onNavigate?.("login");
    else onOpenProfile?.("profile");
  });
}

function navItem(key, icon, label, active) {
  return `<a class="nav-item ${active ? "active" : ""}" data-view="${key}">${icon}<span>${label}</span></a>`;
}

function renderContactNavItem({ contact, view, agent, copy }) {
  const characterId = escapeAttribute(contact.characterId || "");
  const active = view === "chat" && agent === contact.characterId;
  return `
    <a class="nav-item ${active ? "active" : ""}" data-view="chat" data-agent="${characterId}">
      <span class="nav-av-wrap${contact.unread ? " has-msg" : ""}">${characterAvatarHtml({ name: contact.name, imageUrl: contact.avatarUrl, className: "nav-av" })}</span><span class="nav-legend-name">${escapeHtml(contact.name || "AIOVE Character")}</span>${ownCharacterTagHtml(contact, copy)}${privateTagHtml(contact, copy)}${unavailableTagHtml(contact, copy)}
    </a>
  `;
}

function ownCharacterTagHtml(entity = {}, copy) {
  if (!entity.isOwnCharacter) return "";
  return `<span class="own-character-tag" aria-label="${escapeAttribute(copy.t("create.ownCharacter"))}" title="${escapeAttribute(copy.t("create.ownCharacter"))}">${ICONS.user}</span>`;
}

function privateTagHtml(entity = {}, copy) {
  if (entity.visibility !== "private") return "";
  return `<span class="priv-tag" title="${escapeAttribute(copy.t("create.privateHint"))}">${ICONS.lock}<span>${escapeHtml(copy.t("create.private"))}</span></span>`;
}

function unavailableTagHtml(entity = {}, copy) {
  if (String(entity.characterStatus || entity.status || "").trim().toLowerCase() !== "archived") return "";
  return `<span class="unavailable-tag" aria-label="${escapeAttribute(copy.t("create.unavailable"))}" title="${escapeAttribute(copy.t("create.unavailable"))}">!</span>`;
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

function escapeAttribute(value = "") {
  return escapeHtml(value);
}
