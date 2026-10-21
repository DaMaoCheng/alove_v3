import {
  createAdminPromotionCampaign,
  searchAdminPromotionProducts,
  updateAdminPromotionCampaign,
} from "../../services/promotion-campaign-service.js";
import { bindDropdowns } from "../shared-ui/dropdown.js";
import { showToast } from "../shared-ui/toast.js";
import {
  adminPromotionCampaignEditorModalHtml,
  adminPromotionProductResultsHtml,
} from "./admin-console-promotion-campaigns-template.js";
import { setSavingState } from "./admin-form-utils.js";
import { bindAdminDateTimeFields, readAdminDateTime } from "./admin-datetime-field.js";

const EDITOR_HOST_ID = "promotionCampaignEditorHost";
const ACTIVE_CAMPAIGN_EXPIRED_MESSAGE = "结束时间必须晚于当前时间，才能将活动状态设为进行中";

export function openPromotionCampaignEditor({ item = null, sites = [], onSaved = null } = {}) {
  closePromotionCampaignEditor();
  const host = document.createElement("div");
  host.id = EDITOR_HOST_ID;
  host.className = "dialog-host account-form-host";
  host.innerHTML = adminPromotionCampaignEditorModalHtml(item, { sites });
  document.body.append(host);
  document.body.classList.add("dialog-open");
  host.querySelectorAll("[data-promotion-campaign-close]").forEach((button) => button.addEventListener("click", closePromotionCampaignEditor));
  bindDropdowns(host);
  bindAdminDateTimeFields(host);
  bindPromotionProductPicker(host);
  bindPromotionCampaignForm(host, { item, onSaved });
}

export function closePromotionCampaignEditor() {
  document.body.classList.remove("dialog-open");
  document.getElementById(EDITOR_HOST_ID)?.remove();
}

function bindPromotionCampaignForm(host, { item = null, onSaved = null } = {}) {
  const form = host.querySelector("[data-promotion-campaign-form]");
  if (!form) return;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const saveButton = form.querySelector("[data-promotion-campaign-save]");
    const tip = form.querySelector("[data-promotion-campaign-save-tip]");
    setSavingState(saveButton, tip, true, "保存中...");
    try {
      const payload = readPromotionCampaignPayload(form);
      if (!payload.productId || !payload.productTitle || !payload.productUrl) throw new Error("请先从商品搜索结果中选择一个商品");
      assertPromotionCampaignTiming(payload);
      const result = item?.id
        ? await updateAdminPromotionCampaign(item.id, payload)
        : await createAdminPromotionCampaign(payload);
      closePromotionCampaignEditor();
      await onSaved?.(result);
      showToast(result.item?.title ? `已保存：${result.item.title}` : "活动已保存");
    } catch (error) {
      const message = error.message || "保存失败，请稍后再试";
      setSavingState(saveButton, tip, false, message);
      if (message === ACTIVE_CAMPAIGN_EXPIRED_MESSAGE) showToast(message);
    }
  });
}

export function assertPromotionCampaignTiming(payload, { now = new Date() } = {}) {
  if (payload?.status !== "active" || !payload?.endsAt) return;
  const endsAt = new Date(payload.endsAt);
  if (!Number.isNaN(endsAt.getTime()) && endsAt.getTime() <= now.getTime()) {
    throw new Error(ACTIVE_CAMPAIGN_EXPIRED_MESSAGE);
  }
}

function bindPromotionProductPicker(host) {
  const form = host.querySelector("[data-promotion-campaign-form]");
  const query = host.querySelector("[data-promotion-product-query]");
  const results = host.querySelector("[data-promotion-product-results]");
  const selected = host.querySelector("[data-promotion-product-selected]");
  const siteSelect = host.querySelector('[name="siteId"]');
  if (!form || !query || !results) return;

  const clearProduct = () => {
    form.querySelector("[data-promotion-product-id]").value = "";
    form.querySelector("[data-promotion-product-title]").value = "";
    form.querySelector("[data-promotion-product-url]").value = "";
    form.querySelector("[data-promotion-product-snapshot]").value = "";
    if (selected) {
      selected.textContent = "";
      selected.hidden = true;
    }
  };

  siteSelect?.addEventListener("change", () => {
    query.value = "";
    results.hidden = true;
    clearProduct();
  });

  query.addEventListener("input", () => {
    clearProduct();
    window.clearTimeout(query.__promotionProductTimer || 0);
    query.__promotionProductTimer = window.setTimeout(async () => {
      const siteId = siteSelect?.value || "";
      const text = String(query.value || "").trim();
      if (!siteId || text.length < 2) {
        results.hidden = true;
        return;
      }
      results.hidden = false;
      results.innerHTML = `<div class="promotion-product-empty">搜索中...</div>`;
      try {
        const result = await searchAdminPromotionProducts({ siteId, query: text, limit: 8 });
        results.innerHTML = adminPromotionProductResultsHtml(result.items || []);
      } catch (error) {
        results.innerHTML = `<div class="promotion-product-empty">${escapeHtml(error.message || "商品搜索失败")}</div>`;
      }
    }, 350);
  });

  results.addEventListener("click", (event) => {
    if (event.target.closest("[data-promotion-product-link]")) return;
    const row = event.target.closest("[data-promotion-product-option]");
    if (!row) return;
    const product = parseProduct(row.dataset.promotionProductOption);
    form.querySelector("[data-promotion-product-id]").value = product.id || product.sku || product.url || "";
    form.querySelector("[data-promotion-product-title]").value = product.name || "";
    form.querySelector("[data-promotion-product-url]").value = product.url || "";
    form.querySelector("[data-promotion-product-snapshot]").value = JSON.stringify(product || {});
    query.value = product.name || "";
    if (selected) {
      selected.textContent = [product.name, product.sku || product.id].filter(Boolean).join(" / ");
      selected.hidden = false;
    }
    results.hidden = true;
  });
}

function readPromotionCampaignPayload(form) {
  const data = new FormData(form);
  return {
    title: data.get("title"),
    siteId: data.get("siteId"),
    roleTarget: data.get("roleTarget"),
    productId: data.get("productId"),
    productTitle: data.get("productTitle"),
    productUrl: data.get("productUrl"),
    productSnapshot: parseProduct(data.get("productSnapshot") || ""),
    discountCode: data.get("discountCode"),
    messageText: data.get("messageText"),
    keywords: String(data.get("keywords") || "").split(",").map((item) => item.trim()).filter(Boolean),
    priority: data.get("priority"),
    status: data.get("status"),
    startsAt: readAdminDateTime(data.get("startsAt")),
    endsAt: readAdminDateTime(data.get("endsAt")),
  };
}

function parseProduct(value = "") {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
