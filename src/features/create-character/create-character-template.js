import { CREATE_VIBES } from "../../data/demo-data.js";
import { ICONS } from "../../icons/icons.js";
import { ELEVENLABS_VOICE_PRESETS, getVoicePresetLabel } from "../../config/voice-presets.js";
import { SUPPORTED_CHARACTER_LANGUAGES, findCharacterLanguage, searchCharacterLanguages } from "../../config/language-library.js";
import { AVATAR_UPLOAD_POLICY } from "../../config/upload-policies.js";
import { characterAvatarHtml } from "../shared-ui/character-avatar.js";
import { selectDropdownHtml } from "../shared-ui/dropdown.js";
import { escapeAttr, escapeHtml } from "./create-character-html.js";
import { getCreatePreviewModel, renderCreatePreview } from "./create-character-preview.js";
import { renderVisibilityOptions } from "./create-character-visibility.js";
import { resolveCreateCategory } from "./create-character-categories.js";
import { createSiteCopy } from "../../i18n/site-copy.js";

export function createCharacterPageHtml({ createState, category, user = {}, pageLanguage = "English" }) {
  const copy = createSiteCopy(pageLanguage);
  const { visibleCats, selectedCat } = resolveCreateCategory(createState, user);
  const displayAvatarUrl = createState.avatarPreviewUrl || createState.avatarUrl;
  const avatarHtml = characterAvatarHtml({
    name: createState.name || "AIOVE",
    imageUrl: displayAvatarUrl,
    className: "cf-avatar-visual",
    placeholder: displayAvatarUrl ? "" : "image",
  });
  const isPublic = createState.isPublic === true;
  const voiceOptions = ELEVENLABS_VOICE_PRESETS.map((preset) => [
    preset.id,
    preset.label,
    `<span class="voice-option-play" data-voice-preview="${escapeAttr(preset.sampleUrl)}" aria-label="${escapeAttr(copy.t("create.playVoice", { name: preset.label }))}">${ICONS.play}</span>`,
  ]);
  const selectedVoicePreset = ELEVENLABS_VOICE_PRESETS.find((preset) => preset.id === createState.voice || preset.label === createState.voice);
  const selectedVoice = selectedVoicePreset?.id || "";
  const selectedLanguage = findCharacterLanguage(createState.languageCode || createState.language) || null;
  const languageOptions = buildLanguageOptions(createState.languageSearch || createState.language || "");
  const preview = getCreatePreviewModel({ ...createState, voice: getVoicePresetLabel(selectedVoice) }, category);
  const backstory = String(createState.backstory || "");

  return `
    <div class="create-head">
      <span class="eyebrow">${ICONS.spark} ${copy.t("create.eyebrow")}</span>
      <h2>${copy.t("create.title")}</h2>
      <p>${copy.t("create.body")}</p>
    </div>
    <div class="create-grid">
      <div class="create-form">
        <div class="cf-field"><label>${copy.t("create.avatar")}</label><div class="cf-avatar-row"><div class="cf-avatar ${createState.avatarGenerating ? "is-generating" : ""}" data-create-avatar>${avatarHtml}</div><div class="cf-avatar-actions"><div class="cf-avatar-btns"><button class="btn btn-ghost cf-upload" type="button" data-avatar-upload ${createState.avatarUploading || createState.avatarGenerating ? "disabled" : ""}>${createState.avatarUploading ? '<span class="spin"></span>' : ICONS.cam} ${createState.avatarUploading ? copy.t("create.uploading") : copy.t("create.upload")}</button><button class="btn btn-ghost cf-upload cf-aigen" type="button" data-avatar-generate ${createState.avatarUploading || createState.avatarGenerating ? "disabled" : ""}>${createState.avatarGenerating ? `<span class="cf-spin"></span> ${copy.t("create.generating")}` : `${ICONS.spark} ${copy.t("create.generate")}`}</button></div>${displayAvatarUrl ? `<button class="cf-avatar-remove" type="button" data-avatar-remove>${copy.t("create.remove")}</button>` : ""}<input data-avatar-file type="file" accept="${AVATAR_UPLOAD_POLICY.accept}" hidden /></div></div></div>
        <div class="cf-field"><label>${copy.t("create.name")}</label><input name="name" placeholder="${copy.t("create.name")}" value="${escapeAttr(createState.name || "")}" /></div>
        <div class="cf-field"><label>${copy.t("create.category")}</label><div class="pick-row">${visibleCats.map((item) => pick("cat", item.key, createCategoryLabel(item.key, copy), selectedCat === item.key)).join("")}</div></div>
        <div class="cf-field"><label>${copy.t("create.personality")}</label><div class="pick-row">${CREATE_VIBES.map((item) => pick("vibe", item, createVibeLabel(item, copy), createState.vibe === item)).join("")}</div></div>
        <div class="cf-field"><label>${copy.t("create.voice")}</label><div class="voice-row">${selectDropdownHtml({ name: "voice", value: selectedVoice, items: voiceOptions, placeholder: copy.t("create.chooseVoice"), className: "create-voice-dd" })}<button class="voice-clone-btn" type="button" data-voice-clone>${copy.t("create.cloneVoice")} <span class="pro-tag">PRO</span></button></div></div>
        <div class="cf-field"><label>${copy.t("create.language")}</label>${languageDropdownHtml({ selectedLanguage, languageOptions, searchValue: createState.languageSearch || "", copy })}</div>
        <div class="cf-field"><label>${copy.t("create.opening")}</label><input name="openingLine" placeholder="${copy.t("create.openingPlaceholder")}" value="${escapeAttr(createState.openingLine || "")}" /></div>
        <div class="cf-field">
          <div class="cf-label-row">
            <label>${copy.t("create.backstory")}</label>
            <button class="ai-polish-btn ${createState.polishing ? "loading" : ""}" type="button" data-ai-polish ${createState.polishing ? "disabled" : ""}>
              ${createState.polishing ? '<span class="spin"></span>' : ICONS.spark}
              ${createState.polishing ? copy.t("create.polishing") : copy.t("create.polish")}
            </button>
          </div>
          <div class="cf-backstory-input">
            <textarea name="backstory" rows="4" maxlength="4000" aria-describedby="backstoryCharacterCount" ${createState.polishing ? "disabled" : ""}>${escapeHtml(backstory)}</textarea>
            <span class="cf-backstory-count" id="backstoryCharacterCount" data-backstory-count>${backstory.length} / 4000</span>
          </div>
        </div>
        <div class="cf-field">
          <label>${copy.t("create.visibility")}</label>
          <div class="vis-options" role="group" aria-label="${escapeAttr(copy.t("create.visibilityLabel"))}">${renderVisibilityOptions(isPublic, copy)}</div>
        </div>
        ${createState.avatarError ? `<div class="cf-error">${escapeHtml(createState.avatarError)}</div>` : ""}
        ${createState.polishError ? `<div class="cf-error">${escapeHtml(createState.polishError)}</div>` : ""}
        ${createState.error ? `<div class="cf-error">${escapeHtml(createState.error)}</div>` : ""}
        <button class="btn btn-primary btn-block" data-start-chat ${createState.submitting ? "disabled" : ""}>${ICONS.spark} ${createState.submitting ? copy.t("create.creating") : copy.t("create.submit")}</button>
      </div>
      ${renderCreatePreview({ createState: { ...createState, voice: getVoicePresetLabel(selectedVoice) }, avatarHtml, preview, pageLanguage })}
    </div>
  `;
}

function pick(key, value, label, active, pro = false) {
  return `<button class="pick ${active ? "active" : ""} ${pro ? "pick-pro" : ""}" data-key="${escapeAttr(key)}" data-value="${escapeAttr(value)}">${escapeHtml(label)}${pro ? ' <span class="pro-tag">PRO</span>' : ""}</button>`;
}

function createCategoryLabel(value, copy) {
  const key = {
    Babe: "create.categoryBabe",
    Creator: "create.categoryCreator",
    Pundit: "create.categoryPundit",
    Fan: "create.categoryFan",
    Companion: "create.categoryCompanion",
  }[value];
  return key ? copy.t(key) : value;
}

function createVibeLabel(value, copy) {
  const key = {
    "Hype & loud": "create.vibeHype",
    "Calm mentor": "create.vibeCalm",
    "Cheeky banter": "create.vibeCheeky",
    "Tactical nerd": "create.vibeTactical",
    "Old-school": "create.vibeOldSchool",
  }[value];
  return key ? copy.t(key) : value;
}

function buildLanguageOptions(query) {
  const results = searchCharacterLanguages(query, { limit: 16 });
  return results.length ? results : SUPPORTED_CHARACTER_LANGUAGES.slice(0, 16);
}

function languageDropdownHtml({ selectedLanguage, languageOptions, searchValue, copy }) {
  const currentLabel = selectedLanguage?.label || copy.t("create.chooseLanguage");
  return `
    <div class="language-select create-language-dd" data-language-picker>
      <input type="hidden" name="language" value="${escapeAttr(selectedLanguage?.label || "")}" data-language-value />
      <input type="hidden" name="languageCode" value="${escapeAttr(selectedLanguage?.code || "")}" data-language-code />
      <button class="language-trigger" type="button" data-language-trigger>
        <span data-language-current>${escapeHtml(currentLabel)}</span>${ICONS.chevron || ""}
      </button>
      <div class="language-menu" data-language-menu>
        <input class="language-search" type="search" data-language-search placeholder="${copy.t("create.searchLanguage")}" value="${escapeAttr(searchValue || "")}" autocomplete="off" />
        <div class="language-options" data-language-options>
          ${languageOptions.map((language) => languageOptionHtml(language, selectedLanguage?.code === language.code, copy)).join("")}
        </div>
      </div>
    </div>
  `;
}

function languageOptionHtml(language, active, copy) {
  const supportText = language.flashSupported ? copy.t("create.fastVoice") : copy.t("create.highQualityVoice");
  return `
    <button class="language-option ${active ? "is-active" : ""}" type="button" data-language-option data-language-code-value="${escapeAttr(language.code)}" data-language-label-value="${escapeAttr(language.label)}">
      <span class="language-option-main">${escapeHtml(language.label)}</span>
      <span class="language-option-sub">${escapeHtml(supportText)}</span>
      ${active ? `<span class="language-option-check">${ICONS.check || ""}</span>` : ""}
    </button>
  `;
}
