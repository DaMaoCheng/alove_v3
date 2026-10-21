import { ICONS } from "../../icons/icons.js";
import { escapeAttr, escapeHtml } from "./admin-console-utils.js";

export function bindKnowledgeTargetPickers(root) {
  root.querySelectorAll("[data-kb-target-picker]").forEach((picker) => bindKnowledgeTargetPicker(picker));
}

function bindKnowledgeTargetPicker(picker) {
  const type = picker.dataset.kbTargetPicker || "character";
  const name = picker.dataset.kbTargetName || (type === "site" ? "siteIds" : "characterIds");
  const search = picker.querySelector("[data-kb-target-search]");
  const trigger = picker.querySelector("[data-kb-target-trigger]");
  const menu = picker.querySelector("[data-kb-target-menu]");
  const values = picker.querySelector("[data-kb-target-values]");
  const current = picker.querySelector("[data-kb-target-current]");

  const open = () => {
    picker.classList.add("is-open");
    updateOptions();
  };
  const close = () => picker.classList.remove("is-open");
  const getOptions = () => Array.from(picker.querySelectorAll("[data-kb-target-option]"));
  const readSelected = () => new Set(Array.from(values?.querySelectorAll("[data-kb-target-value]") || []).map((input) => input.value).filter(Boolean));
  const writeSelected = (selected) => {
    if (!values) return;
    values.innerHTML = Array.from(selected).map((id) => `<input type="hidden" name="${escapeAttr(name)}" value="${escapeAttr(id)}" data-kb-target-value />`).join("");
  };
  const updateOptions = () => {
    const query = String(search?.value || "").trim().toLowerCase();
    let visibleCount = 0;
    getOptions().forEach((option) => {
      const searchable = option.dataset.kbTargetSearch || "";
      const isMascot = option.dataset.kbTargetType === "mascot";
      const visible = type === "site" || (query ? searchable.includes(query) : isMascot);
      option.hidden = !visible;
      if (visible) visibleCount += 1;
    });
    menu?.querySelector("[data-kb-target-empty-result]")?.remove();
    if (!visibleCount) {
      menu?.insertAdjacentHTML("beforeend", `<div class="knowledge-target-empty-result" data-kb-target-empty-result>没有匹配结果</div>`);
    }
  };
  const sync = () => {
    const selected = readSelected();
    const options = getOptions();
    const labels = options
      .filter((option) => selected.has(option.dataset.kbTargetOption || ""))
      .map((option) => ({
        id: option.dataset.kbTargetOption || "",
        label: option.dataset.kbTargetLabel || option.dataset.kbTargetOption || "",
      }));
    if (current) {
      current.innerHTML = labels.length
        ? labels.map((item) => `<i class="knowledge-target-chip" data-kb-target-chip="${escapeAttr(item.id)}">${escapeHtml(item.label)}</i>`).join("")
        : `<span class="muted-dash" data-kb-target-empty>未选择</span>`;
    }
    options.forEach((option) => {
      const active = selected.has(option.dataset.kbTargetOption || "");
      option.classList.toggle("is-active", active);
      option.querySelector("em")?.remove();
      if (active) option.insertAdjacentHTML("beforeend", `<em>${ICONS.check || ""}</em>`);
    });
  };
  const selectOption = (option) => {
    const id = option.dataset.kbTargetOption || "";
    if (!id) return;
    const selected = readSelected();
    if (selected.has(id)) selected.delete(id);
    else selected.add(id);
    writeSelected(selected);
    sync();
    updateOptions();
    if (type === "site") close();
    else search?.focus();
  };

  search?.addEventListener("focus", open);
  search?.addEventListener("click", open);
  search?.addEventListener("input", () => {
    open();
    updateOptions();
  });
  trigger?.addEventListener("click", (event) => {
    event.preventDefault();
    picker.classList.toggle("is-open");
    updateOptions();
  });
  picker.addEventListener("mousedown", (event) => {
    const option = event.target.closest("[data-kb-target-option]");
    if (option && picker.contains(option)) {
      event.preventDefault();
      selectOption(option);
    }
  });
  picker.addEventListener("click", (event) => {
    if (event.target.closest("[data-kb-target-option]")) event.preventDefault();
  });
  picker.addEventListener("focusout", () => window.setTimeout(() => {
    if (!picker.contains(document.activeElement)) close();
  }, 120));
  sync();
  updateOptions();
}
