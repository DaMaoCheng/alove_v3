import { ICONS } from "../../icons/icons.js";

export const VISIBILITY_OPTIONS = Object.freeze([
  {
    value: "private",
    isPublic: false,
    icon: ICONS.lock,
    title: "Private character",
    text: "Only you can see and chat with this character.",
  },
  {
    value: "public",
    isPublic: true,
    icon: ICONS.globe,
    title: "Public character",
    text: "Anyone can find this character in the Square and search.",
  },
]);

export function getVisibilityCopy(isPublic) {
  return VISIBILITY_OPTIONS.find((item) => item.isPublic === Boolean(isPublic)) || VISIBILITY_OPTIONS[0];
}

export function renderVisibilityOptions(isPublic, copy) {
  return VISIBILITY_OPTIONS.map((option) => {
    const selected = option.isPublic === Boolean(isPublic);
    return `
      <button class="vis-card ${selected ? "is-selected" : ""}" type="button" data-visibility-option data-visibility-value="${option.value}" aria-pressed="${selected}">
        <span class="vis-ic">${option.icon}</span>
        <span class="vis-text"><span class="vis-title">${copy.t(option.isPublic ? "create.publicTitle" : "create.privateTitle")}</span><span class="vis-sub">${copy.t(option.isPublic ? "create.publicBody" : "create.privateBody")}</span></span>
        <span class="vis-check" aria-hidden="true">${ICONS.check}</span>
      </button>
    `;
  }).join("");
}

export function updateVisibilityOptions(container, isPublic) {
  if (!container) return;
  container.querySelectorAll("[data-visibility-option]").forEach((card) => {
    const selected = (card.dataset.visibilityValue === "public") === Boolean(isPublic);
    card.classList.toggle("is-selected", selected);
    card.setAttribute("aria-pressed", String(selected));
  });
}
