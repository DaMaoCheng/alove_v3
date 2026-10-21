import { CREATE_VIBES } from "../../data/demo-data.js";
import { AVATAR_UPLOAD_POLICY } from "../../config/upload-policies.js";
import { ICONS } from "../../icons/icons.js";
import { characterAvatarHtml } from "../shared-ui/character-avatar.js";
import { escapeAttr, escapeHtml } from "./admin-console-utils.js";
import {
  adminPick,
  buildAdminVoiceOptions,
  languageDropdownHtml,
  resolveAdminLanguageState,
  renderCommonStatusField,
  renderCreatorAccountPicker,
  renderCreatorReadonlyInput,
  renderSelect,
  resolveAdminVoicePreset,
} from "./admin-character-editor-fields.js";

export function adminCreatorCharacterCreateHtml({ character, title, avatarPlaceholder, showAiControls, creatorAccounts, derivedSiteName, derivedSiteSlug }) {
  const selectedPersonality = character.personality || "Cheeky banter";
  const selectedVoicePreset = resolveAdminVoicePreset(character);
  const selectedVoice = selectedVoicePreset?.id || character.voice || "";
  const { selectedLanguage, languageOptions, searchValue } = resolveAdminLanguageState(character);
  const voiceOptions = buildAdminVoiceOptions({ selectedVoice, selectedVoicePreset });

  return `
    <div class="dialog-scrim" data-character-editor-close></div>
    <div class="dlg common-character-modal admin-creator-create-modal" role="dialog" aria-modal="true">
      <button class="dlg-x" type="button" aria-label="Close" data-character-editor-close>×</button>
      <div class="dlg-body"><h3>${escapeHtml(title)}</h3></div>
      <form class="agent-form admin-creator-create-form" data-character-editor-form>
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

        <div class="agent-form-grid">
          <div class="cf-field">
            <label>角色名称</label>
            <input name="name" maxlength="96" placeholder="角色名称" value="${escapeAttr(character.name || "")}" required />
          </div>
          ${renderCreatorAccountPicker(creatorAccounts)}
        </div>

        <div class="agent-form-grid">
          ${renderCreatorReadonlyInput("所属站点", derivedSiteSlug ? `${derivedSiteName} / ${derivedSiteSlug}` : derivedSiteName, "data-creator-derived-site")}
          ${renderCommonStatusField(character)}
        </div>

        ${renderCreatorReadonlyInput("可见性", "公开")}
        <input type="hidden" name="category" value="creator" />
        <input type="hidden" name="visibility" value="public" />

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

        <div class="account-form-error" data-character-editor-error hidden></div>
        <div class="dlg-actions"><button class="btn btn-ghost" type="button" data-character-editor-close>取消</button><button class="btn btn-primary" type="submit">创建角色</button></div>
      </form>
    </div>
  `;
}

export function adminCreatorCharacterEditHtml({ character, title, showAiControls, ownerName, ownerAccount, derivedSiteName, derivedSiteSlug }) {
  const selectedPersonality = character.personality || "Cheeky banter";
  const selectedVoicePreset = resolveAdminVoicePreset(character);
  const selectedVoice = selectedVoicePreset?.id || character.voice || "";
  const { selectedLanguage, languageOptions, searchValue } = resolveAdminLanguageState(character);
  const voiceOptions = buildAdminVoiceOptions({ selectedVoice, selectedVoicePreset });

  return `
    <div class="dialog-scrim" data-character-editor-close></div>
    <div class="dlg common-character-modal admin-creator-edit-modal" role="dialog" aria-modal="true">
      <button class="dlg-x" type="button" aria-label="Close" data-character-editor-close>×</button>
      <div class="dlg-body"><h3>${escapeHtml(title)}</h3></div>
      <form class="agent-form admin-creator-edit-form" data-character-editor-form>
        <div class="cf-field">
          <label>头像</label>
          <div class="cf-avatar-row admin-creator-edit-avatar-row">
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
            <div class="admin-creator-edit-meta character-editor-meta">
              <span class="character-id-tag">${escapeHtml(character.id || "")}</span>
            </div>
          </div>
        </div>

        <div class="agent-form-grid">
          <div class="cf-field">
            <label>角色名称</label>
            <input name="name" maxlength="96" placeholder="角色名称" value="${escapeAttr(character.name || "")}" required />
          </div>
          ${renderCreatorReadonlyInput("对应账号", ownerAccount || ownerName || "-")}
        </div>

        <div class="agent-form-grid">
          ${renderCreatorReadonlyInput("所属站点", derivedSiteSlug ? `${derivedSiteName} / ${derivedSiteSlug}` : derivedSiteName)}
          ${renderCommonStatusField(character)}
        </div>

        ${renderCreatorReadonlyInput("可见性", "公开")}
        <input type="hidden" name="category" value="creator" />
        <input type="hidden" name="visibility" value="public" />

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
          <textarea name="backstory" rows="5">${escapeHtml(character.backstory || "")}</textarea>
        </div>

        <div class="account-form-error" data-character-editor-error hidden></div>
        <div class="dlg-actions"><button class="btn btn-ghost" type="button" data-character-editor-close>取消</button><button class="btn btn-primary" type="submit">保存设置</button></div>
      </form>
    </div>
  `;
}
