import { createAdminCharacter, listAdminCharacters, updateAdminCharacterSettings } from "../../services/character-admin-service.js";
import { listAdminKnowledgeBases } from "../../services/admin-knowledge-service.js";
import { bindAutoResizeTextareas } from "../shared-ui/auto-resize-textarea.js";
import { bindDropdowns } from "../shared-ui/dropdown.js";
import { showDialog } from "../shared-ui/dialog.js";
import { showToast } from "../shared-ui/toast.js";
import { bindAdminCharacterAiControls } from "./admin-character-ai-controls.js";
import { adminCharacterEditorHtml } from "./admin-character-editor-template.js";
import { bindAdminCharacterAvatarControls } from "./admin-character-avatar-controls.js";
import { bindAdminCharacterEditorControls } from "./admin-character-editor-controls.js";
import { canArchiveCharacter } from "./admin-character-status.js";
import { ADMIN_CHARACTER_CREATOR, mapAdminCharacterForConsole, mapConsoleCharacterPayload } from "./admin-character-mapper.js";
import { adminCommonCharactersHtml } from "./admin-console-common-characters-template.js";
import { bindKnowledgeManagementLinks } from "./admin-character-knowledge-display.js";

let commonSearchTimer = null;
let commonEditorAbortController = null;

export function bindAdminCommonCharacters(shell) {
  const main = shell.querySelector("#adminMain");
  if (!main) return;

  const state = {
    items: [],
    knowledgeBases: [],
    query: "",
    loading: true,
    error: "",
  };

  const render = ({ keepFocus = false } = {}) => {
    const topbar = main.querySelector(".admin-top");
    main.innerHTML = adminCommonCharactersHtml(state);
    if (topbar) main.prepend(topbar);
    bindKnowledgeManagementLinks(main);
    bindRows(main, state, render, load);
    const search = main.querySelector("[data-common-search]");
    if (keepFocus && search instanceof HTMLInputElement) {
      search.focus();
      search.setSelectionRange(search.value.length, search.value.length);
    }
  };

  const load = async ({ keepFocus = false } = {}) => {
    state.loading = true;
    state.error = "";
    render({ keepFocus });
    try {
      const [result, knowledgeResult] = await Promise.all([
        listAdminCharacters({ query: state.query, type: "common" }),
        listAdminKnowledgeBases(),
      ]);
      state.items = (result.items || [])
        .map(mapAdminCharacterForConsole)
        .filter(isCommonCharacter);
      state.knowledgeBases = knowledgeResult.items || [];
      state.loading = false;
      state.error = "";
      render({ keepFocus });
    } catch (error) {
      state.loading = false;
      state.error = error.message || "通用角色读取失败";
      render({ keepFocus });
    }
  };

  void load();
}

function bindRows(root, state, render, load) {
  root.querySelector("[data-common-search]")?.addEventListener("input", (event) => {
    state.query = event.target?.value || "";
    clearTimeout(commonSearchTimer);
    commonSearchTimer = setTimeout(() => load?.({ keepFocus: true }), 300);
  });
  root.querySelector("[data-common-new]")?.addEventListener("click", () => openCommonCreator(state, render));
  root.querySelectorAll("[data-common-edit]").forEach((button) => {
    button.addEventListener("click", () => openCommonEditor(button.dataset.commonEdit || "", state, render));
  });
  root.querySelectorAll("[data-common-archive]").forEach((button) => {
    button.addEventListener("click", () => confirmArchive(button.dataset.commonArchive || "", state, render));
  });
  root.querySelectorAll("[data-common-publish]").forEach((button) => {
    button.addEventListener("click", () => confirmPublish(button.dataset.commonPublish || "", state, render));
  });
}

function openCommonCreator(state, render) {
  closeCommonEditor();
  commonEditorAbortController = new AbortController();
  const host = document.createElement("div");
  host.id = "commonCharacterEditorHost";
  host.className = "dialog-host account-form-host";
  host.innerHTML = adminCharacterEditorHtml({ character: newCommonCharacterDraft(), mode: "common", title: "新建通用角色", isCreate: true });
  document.body.append(host);
  document.body.classList.add("dialog-open");
  host.querySelectorAll("[data-character-editor-close]").forEach((item) => item.addEventListener("click", closeCommonEditor));
  bindAdminCharacterAvatarControls(host);
  bindAdminCharacterAiControls(host);
  host.querySelector("form")?.addEventListener("submit", (event) => submitCommonCreator(event, state, render));
  bindAdminCharacterEditorControls(host, {
    onSync: () => bindDropdowns(host),
    signal: commonEditorAbortController.signal,
  });
  bindDropdowns(host);
  bindAutoResizeTextareas(host);
}

function openCommonEditor(characterId, state, render) {
  const character = state.items.find((item) => item.id === characterId);
  if (!character) return;
  closeCommonEditor();
  commonEditorAbortController = new AbortController();
  const host = document.createElement("div");
  host.id = "commonCharacterEditorHost";
  host.className = "dialog-host account-form-host";
  host.innerHTML = adminCharacterEditorHtml({ character, mode: "common", title: "编辑通用角色" });
  document.body.append(host);
  document.body.classList.add("dialog-open");
  host.querySelectorAll("[data-character-editor-close]").forEach((item) => item.addEventListener("click", closeCommonEditor));
  bindAdminCharacterAvatarControls(host);
  bindAdminCharacterAiControls(host);
  host.querySelector("form")?.addEventListener("submit", (event) => submitCommonEditor(event, characterId, state, render));
  bindAdminCharacterEditorControls(host, {
    onSync: () => bindDropdowns(host),
    signal: commonEditorAbortController.signal,
  });
  bindDropdowns(host);
  bindAutoResizeTextareas(host);
}

function closeCommonEditor() {
  commonEditorAbortController?.abort();
  commonEditorAbortController = null;
  document.body.classList.remove("dialog-open");
  document.getElementById("commonCharacterEditorHost")?.remove();
}

function isCommonCharacter(item) {
  return !["creator", "mascot"].includes(item.categoryId);
}

async function submitCommonCreator(event, state, render) {
  event.preventDefault();
  const form = event.currentTarget;
  const errorBox = form.querySelector("[data-character-editor-error]");
  const submitButton = form.querySelector('button[type="submit"]');
  setFormBusy(submitButton, errorBox, true, "");
  try {
    const payload = mapConsoleCharacterPayload(new FormData(form), { mode: "common" });
    const result = await createAdminCharacter(payload);
    const saved = mapAdminCharacterForConsole(result.character);
    if (isCommonCharacter(saved)) state.items = [saved, ...state.items.filter((item) => item.id !== saved.id)];
    closeCommonEditor();
    showToast("通用角色已创建");
    render?.();
  } catch (error) {
    setFormBusy(submitButton, errorBox, false, error.message || "创建失败，请稍后再试");
  }
}

async function submitCommonEditor(event, characterId, state, render) {
  event.preventDefault();
  const form = event.currentTarget;
  const errorBox = form.querySelector("[data-character-editor-error]");
  const submitButton = form.querySelector('button[type="submit"]');
  setFormBusy(submitButton, errorBox, true, "");
  try {
    const payload = mapConsoleCharacterPayload(new FormData(form), { mode: "common" });
    const result = await updateAdminCharacterSettings(characterId, payload);
    const saved = mapAdminCharacterForConsole(result.character);
    state.items = state.items.map((item) => item.id === saved.id ? saved : item).filter(isCommonCharacter);
    closeCommonEditor();
    showToast("通用角色设置已保存");
    render?.();
  } catch (error) {
    setFormBusy(submitButton, errorBox, false, error.message || "保存失败，请稍后再试");
  }
}

function confirmArchive(characterId, state, render) {
  const character = state.items.find((item) => item.id === characterId);
  if (!character) return;
  if (!canArchiveCharacter(character)) {
    showToast("该角色当前不可下架");
    return;
  }
  showDialog({
    type: "warning",
    title: "确认下架角色",
    message: `下架后，${character.name} 将不再作为可用通用角色展示。`,
    confirmText: "确认下架",
    cancelText: "取消",
    onConfirm: async () => {
      try {
        const result = await updateAdminCharacterSettings(characterId, { ...character, characterStatus: "archived", status: "archived" });
        const saved = mapAdminCharacterForConsole(result.character);
        state.items = state.items.map((item) => item.id === saved.id ? saved : item);
        showToast("角色已下架");
        render?.();
      } catch (error) {
        showToast(error.message || "下架失败，请稍后再试");
      }
    },
  });
}

function confirmPublish(characterId, state, render) {
  const character = state.items.find((item) => item.id === characterId);
  if (!character) return;
  showDialog({
    type: "warning",
    title: "确认上架角色",
    message: `上架后，${character.name} 将恢复公开展示，已激活用户也可以继续聊天。`,
    confirmText: "确认上架",
    cancelText: "取消",
    onConfirm: async () => {
      try {
        const result = await updateAdminCharacterSettings(characterId, { ...character, characterStatus: "published", status: "published" });
        const saved = mapAdminCharacterForConsole(result.character);
        state.items = state.items.map((item) => item.id === saved.id ? saved : item);
        showToast("角色已上架");
        render?.();
      } catch (error) {
        showToast(error.message || "上架失败，请稍后再试");
      }
    },
  });
}

function newCommonCharacterDraft() {
  return {
    id: "",
    name: "",
    roleTitle: "",
    creator: {
      nickname: ADMIN_CHARACTER_CREATOR.nickname,
      account: ADMIN_CHARACTER_CREATOR.account,
    },
    categoryId: "companion",
    shortBio: "",
    personality: "Calm mentor",
    voice: "Warm & friendly",
    voiceId: "",
    language: "",
    visibility: "public",
    status: "published",
    openingLine: "",
    backstory: "",
    avatarUrl: "",
  };
}

function setFormBusy(button, errorBox, busy, message) {
  if (button) button.disabled = busy;
  if (!errorBox) return;
  errorBox.hidden = !message;
  errorBox.textContent = message || "";
}
