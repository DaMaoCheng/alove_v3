import { CREATE_CATS, CREATE_VIBES, CREATE_VOICES } from "../../data/demo-data.js";
import { ICONS } from "../../icons/icons.js";
import { selectDropdownHtml } from "../shared-ui/dropdown.js";
import { characterAvatarHtml } from "../shared-ui/character-avatar.js";
import { escapeAttr, escapeHtml } from "./admin-console-utils.js";

export function adminAgentsHtml() {
  return `
    <div class="admin-body">
      <div class="admin-actions">
        <div class="admin-search agent-search">
          ${ICONS.search}
          <input placeholder="搜索角色名称..." data-agent-search />
        </div>
        <span class="hint">先把角色的人设、语气、边界和开场建议配置稳，再继续扩展对话能力。</span>
      </div>
      <div class="agent-settings-shell" data-agent-settings-shell>
        <div class="panel agent-list-panel">
          <div class="panel-head"><h3>角色列表</h3><span class="panel-tag" data-agent-count>加载中</span></div>
          <div class="agent-list" data-agent-list>
            <div class="log-empty">正在加载角色...</div>
          </div>
        </div>
        <div class="panel agent-form-panel">
          <div class="panel-head"><h3>角色设置</h3><span class="panel-tag" data-agent-form-status>请选择角色</span></div>
          <div data-agent-editor>
            <div class="log-empty">选择左侧角色后可编辑 AI 对象设置。</div>
          </div>
        </div>
      </div>
    </div>
  `;
}

export function adminAgentListHtml(items = [], activeId = "") {
  if (!items.length) {
    return `<div class="log-empty">暂无角色数据</div>`;
  }

  return items.map((item) => {
    const statusClass = item.characterStatus === "published" ? "on" : item.characterStatus === "draft" ? "mid" : "off";
    const profileStyle = item.profile?.style ? `<small>${escapeHtml(item.profile.style)}</small>` : "";
    return `
      <button class="agent-row ${item.id === activeId ? "active" : ""}" type="button" data-agent-id="${escapeHtml(item.id)}">
        ${characterAvatarHtml({ name: item.name, imageUrl: item.avatarUrl })}
        <span class="agent-row-main">
          <b>${escapeHtml(item.name || "未命名角色")}</b>
          <code>ID: ${escapeHtml(item.id || "")}</code>
          <span>${escapeHtml(item.roleTitle || "未设置定位")}</span>
          ${profileStyle}
        </span>
        <i class="pill ${statusClass}">${escapeHtml(resolveCharacterStatusLabel(item.characterStatus))}</i>
      </button>
    `;
  }).join("");
}

export function adminAgentEditorHtml(character) {
  if (!character) {
    return `<div class="log-empty">选择左侧角色后可编辑 AI 对象设置。</div>`;
  }

  const avatarUrl = character.avatarUrl || "";
  const categoryValue = mapCategoryIdToCreateValue(character.category?.id);
  const personalityValue = resolvePersonalityValue(character);
  const voiceValue = character.voiceStyle || "";
  const languageValue = character.language || character.profile?.language || "";
  return `
    <form class="agent-form" data-agent-form>
      <div class="agent-avatar-block">
        <div class="agent-avatar-preview">${characterAvatarHtml({ name: character.name, imageUrl: avatarUrl })}</div>
        <label class="agent-field">
          <span>头像地址</span>
          <input name="avatarUrl" maxlength="512" value="${escapeAttr(avatarUrl)}" />
        </label>
        <label class="agent-field agent-id-field">
          <span>角色 ID</span>
          <input value="${escapeAttr(character.id || "")}" readonly />
        </label>
      </div>

      <div class="agent-form-grid">
        ${renderField("角色名称", `<input name="name" maxlength="96" value="${escapeAttr(character.name)}" required />`)}
        ${renderField("角色定位", `<input name="roleTitle" maxlength="128" value="${escapeAttr(character.roleTitle || "")}" />`)}
        ${renderField("分类", renderAgentSelect({
          name: "categoryId",
          value: categoryValue,
          placeholder: "选择分类",
          items: CREATE_CATS.map((item) => [item.key, item.label]),
        }))}
        ${renderField("发布状态", renderAgentSelect({
          name: "characterStatus",
          value: character.characterStatus,
          placeholder: "选择状态",
          items: [
            ["draft", "草稿"],
            ["published", "已上架"],
            ["archived", "已下架"],
          ],
          className: `agent-dd agent-status-dd ${character.characterStatus === "archived" ? "is-danger-status" : ""}`,
        }))}
        ${renderField("可见性", renderAgentSelect({
          name: "visibility",
          value: character.visibility,
          placeholder: "选择可见性",
          items: [
            ["public", "公开"],
            ["private", "私密"],
          ],
        }))}
      </div>

      ${renderField("短简介", `<textarea name="shortBio" rows="3" maxlength="255">${escapeHtml(character.shortBio || "")}</textarea>`)}
      <div class="agent-form-grid">
        ${renderField("性格", renderAgentSelect({
          name: "personality",
          value: personalityValue,
          placeholder: "选择性格",
          items: CREATE_VIBES.map((item) => [item, item]),
        }))}
        ${renderField("声音", renderAgentSelect({
          name: "voiceStyle",
          value: voiceValue,
          placeholder: "选择声音",
          items: CREATE_VOICES.map((item) => [item, item]),
        }))}
      </div>
      <div class="agent-form-grid">
        ${renderField("默认语言", `<input name="language" maxlength="128" value="${escapeAttr(languageValue)}" placeholder="English, Chinese, Japanese..." />`)}
        ${renderField("语音 ID", `<input name="voiceId" maxlength="128" value="${escapeAttr(character.voiceId || "")}" readonly />`)}
      </div>
      ${renderField("开场白", `<textarea name="openingLine" rows="3" maxlength="512">${escapeHtml(character.openingLine || "")}</textarea>`)}
      ${renderField("背景故事", `<textarea name="backstory" rows="5">${escapeHtml(character.personaPrompt || "")}</textarea>`)}

      <div class="agent-form-actions">
        <button class="btn btn-primary sm" type="submit" data-agent-save>${ICONS.spark} 保存设置</button>
        <span class="hint" data-agent-save-tip>当前已对齐创建角色页字段，保存后会同步更新角色卡和后续对话配置。</span>
      </div>
    </form>
  `;
}

function renderField(label, controlHtml) {
  return `<div class="agent-field"><span>${label}</span>${controlHtml}</div>`;
}

function renderAgentSelect({ name, value, placeholder, items }) {
  return selectDropdownHtml({
    name,
    value,
    placeholder,
    items,
    className: "agent-dd",
  });
}

function resolveCharacterStatusLabel(status) {
  if (status === "published") return "已上架";
  if (status === "archived") return "已下架";
  return "草稿";
}

function mapCategoryIdToCreateValue(categoryId) {
  const mapping = {
    football_babe: "Babe",
    creator: "Creator",
    pundit: "Pundit",
    fan: "Fan",
    companion: "Companion",
  };
  return mapping[String(categoryId || "").toLowerCase()] || "Babe";
}

function resolvePersonalityValue(character) {
  const current = String(character?.speakingStyle || "").trim();
  if (CREATE_VIBES.includes(current)) return current;

  const source = [
    current,
    character?.roleTitle,
    character?.profile?.style,
  ].join(" ").toLowerCase();

  if (source.includes("calm") || source.includes("mentor") || source.includes("patient")) return "Calm mentor";
  if (source.includes("tactical") || source.includes("analysis") || source.includes("analytical")) return "Tactical nerd";
  if (source.includes("old-school") || source.includes("veteran") || source.includes("experienced")) return "Old-school";
  if (source.includes("banter") || source.includes("cheeky") || source.includes("sharp")) return "Cheeky banter";
  return "Hype & loud";
}
