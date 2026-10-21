import { ICONS } from "../../icons/icons.js";
import { characterAvatarHtml } from "../shared-ui/character-avatar.js";
import { characterKnowledgeTagsHtml, goKnowledgeButtonHtml } from "./admin-character-knowledge-display.js";
import { canArchiveCharacter, canPublishCharacter, characterStatusCellHtml, characterVisibilityLabel, characterVisibilityTone } from "./admin-character-status.js";
import { escapeAttr, escapeHtml } from "./admin-console-utils.js";

export function adminCommonCharactersHtml({ items = [], knowledgeBases = [], loading = false, error = "", query = "" } = {}) {
  return `
    <div class="admin-body">
      <div class="admin-actions">
        <button class="btn btn-primary sm" type="button" data-common-new>${ICONS.plus} 新建通用角色</button>
        ${goKnowledgeButtonHtml("common")}
        <div class="admin-search">${ICONS.search}<input data-common-search placeholder="搜索名称 / ID / 创建者 / 分类..." value="${escapeAttr(query)}" /></div>
      </div>
      <div class="panel">
        <div class="data-table admin-common-table">
          <div class="dt-head"><span class="character-name-col">角色</span><span class="character-id-col">角色 ID</span><span class="character-owner-col">创建者</span><span class="character-category-col">分类</span><span class="character-status-col">状态</span><span class="character-visibility-col">可见性</span><span class="character-kb-col">知识库</span><span class="character-number-col">对话数</span><span class="character-action-col"></span></div>
          ${commonRowsHtml({ items, knowledgeBases, loading, error })}
        </div>
      </div>
      <p class="admin-hint">通用角色不绑定站点，所有站点用户都可以在广场和搜索里看到；知识库绑定统一在知识库页面管理。</p>
    </div>
  `;
}

function commonRowsHtml({ items, knowledgeBases, loading, error }) {
  if (loading) return `<div class="log-empty">正在加载通用角色...</div>`;
  if (error) return `<div class="log-empty">${escapeHtml(error)}</div>`;
  return items.length ? items.map((character) => commonRowHtml(character, knowledgeBases)).join("") : `<div class="log-empty">暂无通用角色</div>`;
}

function commonRowHtml(character, knowledgeBases = []) {
  const canArchive = canArchiveCharacter(character);
  const canPublish = canPublishCharacter(character);
  return `
    <div class="dt-row">
      <span class="dt-cell name character-name-col">${characterAvatarHtml({ name: character.name, imageUrl: character.avatarUrl })}<b class="character-table-name" title="${escapeAttr(character.name)}">${escapeHtml(character.name)}</b></span>
      <span class="character-id-col"><code title="${escapeAttr(character.id)}">${escapeHtml(character.id)}</code></span>
      <span class="creator-meta character-owner-col"><b>${escapeHtml(creatorNickname(character.creator))}</b><small>${escapeHtml(creatorAccount(character.creator))}</small></span>
      <span class="character-category-col"><i class="pill site character-table-pill" title="${escapeAttr(categoryLabel(character.category))}">${escapeHtml(categoryLabel(character.category))}</i></span>
      <span class="character-status-col">${characterStatusCellHtml(character)}</span>
      <span class="character-visibility-col"><i class="pill ${characterVisibilityTone(character)}">${characterVisibilityLabel(character)}</i></span>
      <span class="character-kb-col">${characterKnowledgeTagsHtml({ character, knowledgeBases })}</span>
      <span class="character-number-col">${escapeHtml(character.chats)}</span>
      <span class="dt-act character-action-col"><a data-common-edit="${escapeAttr(character.id)}">编辑</a>${canArchive ? `<a class="danger" data-common-archive="${escapeAttr(character.id)}">下架</a>` : ""}${canPublish ? `<a class="restore" data-common-publish="${escapeAttr(character.id)}">上架</a>` : ""}</span>
    </div>
  `;
}

function creatorNickname(creator) {
  if (typeof creator === "object" && creator) return creator.nickname || "-";
  return String(creator || "-");
}

function creatorAccount(creator) {
  if (typeof creator === "object" && creator) return creator.account || "-";
  return "-";
}

function categoryLabel(category) {
  return category || "未分类";
}
