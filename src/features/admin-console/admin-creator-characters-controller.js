import { listAdminSites } from "../../services/admin-site-service.js";
import { createAdminCharacter, listAdminCharacters, updateAdminCharacterSettings } from "../../services/character-admin-service.js";
import { listAdminAccounts } from "../../services/admin-account-service.js";
import { listAdminKnowledgeBases } from "../../services/admin-knowledge-service.js";
import { bindAutoResizeTextareas } from "../shared-ui/auto-resize-textarea.js";
import { bindDropdowns } from "../shared-ui/dropdown.js";
import { showDialog } from "../shared-ui/dialog.js";
import { showToast } from "../shared-ui/toast.js";
import { bindAdminCharacterAiControls } from "./admin-character-ai-controls.js";
import { bindAdminCreatorAccountPicker } from "./admin-creator-account-picker.js";
import { adminCharacterEditorHtml } from "./admin-character-editor-template.js";
import { bindAdminCharacterAvatarControls } from "./admin-character-avatar-controls.js";
import { bindAdminCharacterEditorControls } from "./admin-character-editor-controls.js";
import { canArchiveCharacter } from "./admin-character-status.js";
import { mapAdminCharacterForConsole, mapConsoleCharacterPayload } from "./admin-character-mapper.js";
import { adminCreatorCharactersHtml } from "./admin-console-creator-characters-template.js";
import { bindKnowledgeManagementLinks } from "./admin-character-knowledge-display.js";

let creatorSearchTimer = null;
let creatorEditorAbortController = null;

export function bindAdminCreatorCharacters(root) {
  const main = root.querySelector("#adminMain") || root;
  const state = {
    items: [],
    sites: [],
    knowledgeBases: [],
    creatorAccounts: [],
    activeSiteId: "all",
    query: "",
    loading: true,
    error: "",
  };

  const visibleItems = () => state.activeSiteId === "all"
    ? state.items
    : state.items.filter((item) => item.siteId === state.activeSiteId);

  const render = ({ keepFocus = false } = {}) => {
    const topbar = main.querySelector(".admin-top");
    main.innerHTML = adminCreatorCharactersHtml({
      items: visibleItems(),
      sites: state.sites,
      knowledgeBases: state.knowledgeBases,
      activeSiteId: state.activeSiteId,
      query: state.query,
      loading: state.loading,
      error: state.error,
    });
    if (topbar) main.prepend(topbar);
    bindKnowledgeManagementLinks(main);
    bindRows(main, state, render, load);
    bindDropdowns(main);
    const search = main.querySelector("[data-creator-search]");
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
      const [charactersResult, sitesResult, knowledgeResult] = await Promise.all([
        listAdminCharacters({ query: state.query, type: "creator" }),
        listAdminSites(),
        listAdminKnowledgeBases(),
      ]);
      state.sites = sitesResult.items || [];
      state.knowledgeBases = knowledgeResult.items || [];
      state.items = (charactersResult.items || [])
        .map(mapAdminCharacterForConsole)
        .filter((item) => item.categoryId === "creator");
      state.creatorAccounts = await loadCreatorAccountCandidates(state);
      state.loading = false;
      state.error = "";
      render({ keepFocus });
    } catch (error) {
      state.loading = false;
      state.error = error.message || "网红角色读取失败";
      render({ keepFocus });
    }
  };

  void load();
}

function bindRows(root, state, render, load) {
  root.querySelector('input[name="creatorSiteFilter"]')?.addEventListener("change", (event) => {
    state.activeSiteId = event.target?.value || "all";
    render();
  });
  root.querySelector("[data-creator-search]")?.addEventListener("input", (event) => {
    state.query = event.target?.value || "";
    clearTimeout(creatorSearchTimer);
    creatorSearchTimer = setTimeout(() => load?.({ keepFocus: true }), 300);
  });
  root.querySelector("[data-creator-new]")?.addEventListener("click", () => openCreatorCreator(state, render));

  root.querySelectorAll("[data-creator-edit]").forEach((button) => {
    button.addEventListener("click", () => openCreatorEditor(button.dataset.creatorEdit || "", state, render));
  });
  root.querySelectorAll("[data-creator-archive]").forEach((button) => {
    button.addEventListener("click", () => confirmArchive(button.dataset.creatorArchive || "", state, render));
  });
}

function openCreatorCreator(state, render) {
  closeCreatorEditor();
  creatorEditorAbortController = new AbortController();
  const host = document.createElement("div");
  host.id = "creatorCharacterEditorHost";
  host.className = "dialog-host account-form-host";
  host.innerHTML = adminCharacterEditorHtml({ character: newCreatorCharacterDraft(state.sites), mode: "creator", title: "新建网红角色", sites: state.sites, creatorAccounts: availableCreatorAccounts(state), isCreate: true });
  document.body.append(host);
  document.body.classList.add("dialog-open");
  host.querySelectorAll("[data-character-editor-close]").forEach((item) => item.addEventListener("click", closeCreatorEditor));
  bindAdminCharacterAvatarControls(host);
  bindAdminCharacterAiControls(host);
  bindAdminCreatorAccountPicker(host, { signal: creatorEditorAbortController.signal });
  host.querySelector("form")?.addEventListener("submit", (event) => submitCreatorCreator(event, state, render));
  bindAdminCharacterEditorControls(host, {
    onSync: () => bindDropdowns(host),
    signal: creatorEditorAbortController.signal,
  });
  bindDropdowns(host);
  bindAutoResizeTextareas(host);
}

function openCreatorEditor(characterId, state, render) {
  const character = state.items.find((item) => item.id === characterId);
  if (!character) return;
  closeCreatorEditor();
  creatorEditorAbortController = new AbortController();
  const host = document.createElement("div");
  host.id = "creatorCharacterEditorHost";
  host.className = "dialog-host account-form-host";
  host.innerHTML = adminCharacterEditorHtml({ character, mode: "creator", title: "编辑网红角色", sites: state.sites, creatorAccounts: state.creatorAccounts });
  document.body.append(host);
  document.body.classList.add("dialog-open");
  host.querySelectorAll("[data-character-editor-close]").forEach((item) => item.addEventListener("click", closeCreatorEditor));
  bindAdminCharacterAvatarControls(host);
  bindAdminCharacterAiControls(host);
  host.querySelector("form")?.addEventListener("submit", (event) => submitCreatorEditor(event, characterId, state, render));
  bindAdminCharacterEditorControls(host, {
    onSync: () => bindDropdowns(host),
    signal: creatorEditorAbortController.signal,
  });
  bindDropdowns(host);
}

function closeCreatorEditor() {
  creatorEditorAbortController?.abort();
  creatorEditorAbortController = null;
  document.body.classList.remove("dialog-open");
  document.getElementById("creatorCharacterEditorHost")?.remove();
}

async function submitCreatorCreator(event, state, render) {
  event.preventDefault();
  const form = event.currentTarget;
  const errorBox = form.querySelector("[data-character-editor-error]");
  const submitButton = form.querySelector('button[type="submit"]');
  setFormBusy(submitButton, errorBox, true, "");
  try {
    const payload = mapConsoleCharacterPayload(new FormData(form), { mode: "creator" });
    const result = await createAdminCharacter(payload);
    const saved = withCurrentSiteName(mapAdminCharacterForConsole(result.character), state.sites);
    state.items = [saved, ...state.items.filter((item) => item.id !== saved.id)].filter((item) => item.categoryId === "creator");
    closeCreatorEditor();
    showToast("网红角色已创建");
    render?.();
  } catch (error) {
    setFormBusy(submitButton, errorBox, false, error.message || "创建失败，请稍后再试");
  }
}

async function submitCreatorEditor(event, characterId, state, render) {
  event.preventDefault();
  const form = event.currentTarget;
  const errorBox = form.querySelector("[data-character-editor-error]");
  const submitButton = form.querySelector('button[type="submit"]');
  setFormBusy(submitButton, errorBox, true, "");
  try {
    const payload = mapConsoleCharacterPayload(new FormData(form), { mode: "creator" });
    const result = await updateAdminCharacterSettings(characterId, payload);
    const saved = withCurrentSiteName(mapAdminCharacterForConsole(result.character), state.sites);
    state.items = state.items.map((item) => item.id === saved.id ? saved : item).filter((item) => item.categoryId === "creator");
    closeCreatorEditor();
    showToast("网红角色设置已保存");
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
    message: `下架后，${character.name} 将不再作为可用网红角色展示。`,
    confirmText: "确认下架",
    cancelText: "取消",
    onConfirm: async () => {
      try {
        const result = await updateAdminCharacterSettings(characterId, { ...character, characterStatus: "archived", status: "archived" });
        const saved = withCurrentSiteName(mapAdminCharacterForConsole(result.character), state.sites);
        state.items = state.items.map((item) => item.id === saved.id ? saved : item);
        showToast("角色已下架");
        render?.();
      } catch (error) {
        showToast(error.message || "下架失败，请稍后再试");
      }
    },
  });
}

function withCurrentSiteName(character, sites) {
  if (character.siteName && character.siteName !== "未绑定站点") return character;
  const site = sites.find((item) => item.id === character.siteId);
  return { ...character, siteName: site?.name || "未绑定站点" };
}

async function loadCreatorAccountCandidates(state) {
  const result = await listAdminAccounts({ page: 1, limit: 50, type: "creator" });
  return (result.items || []).map((account) => ({
    id: account.id || "",
    name: account.username || account.email || account.id || "未命名账号",
    email: account.email || "",
    siteId: account.siteId || "",
    siteName: account.siteName || "未绑定站点",
    siteSlug: account.siteSlug || "",
  }));
}

function availableCreatorAccounts(state) {
  const usedOwnerIds = new Set(state.items.filter((item) => item.status !== "archived").map((item) => item.ownerUid).filter(Boolean));
  return state.creatorAccounts.filter((account) => !usedOwnerIds.has(account.id));
}

function newCreatorCharacterDraft(sites = []) {
  return {
    id: "",
    name: "",
    roleTitle: "Creator · Football kits",
    ownerAccount: "未绑定",
    categoryId: "creator",
    shortBio: "",
    personality: "Cheeky banter",
    voice: "Bright & playful",
    language: "English",
    visibility: "public",
    status: "published",
    siteId: sites[0]?.id || "",
    siteName: sites[0]?.name || "未绑定站点",
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
