import {
  disableAdminSiteMascot,
  listAdminMascotSettings,
  saveAdminMascotTemplate,
  createAdminMascot,
  updateAdminMascot,
  saveAdminSiteMascot,
  listAdminMascotCampaigns,
} from "../../services/admin-mascot-service.js";
import { listAdminKnowledgeBases } from "../../services/admin-knowledge-service.js";
import { showDialog } from "../shared-ui/dialog.js";
import { bindDropdowns } from "../shared-ui/dropdown.js";
import { showToast } from "../shared-ui/toast.js";
import { bindAdminCharacterAvatarControls } from "./admin-character-avatar-controls.js";
import { bindAdminMascotAvatarAiControls } from "./admin-mascot-avatar-ai-controls.js";
import { bindAdminMascotGreetingImageControls } from "./admin-mascot-greeting-image-controls.js";
import { bindAdminMascotAdPreview } from "./admin-mascot-ad-preview.js";
import { setSavingState } from "./admin-form-utils.js";
import { escapeHtml } from "./admin-console-utils.js";
import {
  adminMascotBodyHtml,
  mascotAdModalHtml,
  mascotEditorModalHtml,
} from "./admin-console-mascot-template.js";

export function bindAdminMascot(shell) {
  const body = shell.querySelector(".admin-body");
  if (!body) return;

  let state = { loading: true, template: null, sites: [], unboundMascots: [], knowledgeBases: [] };
  let modalCleanup = null;
  let adModalRequestToken = 0;
  const countedDeliveryIds = new Set();

  const render = (nextState = {}) => {
    state = { ...state, ...nextState };
    body.innerHTML = adminMascotBodyHtml(state);
  };

  const load = async () => {
    render({ loading: true, error: "" });
    try {
      const [result, knowledgeResult] = await Promise.all([
        listAdminMascotSettings(),
        listAdminKnowledgeBases(),
      ]);
      render({ loading: false, template: result.template, sites: result.sites, unboundMascots: result.unboundMascots || [], knowledgeBases: knowledgeResult.items || [], error: "" });
    } catch (error) {
      render({ loading: false, error: error.message || "前台设置读取失败" });
    }
  };

  const closeModal = () => {
    modalCleanup?.();
    modalCleanup = null;
    document.body.classList.remove("dialog-open");
    document.getElementById("mascotEditorHost")?.remove();
  };

  const openModal = (html) => {
    closeModal();
    const host = document.createElement("div");
    host.id = "mascotEditorHost";
    host.className = "dialog-host account-form-host";
    host.innerHTML = html;
    document.body.append(host);
    document.body.classList.add("dialog-open");
    host.querySelectorAll("[data-mascot-close]").forEach((button) => button.addEventListener("click", closeModal));
    bindDropdowns(host);
    bindAdminCharacterAvatarControls(host);
    bindAdminMascotAvatarAiControls(host);
    bindAdminMascotGreetingImageControls(host);
    bindKnowledgeSelect(host);
    bindModalForms(host);
    modalCleanup = bindAdminMascotAdPreview(host, { onDeliveryCompleted: recordCompletedDelivery });
    return host;
  };

  const openTemplateEditor = () => {
    openModal(mascotEditorModalHtml({ mascot: state.template, mode: "template", knowledgeBases: state.knowledgeBases }));
  };

  const openSiteEditor = (siteId) => {
    const site = findSite(siteId);
    if (!site) return;
    openModal(mascotEditorModalHtml({ mascot: normalizeSiteMascotForEdit(site), site, sites: state.sites, mode: "site", knowledgeBases: state.knowledgeBases }));
  };

  const openNewSiteMascotEditor = () => {
    openModal(mascotEditorModalHtml({ mascot: {}, site: null, sites: state.sites, mode: "site-new", knowledgeBases: state.knowledgeBases }));
  };

  const openUnboundEditor = (mascotId) => {
    const mascot = state.unboundMascots.find((item) => item.id === mascotId);
    if (!mascot) return;
    openModal(mascotEditorModalHtml({ mascot, site: null, sites: state.sites, mode: "unbound", knowledgeBases: state.knowledgeBases }));
  };

  const openAdModal = async (siteId) => {
    const site = findSite(siteId);
    if (!site) return;
    const requestToken = ++adModalRequestToken;
    const loadingHost = openModal(mascotAdModalHtml(site, { loading: true }));
    const isCurrentRequest = () => {
      const currentHost = document.getElementById("mascotEditorHost");
      const currentSiteId = currentHost?.querySelector("[data-mascot-ad-form]")?.dataset.mascotSite || "";
      return requestToken === adModalRequestToken
        && currentHost === loadingHost
        && currentSiteId === site.id;
    };
    try {
      const result = await listAdminMascotCampaigns(site.id);
      if (!isCurrentRequest()) return;
      openModal(mascotAdModalHtml(site, { campaigns: result.items || [] }));
    } catch (error) {
      if (!isCurrentRequest()) return;
      closeModal();
      showToast(error.message || "广告活动读取失败，请稍后再试");
    }
  };

  const confirmDisableMascot = (siteId) => {
    const site = findSite(siteId);
    if (!site) return;
    showDialog({
      type: "warning",
      title: "停用本站前台？",
      message: `停用后，${site.name} 会恢复使用通用模板。历史对话、广告记录和角色记录不会删除。`,
      confirmText: "确认停用",
      cancelText: "取消",
      onConfirm: async () => {
        try {
          const result = await disableAdminSiteMascot(site.id);
          render({ loading: false, template: result.template, sites: result.sites, unboundMascots: result.unboundMascots || [], error: "" });
          showToast("前台已停用");
        } catch (error) {
          showToast(error.message || "停用失败，请稍后再试");
        }
      },
    });
  };

  const findSite = (siteId) => state.sites.find((site) => site.id === siteId);

  function recordCompletedDelivery(delivery = {}) {
    const result = applySuccessfulMascotAdDelivery(state.sites, countedDeliveryIds, delivery);
    if (!result.updated) return;
    state = {
      ...state,
      sites: result.sites,
    };
    const row = [...body.querySelectorAll("[data-site-id]")].find((item) => item.dataset.siteId === result.siteId);
    const cell = row?.querySelector("[data-mascot-sent-ad-count]");
    if (cell) cell.textContent = result.sentAdCount.toLocaleString("zh-CN");
  }

  const bindModalForms = (host) => {
    host.querySelector("[data-mascot-form]")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const button = form.querySelector("[data-mascot-save]");
      const tip = form.querySelector("[data-mascot-save-tip]");
      setSavingState(button, tip, true, "保存中...");
      try {
        const payload = readMascotPayload(form);
        const mode = form.dataset.mascotMode;
        const result = mode === "template"
          ? await saveAdminMascotTemplate(payload)
          : mode === "site-new"
            ? await createAdminMascot(payload)
            : mode === "unbound"
              ? await updateAdminMascot(payload.characterId, payload)
              : await saveAdminSiteMascot(payload.siteId || form.dataset.mascotSite, payload);
        closeModal();
        render({ loading: false, template: result.template, sites: result.sites, unboundMascots: result.unboundMascots || [], error: "" });
        showToast("前台设置已保存");
      } catch (error) {
        setSavingState(button, tip, false, error.message || "保存失败，请稍后再试");
      }
    });

  };

  body.addEventListener("click", (event) => {
    const templateButton = event.target.closest("[data-mascot-edit-template]");
    if (templateButton) {
      event.preventDefault();
      openTemplateEditor();
      return;
    }

    const newButton = event.target.closest("[data-mascot-new]");
    if (newButton) {
      event.preventDefault();
      openNewSiteMascotEditor();
      return;
    }

    const siteEditButton = event.target.closest("[data-mascot-edit-site]");
    if (siteEditButton) {
      event.preventDefault();
      openSiteEditor(siteEditButton.dataset.mascotEditSite);
      return;
    }

    const unboundEditButton = event.target.closest("[data-mascot-edit-unbound]");
    if (unboundEditButton) {
      event.preventDefault();
      openUnboundEditor(unboundEditButton.dataset.mascotEditUnbound);
      return;
    }

    const adButton = event.target.closest("[data-mascot-ad]");
    if (adButton) {
      event.preventDefault();
      void openAdModal(adButton.dataset.mascotAd);
      return;
    }

    const disableButton = event.target.closest("[data-mascot-disable]");
    if (!disableButton) return;
    event.preventDefault();
    confirmDisableMascot(disableButton.dataset.mascotDisable);
  });

  load();
}

export function applySuccessfulMascotAdDelivery(sites = [], countedDeliveryIds = new Set(), delivery = {}) {
  const deliveryId = String(delivery.id || "").trim();
  const siteId = String(delivery.siteId || "").trim();
  if (!deliveryId || !siteId || Number(delivery.sent || 0) <= 0 || countedDeliveryIds.has(deliveryId)) {
    return { updated: false, sites };
  }
  const site = sites.find((item) => item.id === siteId);
  if (!site) return { updated: false, sites };
  countedDeliveryIds.add(deliveryId);
  const sentAdCount = Math.max(0, Number(site.sentAdCount || 0)) + 1;
  return {
    updated: true,
    siteId,
    sentAdCount,
    sites: sites.map((item) => item.id === siteId ? { ...item, sentAdCount } : item),
  };
}

function readMascotPayload(form) {
  const data = new FormData(form);
  const payload = {
    siteId: data.get("siteId"),
    characterId: data.get("characterId"),
    name: data.get("name"),
    avatarUrl: data.get("avatarUrl"),
    greeting: data.get("greeting"),
    cta: data.get("cta"),
    knowledgeText: data.get("knowledgeText"),
  };
  const personaPrompt = String(data.get("personaPrompt") || "");
  const speakingStyle = String(data.get("speakingStyle") || "");
  if (personaPrompt !== String(form.dataset.mascotInitialPersona || "")) payload.personaPrompt = personaPrompt;
  if (speakingStyle !== String(form.dataset.mascotInitialSpeakingStyle || "")) payload.speakingStyle = speakingStyle;
  return payload;
}

function normalizeSiteMascotForEdit(site) {
  if (site.mascot?.source !== "通用模板") return site.mascot;
  return { ...site.mascot, id: "" };
}

function bindKnowledgeSelect(host) {
  const select = host.querySelector("[data-mascot-kb-select]");
  if (!select) return;
  const trigger = select.querySelector("[data-mascot-kb-trigger]");
  const input = select.querySelector("[data-mascot-kb-value]");
  const current = select.querySelector("[data-mascot-kb-current]");
  const options = Array.from(select.querySelectorAll("[data-mascot-kb-option]"));
  const selected = new Set(String(input?.value || "").split("\n").filter(Boolean));
  const sync = () => {
    if (input) input.value = Array.from(selected).join("\n");
    const labels = options.filter((option) => selected.has(option.dataset.mascotKbOption || "")).map((option) => option.querySelector(".dd-label")?.textContent || "").filter(Boolean);
    if (current) current.innerHTML = labels.length
      ? `<span class="mascot-kb-current-tags">${labels.map((label) => `<i class="kb-tag">${escapeHtml(label)}</i>`).join("")}</span>`
      : `<span class="muted-dash">-</span>`;
    options.forEach((option) => {
      const active = selected.has(option.dataset.mascotKbOption || "");
      option.classList.toggle("is-active", active);
      option.querySelector(".dd-check")?.remove();
      if (active) option.insertAdjacentHTML("beforeend", `<span class="dd-check">✓</span>`);
    });
  };
  trigger?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    select.classList.toggle("open");
  });
  options.forEach((option) => option.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const id = option.dataset.mascotKbOption || "";
    if (!id) return;
    if (selected.has(id)) selected.delete(id);
    else selected.add(id);
    sync();
  }));
  document.addEventListener("click", () => select.classList.remove("open"), { once: true });
  sync();
}
