import { ICONS } from "../../icons/icons.js";
import { findCharacterLanguage, searchCharacterLanguages } from "../../config/language-library.js";
import { createSiteCopy } from "../../i18n/site-copy.js";

export function bindLanguagePicker(page, onChange, pageLanguage = "English") {
  const copy = createSiteCopy(pageLanguage);
  const picker = page.querySelector("[data-language-picker]");
  if (!picker) return;
  const trigger = picker.querySelector("[data-language-trigger]");
  const search = picker.querySelector("[data-language-search]");
  const options = picker.querySelector("[data-language-options]");

  trigger?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    picker.classList.toggle("open");
    if (picker.classList.contains("open")) {
      search?.focus();
      search?.select();
    }
  });

  picker.addEventListener("click", (event) => event.stopPropagation());
  search?.addEventListener("click", (event) => event.stopPropagation());
  search?.addEventListener("input", () => {
    clearCreateError(page);
    renderLanguageOptions(options, searchCharacterLanguages(search.value, { limit: 16 }), picker, copy);
  });

  picker.addEventListener("click", (event) => {
    const option = event.target.closest("[data-language-option]");
    if (!option) return;
    event.preventDefault();
    event.stopPropagation();
    const language = findCharacterLanguage(option.dataset.languageCodeValue || option.dataset.languageLabelValue);
    if (!language) return;
    selectLanguage(picker, language);
    onChange("language", language.label);
    onChange("languageCode", language.code);
    onChange("languageSearch", "");
    picker.classList.remove("open");
  });
  document.addEventListener("click", () => picker.classList.remove("open"));
}

function renderLanguageOptions(container, languages, picker, copy) {
  if (!container) return;
  const selectedCode = picker?.querySelector("[data-language-code]")?.value || "";
  container.innerHTML = languages.length
    ? languages.map((language) => {
        const active = selectedCode === language.code;
        return `
          <button class="language-option ${active ? "is-active" : ""}" type="button" data-language-option data-language-code-value="${escapeAttr(language.code)}" data-language-label-value="${escapeAttr(language.label)}">
            <span class="language-option-main">${escapeHtml(language.label)}</span>
            <span class="language-option-sub">${escapeHtml(language.flashSupported ? copy.t("create.fastVoice") : copy.t("create.highQualityVoice"))}</span>
            ${active ? `<span class="language-option-check">${ICONS.check || ""}</span>` : ""}
          </button>
        `;
      }).join("")
    : `<div class="language-empty">${escapeHtml(copy.t("create.noLanguage"))}</div>`;
}

function selectLanguage(picker, language) {
  picker.querySelector("[data-language-value]").value = language.label;
  picker.querySelector("[data-language-code]").value = language.code;
  picker.querySelector("[data-language-current]").textContent = language.label;
}

function clearCreateError(page) {
  page.querySelector(".cf-error")?.remove();
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
