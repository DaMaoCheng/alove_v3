import { profileModalBodyHtml, profileModalHtml } from "./profile-modal-content.js";
import { bindProfileModalEvents } from "./profile-modal-events.js";

export function createProfileModal({ tab, user, profileState = {}, pageLanguage = "English", onClose, onTabChange, onNavigate, onSave, onOrderOpen, onOrderBack, onLogout }) {
  const host = document.createElement("div");
  host.className = "profile-host";
  host.innerHTML = profileModalHtml(tab, user, profileState, pageLanguage);
  bindProfileModalEvents(host, { onClose, onTabChange, onNavigate, onSave, onOrderOpen, onOrderBack, onLogout });
  return host;
}

export function updateProfileModal(host, { tab, user, profileState = {}, pageLanguage = "English" } = {}) {
  const activeTab = normalizeProfileTab(tab);
  const body = host?.querySelector?.(".pm-body");
  if (!body) return false;

  host.querySelectorAll("[data-profile-tab]").forEach((button) => {
    button.classList.toggle("active", button.dataset.profileTab === activeTab);
  });
  body.innerHTML = profileModalBodyHtml(activeTab, user, profileState, pageLanguage);
  return true;
}

function normalizeProfileTab(tab = "profile") {
  return tab === "invite" || tab === "orders" ? tab : "profile";
}
