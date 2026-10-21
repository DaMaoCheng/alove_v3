import { createAdminKnowledgeBase, deleteAdminKnowledgeBase, getAdminKnowledgeBase, listAdminKnowledgeBases, updateAdminKnowledgeBase } from "../../services/admin-knowledge-service.js";
import { listAdminSites } from "../../services/admin-site-service.js";
import { listAdminCharacters } from "../../services/character-admin-service.js";
import { bindDropdowns, selectDropdownHtml } from "../shared-ui/dropdown.js";
import { showDialog } from "../shared-ui/dialog.js";
import { showToast } from "../shared-ui/toast.js";
import { adminLogsErrorHtml } from "./admin-console-content.js";
import { closeKnowledgeAiWaitModal, closeKnowledgeEditor, loadingKnowledgeEditorHtml, openKnowledgeAiWaitModal, openKnowledgeEditorHost, readCreatePayload, readKnowledgePayload } from "./admin-knowledge-editor.js";
import { adminKnowledgeTableHtml } from "./admin-knowledge-template.js";
import { adminKnowledgeEditorHtml } from "./admin-knowledge-editor-template.js";

const CATEGORY_LABELS = Object.freeze({
  customer_service: "客服话术",
  football: "足球",
  general: "通用",
});

export function bindAdminKnowledge(shell) {
  const table = shell.querySelector("[data-kb-table]");
  const searchInput = shell.querySelector("[data-kb-search]");
  const categoryFilterHost = shell.querySelector("[data-kb-category-filter]");
  if (!table) return;

  let state = {
    items: [],
    categories: [],
    query: "",
    category: "all",
    sites: [],
    characters: [],
    referencesLoaded: false,
    loading: true,
    error: "",
  };

  const renderTable = () => {
    table.innerHTML = adminKnowledgeTableHtml(state);
  };

  const renderCategoryFilter = () => {
    if (!categoryFilterHost) return;
    categoryFilterHost.innerHTML = selectDropdownHtml({
      name: "kbCategoryFilter",
      value: state.category,
      placeholder: "全部分类",
      className: "kb-filter-dd",
      items: [["all", "全部分类"], ...state.categories.map((category) => [category, categoryLabel(category)])],
    });
    bindDropdowns(categoryFilterHost);
    categoryFilterHost.querySelector("[data-dd-input]")?.addEventListener("change", (event) => {
      state = { ...state, category: event.currentTarget.value || "all" };
      renderTable();
    });
  };

  const load = async () => {
    state = { ...state, loading: true, error: "" };
    renderTable();
    try {
      const result = await listAdminKnowledgeBases();
      const items = result.items || [];
      state = {
        ...state,
        loading: false,
        items,
        categories: collectCategories(items),
        error: "",
      };
      renderCategoryFilter();
      renderTable();
    } catch (error) {
      state = { ...state, loading: false, error: error.message || "知识库读取失败" };
      table.innerHTML = adminLogsErrorHtml(state.error);
    }
  };

  const ensureReferenceData = async () => {
    if (state.referencesLoaded) return;
    const [siteResult, characterResult] = await Promise.all([
      listAdminSites(),
      listAdminCharacters(),
    ]);
    state = {
      ...state,
      sites: siteResult.items || [],
      characters: characterResult.items || [],
      referencesLoaded: true,
    };
  };

  const openCreateEditor = async () => {
    try {
      await ensureReferenceData();
    } catch (error) {
      showToast(error.message || "知识库绑定目标读取失败");
      return;
    }
    openKnowledgeEditorHost(adminKnowledgeEditorHtml({
      id: "",
      label: "",
      category: state.categories[0] || "general",
      scope: "targeted",
      siteIds: [],
      characterIds: [],
      priority: 40,
      keywords: [],
      fuzzyKeywords: [],
      sections: [],
    }, { categories: state.categories, mode: "create", sites: state.sites, characters: state.characters }), handleEditorSubmit);
  };

  const openEditEditor = async (knowledgeBaseId) => {
    if (!knowledgeBaseId) return;
    openKnowledgeEditorHost(loadingKnowledgeEditorHtml(), handleEditorSubmit);
    try {
      await ensureReferenceData();
      const result = await getAdminKnowledgeBase(knowledgeBaseId);
      openKnowledgeEditorHost(adminKnowledgeEditorHtml(result.item, { categories: state.categories, mode: "edit", sites: state.sites, characters: state.characters }), handleEditorSubmit);
    } catch (error) {
      closeKnowledgeEditor();
      showToast(error.message || "知识库详情读取失败");
    }
  };

  const confirmDeleteKnowledge = (knowledgeBaseId) => {
    const item = state.items.find((entry) => entry.id === knowledgeBaseId);
    if (!knowledgeBaseId || !item) return;
    showDialog({
      type: "warning",
      title: "确认删除知识库",
      message: `删除后，${item.label || item.id} 会从知识库中移除，已绑定对象里的对应设置也会同步清除。`,
      confirmText: "确认删除",
      cancelText: "取消",
      onConfirm: async () => {
        try {
          await deleteAdminKnowledgeBase(knowledgeBaseId);
          state.items = state.items.filter((entry) => entry.id !== knowledgeBaseId);
          state.categories = collectCategories(state.items);
          renderCategoryFilter();
          renderTable();
          showToast("知识库已删除");
        } catch (error) {
          showToast(error.message || "知识库删除失败");
        }
      },
    });
  };

  const handleEditorSubmit = async ({ form, knowledgeBaseId, isCreate, submitButton }) => {
    const waitModal = isCreate ? openKnowledgeAiWaitModal() : null;
    try {
      if (isCreate) {
        await createAdminKnowledgeBase(readCreatePayload(form));
      } else {
        await updateAdminKnowledgeBase(knowledgeBaseId, readKnowledgePayload(form));
      }
      closeKnowledgeAiWaitModal(waitModal);
      closeKnowledgeEditor();
      await load();
      showToast(isCreate ? "知识文档已保存" : "知识库设置已保存");
    } catch (error) {
      closeKnowledgeAiWaitModal(waitModal);
      showToast(error.message || (isCreate ? "知识文档保存失败" : "知识库保存失败"));
      submitButton?.removeAttribute("disabled");
    }
  };

  searchInput?.addEventListener("input", (event) => {
    state = { ...state, query: event.currentTarget.value || "" };
    renderTable();
  });

  shell.addEventListener("click", (event) => {
    const newButton = event.target.closest("[data-kb-new]");
    if (newButton) {
      event.preventDefault();
      openCreateEditor();
      return;
    }

    const editButton = event.target.closest("[data-kb-edit]");
    if (editButton) {
      event.preventDefault();
      openEditEditor(editButton.dataset.kbEdit);
      return;
    }

    const deleteButton = event.target.closest("[data-kb-delete]");
    if (deleteButton) {
      event.preventDefault();
      confirmDeleteKnowledge(deleteButton.dataset.kbDelete);
    }
  });

  load();
}

function collectCategories(items) {
  const seen = new Set();
  return (items || []).map((item) => String(item.category || "").trim()).filter(Boolean).filter((category) => {
    const key = category.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function categoryLabel(category) {
  const value = String(category || "").trim();
  return CATEGORY_LABELS[value] || value || "通用";
}
