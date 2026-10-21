import { listAdminCharacters, updateAdminCharacterSettings } from "../../services/character-admin-service.js";
import { bindDropdowns } from "../shared-ui/dropdown.js";
import { adminAgentEditorHtml, adminAgentListHtml, adminLogsErrorHtml } from "./admin-console-content.js";
import { setSavingState } from "./admin-form-utils.js";

export function bindAdminAgents(shell) {
  const list = shell.querySelector("[data-agent-list]");
  const editor = shell.querySelector("[data-agent-editor]");
  const count = shell.querySelector("[data-agent-count]");
  const status = shell.querySelector("[data-agent-form-status]");
  const search = shell.querySelector("[data-agent-search]");
  if (!list || !editor) return;

  let items = [];
  let activeId = "";
  let query = "";

  const getFilteredItems = () => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return items;
    return items.filter((item) => [item.name, item.roleTitle, item.shortBio, item.category?.label]
      .some((value) => String(value || "").toLowerCase().includes(normalizedQuery)));
  };

  const render = () => {
    const filteredItems = getFilteredItems();
    const activeCharacter = items.find((item) => item.id === activeId) || filteredItems[0] || null;
    activeId = activeCharacter?.id || "";
    list.innerHTML = adminAgentListHtml(filteredItems, activeId);
    editor.innerHTML = adminAgentEditorHtml(activeCharacter);
    if (count) count.textContent = `${filteredItems.length} 个角色`;
    if (status) status.textContent = activeCharacter ? `正在编辑：${activeCharacter.name}` : "请选择角色";
    bindAgentRows();
    bindAgentForm(activeCharacter);
    bindDropdowns(shell);
    bindAgentStatusDropdown(editor);
  };

  const bindAgentRows = () => {
    list.querySelectorAll("[data-agent-id]").forEach((row) => {
      row.addEventListener("click", () => {
        activeId = row.dataset.agentId || "";
        render();
      });
    });
  };

  const bindAgentForm = (character) => {
    const form = editor.querySelector("[data-agent-form]");
    if (!form || !character) return;

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const saveButton = form.querySelector("[data-agent-save]");
      const tip = form.querySelector("[data-agent-save-tip]");
      setSavingState(saveButton, tip, true, "保存中...");
      try {
        const result = await updateAdminCharacterSettings(character.id, readAgentFormPayload(form));
        const updatedCharacter = result.character;
        if (updatedCharacter) {
          items = items.map((current) => current.id === updatedCharacter.id ? updatedCharacter : current);
          activeId = updatedCharacter.id;
        }
        render();
        const nextTip = editor.querySelector("[data-agent-save-tip]");
        if (nextTip) nextTip.textContent = "已保存，新的设置会用于后续对话。";
      } catch (error) {
        setSavingState(saveButton, tip, false, error.message || "保存失败，请稍后再试");
      }
    });
  };

  const bindAgentStatusDropdown = (root) => {
    const statusDropdown = root.querySelector(".agent-status-dd");
    const statusInput = statusDropdown?.querySelector('input[name="characterStatus"]');
    if (!statusDropdown || !statusInput) return;
    const syncStatusTone = () => {
      statusDropdown.classList.toggle("is-danger-status", statusInput.value === "archived");
    };
    syncStatusTone();
    statusInput.addEventListener("change", syncStatusTone);
  };

  const load = async () => {
    list.innerHTML = `<div class="log-empty">正在加载角色...</div>`;
    try {
      const result = await listAdminCharacters();
      items = result.items || [];
      activeId = items[0]?.id || "";
      render();
    } catch (error) {
      list.innerHTML = adminLogsErrorHtml(error.message);
      editor.innerHTML = `<div class="log-empty">角色设置读取失败</div>`;
      if (count) count.textContent = "读取失败";
    }
  };

  search?.addEventListener("input", () => {
    query = search.value || "";
    render();
  });

  load();
}

function readAgentFormPayload(form) {
  const data = new FormData(form);
  return {
    name: data.get("name"),
    roleTitle: data.get("roleTitle"),
    shortBio: data.get("shortBio"),
    avatarUrl: data.get("avatarUrl"),
    categoryId: data.get("categoryId"),
    categoryLabel: labelForCreateCategory(data.get("categoryId")),
    personality: data.get("personality"),
    language: data.get("language"),
    voiceId: data.get("voiceId"),
    voiceStyle: data.get("voiceStyle"),
    openingLine: data.get("openingLine"),
    backstory: data.get("backstory"),
    visibility: data.get("visibility"),
    characterStatus: data.get("characterStatus"),
  };
}

function labelForCreateCategory(value) {
  return {
    Babe: "Football Babe",
    Creator: "Creator",
    Pundit: "Pundit",
    Fan: "Fan",
    Companion: "Companion",
  }[String(value || "")] || "Football Babe";
}
