import { ICONS } from "../../icons/icons.js";
import { characterAvatarHtml } from "../shared-ui/character-avatar.js";
import { createSiteCopy } from "../../i18n/site-copy.js";

let escapeHandler = null;

export function openDiscoverCharacterConfirm({ character, pageLanguage = "English", confirmText = "", onConfirm } = {}) {
  if (!character?.id) {
    onConfirm?.();
    return;
  }

  closeDiscoverCharacterConfirm();
  const copy = createSiteCopy(pageLanguage);
  const host = characterHost();
  host.innerHTML = `
    <div class="cm-scrim" data-character-close></div>
    <div class="char-modal" role="dialog" aria-modal="true" aria-label="${escapeHtml(copy.t("discover.preview"))}">
      <button class="cm-x" type="button" data-character-close aria-label="${escapeHtml(copy.t("common.close"))}">${ICONS.close}</button>
      <div class="dcm-card">
        <div class="dcm-avatar">${characterAvatarHtml({ name: character.name, imageUrl: character.avatarUrl })}</div>
        <div class="dcm-name">${escapeHtml(character.name)}</div>
        <div class="dcm-role">${escapeHtml(character.roleTitle || copy.t("discover.fallbackRole"))}</div>
        <div class="dcm-bubble">${escapeHtml(character.openingLine || copy.t("discover.fallbackOpening"))}</div>
      </div>
      <div class="cm-actions">
        <button class="btn btn-ghost" type="button" data-character-close>${escapeHtml(copy.t("discover.cancel"))}</button>
        <button class="btn btn-primary" type="button" data-character-confirm>${ICONS.chat}<span>${escapeHtml(confirmText || copy.t("common.start"))}</span></button>
      </div>
    </div>`;
  document.body.classList.add("char-open");

  host.querySelectorAll("[data-character-close]").forEach((element) => {
    element.addEventListener("click", closeDiscoverCharacterConfirm);
  });
  host.querySelector("[data-character-confirm]")?.addEventListener("click", () => {
    closeDiscoverCharacterConfirm();
    onConfirm?.();
  });

  escapeHandler = (event) => {
    if (event.key === "Escape") closeDiscoverCharacterConfirm();
  };
  document.addEventListener("keydown", escapeHandler);
}

export function closeDiscoverCharacterConfirm() {
  document.body.classList.remove("char-open");
  const host = document.getElementById("charHost");
  if (host) host.innerHTML = "";
  if (escapeHandler) {
    document.removeEventListener("keydown", escapeHandler);
    escapeHandler = null;
  }
}

function characterHost() {
  let host = document.getElementById("charHost");
  if (!host) {
    host = document.createElement("div");
    host.id = "charHost";
    document.body.appendChild(host);
  }
  return host;
}

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
