import {
  createAdminDiscountCode,
  searchAdminShopifyDiscountCodes,
  updateAdminDiscountCode,
} from "../../services/discount-code-service.js";
import { bindDropdowns } from "../shared-ui/dropdown.js";
import { showToast } from "../shared-ui/toast.js";
import {
  adminDiscountCodeEditorModalHtml,
  creatorSelectHtml,
  shopifyDiscountRulePreviewHtml,
  shopifyDiscountSearchResultsHtml,
} from "./admin-discount-codes-template.js";
import { setSavingState } from "./admin-form-utils.js";

const EDITOR_HOST_ID = "discountCodeEditorHost";

export function openDiscountCodeEditor({ item = null, options = {}, onSaved = null } = {}) {
  closeDiscountCodeEditor();
  const host = document.createElement("div");
  host.id = EDITOR_HOST_ID;
  host.className = "dialog-host account-form-host";
  host.innerHTML = adminDiscountCodeEditorModalHtml(item, options);
  document.body.append(host);
  document.body.classList.add("dialog-open");
  host.querySelectorAll("[data-discount-code-close]").forEach((button) => button.addEventListener("click", closeDiscountCodeEditor));
  bindDropdowns(host);
  bindDiscountCodeDependencies(host, options.creators || []);
  bindShopifyDiscountPicker(host);
  bindDiscountCodeForm(host, { item, onSaved });
}

export function closeDiscountCodeEditor() {
  document.body.classList.remove("dialog-open");
  document.getElementById(EDITOR_HOST_ID)?.remove();
}

function bindDiscountCodeDependencies(host, creators) {
  const form = host.querySelector("[data-discount-code-form]");
  const creatorField = host.querySelector("[data-discount-code-creator-field]");
  const creatorHost = host.querySelector("[data-discount-code-creator-select]");
  if (!form) return;

  const syncOwner = () => {
    const isCreator = form.elements.ownershipType.value === "creator";
    if (creatorField) creatorField.hidden = !isCreator;
  };
  const syncCreators = () => {
    if (!creatorHost) return;
    creatorHost.innerHTML = creatorSelectHtml("", form.elements.siteId.value, creators);
    bindDropdowns(creatorHost);
  };

  form.elements.siteId?.addEventListener("change", syncCreators);
  form.querySelectorAll('[name="ownershipType"]').forEach((input) => input.addEventListener("change", syncOwner));
  syncOwner();
}

function bindShopifyDiscountPicker(host) {
  const form = host.querySelector("[data-discount-code-form]");
  const query = host.querySelector("[data-discount-code-shopify-query]");
  const selected = host.querySelector("[data-discount-code-shopify-selected]");
  const selectedLabel = host.querySelector("[data-discount-code-shopify-selected-label]");
  const results = host.querySelector("[data-discount-code-shopify-results]");
  const ruleCard = host.querySelector("[data-discount-code-rule-card]");
  const siteSelect = form?.elements?.siteId;
  if (!form || !query || !selected || !results || !ruleCard) return;

  let items = [];
  let requestSequence = 0;
  const setResultsOpen = (open) => {
    results.hidden = !open;
    query.setAttribute("aria-expanded", open ? "true" : "false");
  };

  const clearSelection = ({ clearQuery = false } = {}) => {
    requestSequence += 1;
    items = [];
    selected.value = "";
    if (clearQuery) query.value = "";
    if (selectedLabel) {
      selectedLabel.textContent = "";
      selectedLabel.hidden = true;
    }
    ruleCard.innerHTML = shopifyDiscountRulePreviewHtml({});
    setResultsOpen(false);
    results.innerHTML = "";
    results.classList.remove("is-error");
  };

  siteSelect?.addEventListener("change", () => clearSelection({ clearQuery: true }));

  query.addEventListener("input", () => {
    if (String(selected.value || "").toLowerCase() !== String(query.value || "").trim().toLowerCase()) {
      clearSelection();
    }
    window.clearTimeout(query.__discountCodeShopifyTimer || 0);
    query.__discountCodeShopifyTimer = window.setTimeout(async () => {
      const siteId = String(siteSelect?.value || "").trim();
      const text = String(query.value || "").trim();
      const sequence = ++requestSequence;
      if (!siteId || text.length < 2) {
        setResultsOpen(false);
        return;
      }
      setResultsOpen(true);
      results.classList.remove("is-error");
      results.innerHTML = `<div class="discount-code-shopify-empty">正在搜索 Shopify 折扣码...</div>`;
      try {
        const response = await searchAdminShopifyDiscountCodes(siteId, text);
        if (sequence !== requestSequence) return;
        items = Array.isArray(response.items) ? response.items : [];
        results.innerHTML = shopifyDiscountSearchResultsHtml(items);
      } catch (error) {
        if (sequence !== requestSequence) return;
        items = [];
        results.textContent = error.message || "Shopify 折扣码搜索失败";
        results.classList.add("is-error");
      }
    }, 300);
  });
  query.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setResultsOpen(false);
      return;
    }
    if (event.key !== "ArrowDown" || results.hidden) return;
    const options = [...results.querySelectorAll("[data-discount-code-shopify-option]")];
    if (!options.length) return;
    event.preventDefault();
    options[0].focus();
  });

  results.addEventListener("click", (event) => {
    const row = event.target.closest("[data-discount-code-shopify-option]");
    if (!row) return;
    const code = String(row.dataset.discountCodeShopifyOption || "").trim();
    const item = items.find((candidate) => String(candidate.code || "").toLowerCase() === code.toLowerCase());
    if (!item) return;
    selected.value = item.code || "";
    query.value = item.code || "";
    if (selectedLabel) {
      selectedLabel.textContent = `${item.code} · 已匹配 Shopify`;
      selectedLabel.hidden = false;
    }
    ruleCard.innerHTML = shopifyDiscountRulePreviewHtml(item);
    results.classList.remove("is-error");
    setResultsOpen(false);
    query.focus();
  });
  results.addEventListener("keydown", (event) => {
    const options = [...results.querySelectorAll("[data-discount-code-shopify-option]")];
    const index = options.indexOf(event.target.closest("[data-discount-code-shopify-option]"));
    if (index < 0) return;
    if (event.key === "Escape") {
      event.preventDefault();
      setResultsOpen(false);
      query.focus();
      return;
    }
    if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
    event.preventDefault();
    const nextIndex = event.key === "ArrowDown"
      ? Math.min(options.length - 1, index + 1)
      : index - 1;
    if (nextIndex < 0) query.focus();
    else options[nextIndex].focus();
  });

  if (query.value && !selected.value) query.dispatchEvent(new Event("input", { bubbles: true }));
}

function bindDiscountCodeForm(host, { item, onSaved }) {
  const form = host.querySelector("[data-discount-code-form]");
  if (!form) return;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const saveButton = form.querySelector("[data-discount-code-save]");
    const tip = form.querySelector("[data-discount-code-save-tip]");
    setSavingState(saveButton, tip, true, "保存中...");
    try {
      const payload = readDiscountCodePayload(form);
      assertClientPayload(payload);
      const { selectedShopifyCode: _selectedShopifyCode, ...requestPayload } = payload;
      const result = item?.id
        ? await updateAdminDiscountCode(item.id, requestPayload)
        : await createAdminDiscountCode(requestPayload);
      closeDiscountCodeEditor();
      await onSaved?.(result);
      showToast(`已保存：${result.item?.code || payload.code}`);
    } catch (error) {
      setSavingState(saveButton, tip, false, error.message || "保存失败，请稍后再试");
    }
  });
}

function readDiscountCodePayload(form) {
  const data = new FormData(form);
  return {
    code: data.get("code"),
    selectedShopifyCode: form.querySelector("[data-discount-code-shopify-selected]")?.value || "",
    siteId: data.get("siteId"),
    ownershipType: data.get("ownershipType"),
    creatorUid: data.get("ownershipType") === "creator" ? data.get("creatorUid") : "",
    isEnabled: data.get("isEnabled") === "on",
    notes: data.get("notes"),
  };
}

function assertClientPayload(payload) {
  if (!payload.code || String(payload.code).trim().toLowerCase() !== String(payload.selectedShopifyCode).trim().toLowerCase()) {
    throw new Error("请从 Shopify 搜索结果中选择折扣码");
  }
  if (payload.ownershipType === "creator" && !payload.creatorUid) throw new Error("请选择网红账号");
}
