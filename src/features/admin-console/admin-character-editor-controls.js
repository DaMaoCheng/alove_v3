import { selectDropdownHtml } from "../shared-ui/dropdown.js";
import { searchCharacterLanguages } from "../../config/language-library.js";
import { editableStatusItems, normalizeCharacterStatus } from "./admin-character-status.js";

export function bindAdminCharacterEditorControls(host, { onSync, signal } = {}) {
  const form = host.querySelector("[data-character-editor-form]");
  if (!form) return;

  bindAdminCreatePicks(form);
  bindAdminCreateCards(form);
  bindAdminLanguagePicker(form, { signal });
  bindAdminVoiceControls(form);

  const visibilityInput = form.querySelector('input[name="visibility"]');
  if (!visibilityInput) return;

  form.dataset.characterOriginalStatus = normalizeCharacterStatus(form.querySelector('input[name="status"]')?.value || "published");
  visibilityInput.addEventListener("change", () => syncStatusField(form, onSync));
  syncStatusField(form, onSync);
}

function syncStatusField(form, onSync) {
  const statusField = form.querySelector("[data-character-status-field]");
  if (!statusField) return;

  const visibility = form.querySelector('input[name="visibility"]')?.value || "public";
  const status = normalizeCharacterStatus(form.querySelector('input[name="status"]')?.value || form.dataset.characterOriginalStatus);
  const labelHtml = statusField.classList.contains("cf-field") ? "<label>上架状态</label>" : "<span>上架状态</span>";

  statusField.innerHTML = visibility === "private"
    ? `${labelHtml}<input value="-" readonly data-character-status-static /><input type="hidden" name="status" value="${escapeAttr(status)}" data-character-status-input />`
    : `${labelHtml}${selectDropdownHtml({ name: "status", value: status, items: editableStatusItems(), className: status === "archived" ? "agent-dd agent-status-dd is-danger-status" : "agent-dd agent-status-dd" })}`;
  onSync?.();
}

function bindAdminCreatePicks(form) {
  form.querySelectorAll("[data-admin-pick]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      const group = button.dataset.adminPick || "";
      const input = form.querySelector(`[data-admin-pick-value="${cssEscape(group)}"]`);
      if (!input) return;
      input.value = button.dataset.value || "";
      form.querySelectorAll(`[data-admin-pick="${cssEscape(group)}"]`).forEach((item) => {
        item.classList.toggle("active", item === button);
      });
    });
  });
}

function bindAdminCreateCards(form) {
  bindCardGroup(form, {
    buttonSelector: "[data-admin-visibility-option]",
    inputSelector: "[data-admin-visibility-value]",
  });
}

function bindCardGroup(form, { buttonSelector, inputSelector }) {
  const input = form.querySelector(inputSelector);
  if (!input) return;
  form.querySelectorAll(buttonSelector).forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      input.value = button.dataset.value || "";
      input.dispatchEvent(new Event("change", { bubbles: true }));
      form.querySelectorAll(buttonSelector).forEach((item) => {
        const selected = item === button;
        item.classList.toggle("is-selected", selected);
        item.setAttribute("aria-pressed", String(selected));
      });
    });
  });
}

export function bindAdminLanguagePicker(form, { signal } = {}) {
  const picker = form.querySelector("[data-admin-language-picker]");
  if (!picker) return;

  const trigger = picker.querySelector("[data-admin-language-trigger]");
  const search = picker.querySelector("[data-admin-language-search]");
  trigger?.addEventListener("click", (event) => {
    event.preventDefault();
    picker.classList.toggle("open");
    if (picker.classList.contains("open")) search?.focus();
  });

  picker.querySelector("[data-admin-language-options]")?.addEventListener("click", (event) => {
    const option = event.target?.closest?.("[data-admin-language-option]");
    if (!option) return;
    event.preventDefault();
    setLanguageValue(picker, option.dataset.languageLabelValue || "", option.dataset.languageCodeValue || "");
  });

  search?.addEventListener("input", () => {
    renderLanguageOptions(picker, search.value || "");
  });

  document.addEventListener("click", (event) => {
    if (!picker.contains(event.target)) picker.classList.remove("open");
  }, signal ? { capture: true, signal } : { capture: true });
}

function renderLanguageOptions(picker, query) {
  const container = picker.querySelector("[data-admin-language-options]");
  if (!container) return;
  const currentCode = picker.querySelector("[data-admin-language-code]")?.value || "";
  const languages = searchCharacterLanguages(query, { limit: 16 });
  container.innerHTML = languages.length ? languages.map((language) => {
    const active = language.code === currentCode;
    const supportText = language.flashSupported ? "快速语音" : "高质量语音";
    return `
      <button class="language-option ${active ? "is-active" : ""}" type="button" data-admin-language-option data-language-code-value="${escapeAttr(language.code)}" data-language-label-value="${escapeAttr(language.label)}">
        <span class="language-option-main">${escapeHtml(language.label)}</span>
        <span class="language-option-sub">${escapeHtml(supportText)}</span>
      </button>
    `;
  }).join("") : `<div class="language-empty">没有找到语言</div>`;
}

function setLanguageValue(picker, label, code) {
  const labelInput = picker.querySelector("[data-admin-language-value]");
  const codeInput = picker.querySelector("[data-admin-language-code]");
  const current = picker.querySelector("[data-admin-language-current]");
  if (labelInput) labelInput.value = label;
  if (codeInput) codeInput.value = code;
  if (current) current.textContent = label || "选择语言";
  picker.querySelectorAll("[data-admin-language-option]").forEach((option) => {
    option.classList.toggle("is-active", option.dataset.languageCodeValue === code);
  });
  picker.classList.remove("open");
}

function bindAdminVoiceControls(form) {
  form.querySelectorAll("[data-admin-voice-preview]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const sampleUrl = button.dataset.adminVoicePreview || "";
      if (!sampleUrl) return;
      const audio = new Audio(sampleUrl);
      audio.play().catch(() => {});
    });
  });
}

function escapeAttr(value) {
  return String(value == null ? "" : value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function cssEscape(value) {
  if (window.CSS?.escape) return window.CSS.escape(value);
  return String(value || "").replaceAll('"', '\\"');
}
