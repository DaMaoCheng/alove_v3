import { ICONS } from "../../icons/icons.js";
import { characterAvatarHtml } from "../shared-ui/character-avatar.js";
import { selectDropdownHtml } from "../shared-ui/dropdown.js";
import { characterKnowledgeTagsHtml, goKnowledgeButtonHtml } from "./admin-character-knowledge-display.js";
import { canArchiveCharacter, characterStatusCellHtml } from "./admin-character-status.js";
import { escapeAttr, escapeHtml } from "./admin-console-utils.js";

export function adminCreatorCharactersHtml({ items = [], sites = [], knowledgeBases = [], activeSiteId = "all", query = "", loading = false, error = "" } = {}) {
  return `
    <div class="admin-body">
      <div class="admin-actions">
        <button class="btn btn-primary sm" type="button" data-creator-new>${ICONS.plus} 新建网红角色</button>
        ${goKnowledgeButtonHtml("creator")}
        ${creatorSiteFilterHtml(activeSiteId, sites)}
        <div class="admin-search">${ICONS.search}<input data-creator-search placeholder="搜索名称 / ID / 账号..." value="${escapeAttr(query)}" /></div>
      </div>
      <div class="panel">
        <div class="data-table admin-creator-table">
          <div class="dt-head"><span class="character-name-col">角色</span><span class="character-id-col">角色 ID</span><span class="character-account-col">对应账号</span><span class="character-site-col">所属站点</span><span class="character-status-col">状态</span><span class="character-kb-col">知识库</span><span class="character-number-col">对话数</span><span class="character-revenue-col">收入</span><span class="character-action-col"></span></div>
          ${creatorRowsHtml({ items, knowledgeBases, loading, error })}
        </div>
      </div>
      <p class="admin-hint">网红角色归属于具体站点，只在该站点的广场和搜索里出现；知识库绑定统一在知识库页面管理。</p>
    </div>
  `;
}

function creatorSiteFilterHtml(activeSiteId, sites) {
  return `<div class="creator-site-filter" data-creator-site-filter>${selectDropdownHtml({
    name: "creatorSiteFilter",
    value: activeSiteId,
    placeholder: "站点筛选",
    items: [["all", "全部站点"], ...sites.map((site) => [site.id, site.name])],
    className: "creator-site-dd",
  })}</div>`;
}

function creatorRowsHtml({ items, knowledgeBases, loading, error }) {
  if (loading) return `<div class="log-empty">正在加载网红角色...</div>`;
  if (error) return `<div class="log-empty">${escapeHtml(error)}</div>`;
  return items.length ? items.map((character) => creatorRowHtml(character, knowledgeBases)).join("") : `<div class="log-empty">暂无网红角色</div>`;
}

function creatorRowHtml(character, knowledgeBases = []) {
  const canArchive = canArchiveCharacter(character);
  return `
    <div class="dt-row" data-creator-site="${escapeHtml(character.siteId)}">
      <span class="dt-cell name character-name-col">${characterAvatarHtml({ name: character.name, imageUrl: character.avatarUrl })}<b class="character-table-name" title="${escapeAttr(character.name)}">${escapeHtml(character.name)}</b></span>
      <span class="character-id-col"><code title="${escapeAttr(character.id)}">${escapeHtml(character.id)}</code></span>
      <span class="dt-mail character-account-col" title="${escapeAttr(character.ownerAccount || "未绑定")}">${escapeHtml(character.ownerAccount || "未绑定")}</span>
      <span class="character-site-col"><i class="pill site character-table-pill" title="${escapeAttr(character.siteName || "未绑定站点")}">${escapeHtml(character.siteName || "未绑定站点")}</i></span>
      <span class="character-status-col">${characterStatusCellHtml(character)}</span>
      <span class="character-kb-col">${characterKnowledgeTagsHtml({ character, knowledgeBases })}</span>
      <span class="character-number-col">${escapeHtml(character.chats)}</span>
      <span class="dt-rev character-revenue-col">${escapeHtml(character.revenue || "-")}</span>
      <span class="dt-act character-action-col"><a data-creator-edit="${escapeAttr(character.id)}">编辑</a>${canArchive ? `<a class="danger" data-creator-archive="${escapeAttr(character.id)}">下架</a>` : ""}</span>
    </div>
  `;
}
