import { CREATE_VIBES } from "../../data/demo-data.js";
import { ELEVENLABS_VOICE_PRESETS } from "../../config/voice-presets.js";
import { AVATAR_UPLOAD_POLICY } from "../../config/upload-policies.js";
import { ICONS } from "../../icons/icons.js";
import { characterAvatarHtml } from "../shared-ui/character-avatar.js";
import { escapeAttr, escapeHtml } from "./admin-console-utils.js";
import {
  adminPick,
  buildAdminVoiceOptions,
  languageDropdownHtml,
  normalizeCharacterStatus,
  resolveAdminLanguageState,
  renderAdminVisibilityOptions,
  renderCommonStatusField,
  renderSelect,
  resolveAdminVoicePreset,
} from "./admin-character-editor-fields.js";

export function adminCommonCharacterCreateHtml({ character, title, categoryItems, avatarPlaceholder, showAiControls }) {
  const selectedCategory = character.categoryId || character.category || "companion";
  const selectedPersonality = character.personality || "Calm mentor";
  const selectedVoicePreset = resolveAdminVoicePreset(character) || ELEVENLABS_VOICE_PRESETS[0];
  const selectedVoice = selectedVoicePreset?.id || "";
  const { selectedLanguage, languageOptions, searchValue } = resolveAdminLanguageState(character);
  const voiceOptions = ELEVENLABS_VOICE_PRESETS.map((preset) => [
    preset.id,
    preset.label,
    `<span class="voice-option-play" data-admin-voice-preview="${escapeAttr(preset.sampleUrl)}" aria-label="播放 ${escapeAttr(preset.label)} 预览">${ICONS.play}</span>`,
  ]);

  return `
    <div class="dialog-scrim" data-character-editor-close></div>
    <div class="dlg common-character-modal admin-common-create-modal" role="dialog" aria-modal="true">
      <button class="dlg-x" type="button" aria-label="Close" data-character-editor-close>×</button>
      <div class="dlg-body"><h3>${escapeHtml(title)}</h3></div>
      <form class="agent-form admin-common-create-form" data-character-editor-form>
        <div class="cf-field">
          <label>头像</label>
          <div class="cf-avatar-row">
            <div class="cf-avatar" data-character-avatar-preview${avatarPlaceholder ? ` data-character-avatar-placeholder="${escapeAttr(avatarPlaceholder)}"` : ""}>${characterAvatarHtml({ name: character.name, imageUrl: character.avatarUrl, className: "cf-avatar-visual", placeholder: avatarPlaceholder })}</div>
            <div class="cf-avatar-actions">
              <div class="cf-avatar-btns">
                <button class="btn btn-ghost cf-upload" type="button" data-character-avatar-upload>${ICONS.cam} 上传头像</button>
                ${showAiControls ? `<button class="btn btn-ghost cf-upload cf-aigen" type="button" data-character-avatar-generate>${ICONS.spark} AI智能生成</button>` : ""}
              </div>
              <button class="cf-avatar-remove" type="button" data-character-avatar-remove>删除头像</button>
              <input type="file" accept="${escapeAttr(AVATAR_UPLOAD_POLICY.accept)}" hidden data-character-avatar-file />
              <input type="hidden" name="avatarUrl" value="${escapeAttr(character.avatarUrl || "")}" data-character-avatar-value />
            </div>
          </div>
        </div>

        <div class="cf-field">
          <label>角色名称</label>
          <input name="name" maxlength="96" placeholder="角色名称" value="${escapeAttr(character.name || "")}" required />
        </div>

        <div class="cf-field">
          <label>分类</label>
          <input type="hidden" name="category" value="${escapeAttr(selectedCategory)}" data-admin-pick-value="category" />
          <div class="pick-row">${categoryItems.map(([value, label]) => adminPick("category", value, label, selectedCategory === value)).join("")}</div>
        </div>

        <div class="cf-field">
          <label>性格</label>
          <input type="hidden" name="personality" value="${escapeAttr(selectedPersonality)}" data-admin-pick-value="personality" />
          <div class="pick-row">${CREATE_VIBES.map((item) => adminPick("personality", item, item, selectedPersonality === item)).join("")}</div>
        </div>

        <div class="cf-field">
          <label>音色</label>
          <div class="voice-row">
            ${renderSelect({ name: "voice", value: selectedVoice, items: voiceOptions, placeholder: "选择音色", className: "create-voice-dd" })}
          </div>
        </div>

        <div class="cf-field">
          <label>默认语言</label>
          ${languageDropdownHtml({ selectedLanguage, languageOptions, searchValue })}
        </div>

        <div class="cf-field">
          <label>开场白</label>
          <input name="openingLine" maxlength="512" placeholder="角色会怎么开场？" value="${escapeAttr(character.openingLine || "")}" />
        </div>

        <div class="cf-field">
          <div class="cf-label-row">
            <label>背景故事</label>
            <button class="ai-polish-btn admin-ai-polish-btn" type="button" data-character-ai-polish>${ICONS.spark} AI润色</button>
          </div>
          <textarea name="backstory" rows="4">${escapeHtml(character.backstory || "")}</textarea>
        </div>

        <div class="cf-field">
          <label>可见性</label>
          <input type="hidden" name="visibility" value="${escapeAttr(character.visibility || "public")}" data-admin-visibility-value />
          <div class="vis-options" role="group" aria-label="角色可见性">${renderAdminVisibilityOptions(character.visibility || "public")}</div>
        </div>

        <input type="hidden" name="status" value="${escapeAttr(normalizeCharacterStatus(character.status || "published"))}" />

        <div class="account-form-error" data-character-editor-error hidden></div>
        <div class="dlg-actions"><button class="btn btn-ghost" type="button" data-character-editor-close>取消</button><button class="btn btn-primary" type="submit">创建角色</button></div>
      </form>
    </div>
  `;
}

export function adminCommonCharacterEditHtml({ character, title, categoryItems, showAiControls, ownerName, ownerAccount }) {
  const selectedCategory = character.categoryId || character.category || "companion";
  const selectedPersonality = character.personality || "Calm mentor";
  const selectedVoicePreset = resolveAdminVoicePreset(character);
  const selectedVoice = selectedVoicePreset?.id || character.voice || "";
  const { selectedLanguage, languageOptions, searchValue } = resolveAdminLanguageState(character);
  const voiceOptions = ELEVENLABS_VOICE_PRESETS.map((preset) => [
    preset.id,
    preset.label,
    `<span class="voice-option-play" data-admin-voice-preview="${escapeAttr(preset.sampleUrl)}" aria-label="播放 ${escapeAttr(preset.label)} 预览">${ICONS.play}</span>`,
  ]);
  if (!selectedVoicePreset && selectedVoice) {
    voiceOptions.unshift([selectedVoice, selectedVoice]);
  }

  return `
    <div class="dialog-scrim" data-character-editor-close></div>
    <div class="dlg common-character-modal admin-common-edit-modal" role="dialog" aria-modal="true">
      <button class="dlg-x" type="button" aria-label="Close" data-character-editor-close>×</button>
      <div class="dlg-body"><h3>${escapeHtml(title)}</h3></div>
      <form class="agent-form admin-common-edit-form" data-character-editor-form>
        <div class="cf-field">
          <label>头像</label>
          <div class="cf-avatar-row admin-common-edit-avatar-row">
            <div class="cf-avatar" data-character-avatar-preview>${characterAvatarHtml({ name: character.name, imageUrl: character.avatarUrl, className: "cf-avatar-visual" })}</div>
            <div class="cf-avatar-actions character-avatar-actions">
              <div class="cf-avatar-btns">
                <button class="btn btn-ghost cf-upload" type="button" data-character-avatar-upload>${ICONS.cam} 上传头像</button>
                ${showAiControls ? `<button class="btn btn-ghost cf-upload cf-aigen" type="button" data-character-avatar-generate>${ICONS.spark} AI智能生成</button>` : ""}
              </div>
              <button class="cf-avatar-remove character-avatar-remove" type="button" data-character-avatar-remove>删除头像</button>
              <input type="file" accept="${escapeAttr(AVATAR_UPLOAD_POLICY.accept)}" hidden data-character-avatar-file />
              <input type="hidden" name="avatarUrl" value="${escapeAttr(character.avatarUrl || "")}" data-character-avatar-value />
            </div>
            <div class="admin-common-edit-meta character-editor-meta">
              <div class="character-editor-owner"><b>${escapeHtml(ownerName || "-")}</b><small>${escapeHtml(ownerAccount || "-")}</small></div>
              <span class="character-id-tag">${escapeHtml(character.id || "")}</span>
            </div>
          </div>
        </div>

        <div class="agent-form-grid">
          <div class="cf-field">
            <label>角色名称</label>
            <input name="name" maxlength="96" placeholder="角色名称" value="${escapeAttr(character.name || "")}" required />
          </div>
          <div class="cf-field">
            <label>角色定位</label>
            <input name="roleTitle" maxlength="128" placeholder="例如：足球装备顾问" value="${escapeAttr(character.roleTitle || "")}" />
          </div>
        </div>

        <div class="cf-field">
          <label>分类</label>
          <input type="hidden" name="category" value="${escapeAttr(selectedCategory)}" data-admin-pick-value="category" />
          <div class="pick-row">${categoryItems.map(([value, label]) => adminPick("category", value, label, selectedCategory === value)).join("")}</div>
        </div>

        <div class="cf-field">
          <label>简介</label>
          <p class="knowledge-summary-text">${escapeHtml(character.shortBio || "-")}</p>
        </div>

        <div class="cf-field">
          <label>性格</label>
          <input type="hidden" name="personality" value="${escapeAttr(selectedPersonality)}" data-admin-pick-value="personality" />
          <div class="pick-row">${CREATE_VIBES.map((item) => adminPick("personality", item, item, selectedPersonality === item)).join("")}</div>
        </div>

        <div class="cf-field">
          <label>音色</label>
          <div class="voice-row">
            ${renderSelect({ name: "voice", value: selectedVoice, items: voiceOptions, placeholder: "选择音色", className: "create-voice-dd" })}
          </div>
        </div>

        <div class="agent-form-grid">
          <div class="cf-field">
            <label>默认语言</label>
            ${languageDropdownHtml({ selectedLanguage, languageOptions, searchValue })}
          </div>
          ${renderCommonStatusField(character)}
        </div>

        <div class="cf-field">
          <label>可见性</label>
          <input type="hidden" name="visibility" value="${escapeAttr(character.visibility || "public")}" data-admin-visibility-value />
          <div class="vis-options" role="group" aria-label="角色可见性">${renderAdminVisibilityOptions(character.visibility || "public")}</div>
        </div>

        <div class="cf-field">
          <label>开场白</label>
          <input name="openingLine" maxlength="512" placeholder="角色会怎么开场？" value="${escapeAttr(character.openingLine || "")}" />
        </div>

        <div class="cf-field">
          <div class="cf-label-row">
            <label>背景故事</label>
            <button class="ai-polish-btn admin-ai-polish-btn" type="button" data-character-ai-polish>${ICONS.spark} AI润色</button>
          </div>
          <textarea name="backstory" rows="5">${escapeHtml(character.backstory || "")}</textarea>
        </div>

        <div class="account-form-error" data-character-editor-error hidden></div>
        <div class="dlg-actions"><button class="btn btn-ghost" type="button" data-character-editor-close>取消</button><button class="btn btn-primary" type="submit">保存设置</button></div>
      </form>
    </div>
  `;
}
