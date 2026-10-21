import { CREATE_CATS } from "../../data/demo-data.js";
import { escapeHtml } from "./create-character-html.js";
import { createSiteCopy } from "../../i18n/site-copy.js";

export const PREVIEW_NAME_PLACEHOLDER = "Character name";
export const PREVIEW_ROLE_PLACEHOLDER = "Category · personality";
export const PREVIEW_OPENING_PLACEHOLDER = "Opening line preview";

export function getCreatePreviewModel(createState, category) {
  const previewRole = [category?.label, createState.vibe].filter(Boolean).join(" · ") || PREVIEW_ROLE_PLACEHOLDER;
  return {
    name: createState.name || PREVIEW_NAME_PLACEHOLDER,
    nameIsPlaceholder: !createState.name,
    role: previewRole,
    roleIsPlaceholder: previewRole === PREVIEW_ROLE_PLACEHOLDER,
    opening: createState.openingLine || PREVIEW_OPENING_PLACEHOLDER,
    openingIsPlaceholder: !createState.openingLine,
  };
}

export function renderCreatePreview({ createState, avatarHtml, preview, pageLanguage = "English" }) {
  const copy = createSiteCopy(pageLanguage);
  const name = preview.nameIsPlaceholder ? copy.t("create.previewName") : preview.name;
  const localizedRole = [localizedCategoryLabel(createState?.cat, copy), localizedVibeLabel(createState?.vibe, copy)].filter(Boolean).join(" · ");
  const role = preview.roleIsPlaceholder ? copy.t("create.previewRole") : (localizedRole || preview.role);
  const opening = preview.openingIsPlaceholder ? copy.t("create.previewOpening") : preview.opening;
  return `
    <div class="create-preview">
      <div class="cp-label">${escapeHtml(copy.t("create.livePreview"))}</div>
      <div class="cp-card">
        <div class="cp-avatar">${avatarHtml}</div>
        <div class="cp-name ${preview.nameIsPlaceholder ? "is-placeholder" : ""}" data-create-preview-name>${escapeHtml(name)}</div>
        <div class="cp-role ${preview.roleIsPlaceholder ? "is-placeholder" : ""}" data-create-preview-role>${escapeHtml(role)}</div>
        <div class="cp-bubble ${preview.openingIsPlaceholder ? "is-placeholder" : ""}" data-create-preview-opening>${escapeHtml(opening)}</div>
        <div class="cp-tags"><span>${escapeHtml(copy.t("create.aiCharacter"))}</span><span>${escapeHtml(copy.t("create.youCreated"))}</span></div>
      </div>
    </div>
  `;
}

export function updatePreviewText(element, value, placeholder) {
  if (!element) return;
  const normalizedValue = String(value || "");
  element.textContent = normalizedValue || placeholder;
  element.classList.toggle("is-placeholder", !normalizedValue);
}

export function updatePreviewRole(page, categoryKey, vibeValue, pageLanguage = "English") {
  const copy = createSiteCopy(pageLanguage);
  const role = page.querySelector("[data-create-preview-role]");
  if (!role) return;
  const categoryLabel = localizedCategoryLabel(categoryKey, copy);
  const vibeLabel = localizedVibeLabel(vibeValue, copy);
  const nextValue = [categoryLabel, vibeLabel].filter(Boolean).join(" · ") || copy.t("create.previewRole");
  role.textContent = nextValue;
  role.classList.toggle("is-placeholder", !categoryLabel && !String(vibeValue || ""));
}

function localizedCategoryLabel(categoryKey, copy) {
  const fallback = CREATE_CATS.find((item) => item.key === categoryKey)?.label || "";
  const key = {
    Babe: "create.categoryBabe",
    Creator: "create.categoryCreator",
    Pundit: "create.categoryPundit",
    Fan: "create.categoryFan",
    Companion: "create.categoryCompanion",
  }[categoryKey];
  return key ? copy.t(key) : fallback;
}

function localizedVibeLabel(value, copy) {
  const key = {
    "Hype & loud": "create.vibeHype",
    "Calm mentor": "create.vibeCalm",
    "Cheeky banter": "create.vibeCheeky",
    "Tactical nerd": "create.vibeTactical",
    "Old-school": "create.vibeOldSchool",
  }[String(value || "")];
  return key ? copy.t(key) : String(value || "");
}
