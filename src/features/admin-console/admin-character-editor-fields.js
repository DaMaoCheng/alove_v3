import { ELEVENLABS_VOICE_PRESETS, getElevenLabsVoicePreset } from "../../config/voice-presets.js";
import { SUPPORTED_CHARACTER_LANGUAGES, findCharacterLanguage, searchCharacterLanguages } from "../../config/language-library.js";
import { ICONS } from "../../icons/icons.js";
import { selectDropdownHtml } from "../shared-ui/dropdown.js";
import { editableStatusItems, isPrivateCharacter, normalizeCharacterStatus } from "./admin-character-status.js";
import { escapeAttr, escapeHtml } from "./admin-console-utils.js";

export { normalizeCharacterStatus };

export function adminPick(group, value, label, active) {
  return `<button class="pick ${active ? "active" : ""}" type="button" data-admin-pick="${escapeAttr(group)}" data-value="${escapeAttr(value)}">${escapeHtml(label)}</button>`;
}

export function buildLanguageOptions(query) {
  const results = searchCharacterLanguages(query, { limit: 16 });
  return results.length ? results : SUPPORTED_CHARACTER_LANGUAGES.slice(0, 16);
}

export function resolveAdminLanguageState(character = {}) {
  const selectedLanguage = findCharacterLanguage(character.languageCode || character.language) || null;
  return {
    selectedLanguage,
    languageOptions: buildLanguageOptions(character.languageSearch || character.language || ""),
    searchValue: character.languageSearch || "",
  };
}

export function languageDropdownHtml({
  selectedLanguage,
  languageOptions,
  searchValue,
  fieldName = "language",
  codeFieldName = "languageCode",
}) {
  const currentLabel = selectedLanguage?.label || "选择语言";
  return `
    <div class="language-select create-language-dd" data-admin-language-picker>
      <input type="hidden" name="${escapeAttr(fieldName)}" value="${escapeAttr(selectedLanguage?.label || "")}" data-admin-language-value />
      <input type="hidden" name="${escapeAttr(codeFieldName)}" value="${escapeAttr(selectedLanguage?.code || "")}" data-admin-language-code />
      <button class="language-trigger" type="button" data-admin-language-trigger>
        <span data-admin-language-current>${escapeHtml(currentLabel)}</span>${ICONS.chevron || ""}
      </button>
      <div class="language-menu" data-admin-language-menu>
        <input class="language-search" type="search" data-admin-language-search placeholder="搜索语言" value="${escapeAttr(searchValue || "")}" autocomplete="off" />
        <div class="language-options" data-admin-language-options>
          ${languageOptions.map((language) => languageOptionHtml(language, selectedLanguage?.code === language.code)).join("")}
        </div>
      </div>
    </div>
  `;
}

export function languageOptionHtml(language, active) {
  const supportText = language.flashSupported ? "快速语音" : "高质量语音";
  return `
    <button class="language-option ${active ? "is-active" : ""}" type="button" data-admin-language-option data-language-code-value="${escapeAttr(language.code)}" data-language-label-value="${escapeAttr(language.label)}">
      <span class="language-option-main">${escapeHtml(language.label)}</span>
      <span class="language-option-sub">${escapeHtml(supportText)}</span>
      ${active ? `<span class="language-option-check">${ICONS.check || ""}</span>` : ""}
    </button>
  `;
}

export function renderAdminVisibilityOptions(value) {
  const options = [
    {
      value: "private",
      icon: ICONS.lock,
      title: "私密角色",
      text: "仅管理员可见，不会出现在公开发现和搜索中。",
    },
    {
      value: "public",
      icon: ICONS.globe,
      title: "公开角色",
      text: "所有用户都可以在广场和搜索中找到这个角色。",
    },
  ];
  return options.map((option) => renderAdminCardOption({
    ...option,
    selected: option.value === value,
    dataAttr: "data-admin-visibility-option",
    ariaValue: option.value,
  })).join("");
}

export function renderAdminCardOption({ value, icon, title, text, selected, dataAttr, ariaValue }) {
  return `
    <button class="vis-card ${selected ? "is-selected" : ""}" type="button" ${dataAttr} data-value="${escapeAttr(value)}" aria-pressed="${selected}" aria-label="${escapeAttr(ariaValue)}">
      <span class="vis-ic">${icon}</span>
      <span class="vis-text"><span class="vis-title">${escapeHtml(title)}</span><span class="vis-sub">${escapeHtml(text)}</span></span>
      <span class="vis-check" aria-hidden="true">${ICONS.check}</span>
    </button>
  `;
}

export function renderCommonStatusField(character) {
  const status = normalizeCharacterStatus(character.status);
  if (isPrivateCharacter(character)) {
    return `<div class="cf-field" data-character-status-field><label>上架状态</label><input value="-" readonly data-character-status-static /><input type="hidden" name="status" value="${escapeAttr(status)}" data-character-status-input /></div>`;
  }
  return `<div class="cf-field" data-character-status-field><label>上架状态</label>${renderSelect({ name: "status", value: status, items: editableStatusItems(), className: status === "archived" ? "agent-dd agent-status-dd is-danger-status" : "agent-dd agent-status-dd" })}</div>`;
}

export function renderCreatorAccountPicker(accounts = []) {
  const items = accounts.map((account) => renderCreatorAccountCandidate(account)).join("");
  return `
    <div class="cf-field creator-account-picker" data-creator-account-picker>
      <label>绑定账号</label>
      <input type="hidden" name="ownerUid" value="" data-creator-account-value />
      <input type="text" placeholder="搜索昵称 / 邮箱 / 用户 ID" autocomplete="off" data-creator-account-search />
      <div class="creator-account-menu" data-creator-account-menu>${items || `<div class="creator-account-empty">暂无可绑定创作者账号</div>`}</div>
    </div>`;
}

export function renderCreatorReadonlyInput(label, value, attrs = "") {
  return `<div class="cf-field"><label>${escapeHtml(label)}</label><input value="${escapeAttr(value || "-")}" readonly ${attrs} /></div>`;
}

export function renderCreatorReadonlyText(label, value) {
  return `<div class="cf-field"><label>${escapeHtml(label)}</label><p class="knowledge-summary-text">${escapeHtml(value || "-")}</p></div>`;
}

export function renderCreatorAccountCandidate(account) {
  const label = account.name || account.email || account.id || "未命名账号";
  const meta = [account.email, account.siteName || "未绑定站点"].filter(Boolean).join(" · ");
  return `<button class="creator-account-option" type="button" data-creator-account-option data-account-id="${escapeAttr(account.id || "")}" data-account-label="${escapeAttr(label)}" data-account-search="${escapeAttr(`${label} ${account.email || ""} ${account.id || ""}`)}" data-site-name="${escapeAttr(account.siteName || "未绑定站点")}" data-site-slug="${escapeAttr(account.siteSlug || "")}"><b>${escapeHtml(label)}</b><small>${escapeHtml(meta || account.id || "-")}</small></button>`;
}

export function renderSelect({ name, value, items, placeholder = "", className = "agent-dd" }) {
  return selectDropdownHtml({ name, value, items, placeholder, className });
}

export function categoryIdForCreateKey(value = "") {
  const aliases = {
    Babe: "football_babe",
    Creator: "creator",
    Pundit: "pundit",
    Fan: "fan",
    Companion: "companion",
  };
  return aliases[value] || String(value || "").toLowerCase();
}

export function resolveAdminVoicePreset(character = {}) {
  return getElevenLabsVoicePreset(character.voiceId || character.voice || character.voiceStyle || "");
}

export function buildAdminVoiceOptions({ selectedVoice = "", selectedVoicePreset = null } = {}) {
  const options = ELEVENLABS_VOICE_PRESETS.map((preset) => [
    preset.id,
    preset.label,
    `<span class="voice-option-play" data-admin-voice-preview="${escapeAttr(preset.sampleUrl)}" aria-label="播放 ${escapeAttr(preset.label)} 预览">${ICONS.play}</span>`,
  ]);
  if (!selectedVoicePreset && selectedVoice) {
    options.unshift([selectedVoice, selectedVoice]);
  }
  return options;
}

export function creatorNickname(creator) {
  if (typeof creator === "object" && creator) return creator.nickname || "";
  return String(creator || "");
}

export function creatorAccount(creator) {
  if (typeof creator === "object" && creator) return creator.account || "";
  return "";
}
