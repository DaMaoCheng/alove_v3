import { ICONS } from "../../icons/icons.js";
import { bindDropdowns } from "../shared-ui/dropdown.js";
import { escapeAttr } from "./admin-console-utils.js";
import { bindKnowledgeTargetPickers } from "./admin-knowledge-target-picker.js";

export function openKnowledgeEditorHost(html, onSubmit) {
  closeKnowledgeEditor();
  const host = document.createElement("div");
  host.id = "knowledgeEditorHost";
  host.className = "dialog-host account-form-host";
  host.innerHTML = html;
  document.body.append(host);
  document.body.classList.add("dialog-open");
  host.querySelectorAll("[data-kb-editor-close]").forEach((item) => item.addEventListener("click", closeKnowledgeEditor));
  bindDropdowns(host);
  bindCategoryCombo(host);
  bindKnowledgeScopeControls(host);
  bindKnowledgeTargetPickers(host);
  bindKnowledgeEditorSubmit(host, onSubmit);
  host.querySelector("input:not([readonly]), textarea:not([readonly]), [data-dd-trigger]")?.focus();
}

export function closeKnowledgeEditor() {
  document.body.classList.remove("dialog-open");
  document.getElementById("knowledgeEditorHost")?.remove();
}

export function loadingKnowledgeEditorHtml() {
  return `
    <div class="dialog-scrim" data-kb-editor-close></div>
    <div class="dlg common-character-modal knowledge-editor-modal" role="dialog" aria-modal="true">
      <div class="dlg-body"><h3>编辑知识库</h3><p>正在加载...</p></div>
    </div>`;
}

export function readCreatePayload(form) {
  const data = new FormData(form);
  return {
    label: data.get("label"),
    category: data.get("category") || normalizeCategoryKey(data.get("categoryLabel")) || "general",
    keywords: data.get("keywords"),
    fuzzyKeywords: data.get("fuzzyKeywords"),
    priority: data.get("priority"),
    scope: data.get("scope") || "targeted",
    siteIds: data.getAll("siteIds"),
    characterIds: data.getAll("characterIds"),
    sourceText: data.get("sections"),
  };
}

export function readKnowledgePayload(form) {
  return readCreatePayload(form);
}

function bindKnowledgeEditorSubmit(host, onSubmit) {
  host.querySelector("[data-kb-editor-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const knowledgeBaseId = String(new FormData(form).get("id") || "").trim();
    const submitButton = form.querySelector('button[type="submit"]');
    submitButton?.setAttribute("disabled", "disabled");
    await onSubmit?.({
      form,
      knowledgeBaseId,
      isCreate: !knowledgeBaseId,
      submitButton,
    });
  });
}

function bindCategoryCombo(root) {
  const combo = root.querySelector("[data-kb-category-combo]");
  if (!combo) return;
  const valueInput = combo.querySelector("[data-kb-category-value]");
  const labelInput = combo.querySelector("[data-kb-category-input]");
  const menu = combo.querySelector(".dd-menu");

  labelInput?.addEventListener("focus", () => combo.classList.add("open"));
  labelInput?.addEventListener("input", () => {
    if (valueInput) valueInput.value = normalizeCategoryKey(labelInput.value);
    combo.classList.add("open");
  });
  labelInput?.addEventListener("blur", () => {
    window.setTimeout(() => combo.classList.remove("open"), 120);
  });
  menu?.querySelectorAll("[data-kb-category-option]").forEach((option) => {
    option.addEventListener("mousedown", (event) => event.preventDefault());
    option.addEventListener("click", () => {
      if (valueInput) valueInput.value = option.dataset.kbCategoryOption || "general";
      if (labelInput) labelInput.value = option.dataset.kbCategoryLabel || categoryLabel(valueInput?.value);
      combo.classList.remove("open");
    });
  });
}

function bindKnowledgeScopeControls(root) {
  const scopeInput = root.querySelector("[data-kb-scope-value]");
  const update = () => {
    const scope = scopeInput?.value || "targeted";
    root.querySelectorAll("[data-kb-scope-panel]").forEach((panel) => {
      panel.hidden = panel.dataset.kbScopePanel !== scope;
    });
  };
  scopeInput?.addEventListener("change", update);
  root.querySelectorAll("[data-dd-item]").forEach((item) => item.addEventListener("click", () => window.setTimeout(update, 0)));
  update();
}

export function openKnowledgeAiWaitModal() {
  const host = document.createElement("div");
  host.className = "aigen-host knowledge-ai-wait-host";
  host.innerHTML = `
    <div class="dialog-scrim"></div>
    <div class="aigen-modal" role="dialog" aria-modal="true">
      <h3 class="aigen-title">${ICONS.spark} 生成知识文档</h3>
      <div class="aigen-body">
        <div class="aigen-loading">
          <div class="aigen-orb"><span class="cf-spin aigen-orb-spin"></span></div>
          <div class="aigen-loading-txt">AI 正在生成简介、目录和知识片段...</div>
          <div class="aigen-meta"><span>预计需要 1-2 分钟</span><span data-aigen-timer>00:00</span></div>
          <div class="aigen-bar"><i></i></div>
        </div>
      </div>
    </div>`;
  document.body.append(host);
  document.body.classList.add("aigen-open");
  const startedAt = Date.now();
  const timer = window.setInterval(() => {
    const seconds = Math.floor((Date.now() - startedAt) / 1000);
    const minutes = String(Math.floor(seconds / 60)).padStart(2, "0");
    const rest = String(seconds % 60).padStart(2, "0");
    const timerElement = host.querySelector("[data-aigen-timer]");
    if (timerElement) timerElement.textContent = `${minutes}:${rest}`;
  }, 500);
  return { host, timer };
}

export function closeKnowledgeAiWaitModal(waitModal) {
  if (waitModal?.timer) window.clearInterval(waitModal.timer);
  waitModal?.host?.remove();
  if (!document.querySelector(".aigen-host")) document.body.classList.remove("aigen-open");
}

const CATEGORY_LABELS = Object.freeze({
  customer_service: "客服话术",
  football: "足球",
  general: "通用",
});

function normalizeCategoryKey(value) {
  return String(value || "")
    .trim()
    .replace(/客服话术/g, "customer_service")
    .replace(/足球/g, "football")
    .replace(/通用/g, "general")
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5_-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 64);
}

function categoryLabel(category) {
  const value = String(category || "").trim();
  return CATEGORY_LABELS[value] || value || "通用";
}
