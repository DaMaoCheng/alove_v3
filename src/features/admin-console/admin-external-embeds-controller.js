import { listAdminExternalEmbeds, saveAdminExternalEmbed } from "../../services/admin-external-embed-service.js";
import { bindDropdowns } from "../shared-ui/dropdown.js";
import { showToast } from "../shared-ui/toast.js";
import { bindAdminExternalEmbedAvatarControls } from "./admin-external-embed-avatar-controls.js";
import { adminExternalEmbedsEditorHtml, externalEmbedPreviewCanvasHtml } from "./admin-console-external-embeds-template.js";
import { bindExternalEmbedRichTextControls, parseRichText, syncExternalEmbedRichTextFields } from "./admin-external-embed-rich-text.js";

export function bindAdminExternalEmbeds(shell) {
  const host = shell.querySelector("[data-external-embed-host]");
  if (!host) return;
  let items = [];
  let selectedSiteId = "";
  let previewMode = "desktop";

  const render = () => {
    host.innerHTML = adminExternalEmbedsEditorHtml({ items, selectedSiteId, previewMode });
    const form = host.querySelector("[data-external-embed-form]");
    const selectedItem = items.find((item) => item.siteId === selectedSiteId) || items[0] || {};
    bindDropdowns(host);
    bindAdminExternalEmbedAvatarControls(host, {
      fallbackImageUrl: selectedItem.mascotAvatarUrl || "",
      onChanged: () => syncPreview(form, items, previewMode),
    });
    bindEditorEvents(form, { onRichTextChanged: () => syncPreview(form, items, previewMode) });
  };

  const bindEditorEvents = (form, { onRichTextChanged } = {}) => {
    host.querySelector("[data-external-embed-site] [data-dd-input]")?.addEventListener("change", (event) => {
      selectedSiteId = event.target.value;
      render();
    });
    host.querySelectorAll("[data-external-embed-preview-mode]").forEach((button) => {
      button.addEventListener("click", () => {
        previewMode = button.dataset.externalEmbedPreviewMode === "mobile" ? "mobile" : "desktop";
        host.querySelectorAll("[data-external-embed-preview-mode]").forEach((candidate) => candidate.classList.toggle("active", candidate === button));
        syncPreview(form, items, previewMode);
      });
    });
    bindExternalEmbedRichTextControls(form, { onChanged: onRichTextChanged });
    form?.addEventListener("input", (event) => {
      if (event.target.closest("[data-external-embed-rich-editor]")) return;
      syncPreview(form, items, previewMode);
    });
    form?.addEventListener("change", () => syncPreview(form, items, previewMode));
    form?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = form.querySelector("[data-external-embed-save]");
      const errorBox = form.querySelector("[data-external-embed-error]");
      setSaving(button, true);
      showError(errorBox, "");
      try {
        const item = await saveAdminExternalEmbed(form.dataset.externalEmbedSiteId, readPayload(form));
        replaceItem(item.item);
        selectedSiteId = item.item.siteId;
        render();
        showToast(item.item.config?.status === "published" ? "站外挂件已发布" : "站外挂件草稿已保存");
      } catch (error) {
        showError(errorBox, error.message || "保存失败，请稍后重试");
      } finally {
        setSaving(button, false);
      }
    });
    host.querySelector("[data-external-embed-copy]")?.addEventListener("click", async () => {
      const code = host.querySelector("[data-external-embed-snippet]")?.value || "";
      if (!code) return;
      try {
        await navigator.clipboard.writeText(code);
        showToast("安装代码已复制");
      } catch {
        const input = host.querySelector("[data-external-embed-snippet]");
        input?.focus();
        input?.select();
        showToast("请复制已选中的安装代码");
      }
    });
  };

  const load = async () => {
    try {
      const result = await listAdminExternalEmbeds();
      items = result.items || [];
      selectedSiteId = items[0]?.siteId || "";
      render();
    } catch (error) {
      host.textContent = error.message || "站外挂件配置读取失败";
    }
  };

  load();

  function replaceItem(item) {
    const index = items.findIndex((candidate) => candidate.siteId === item?.siteId);
    if (index >= 0) items[index] = item;
  }
}

function readPayload(form) {
  syncExternalEmbedRichTextFields(form);
  const values = new FormData(form);
  return {
    externalOrigin: values.get("externalOrigin"),
    status: values.get("status"),
    launcherImageUrl: values.get("launcherImageUrl"),
    showBadge: values.get("showBadge") === "on",
    title: values.get("title"),
    titleRichText: parseRichText(values.get("titleRichText")),
    showBeta: values.get("showBeta") === "on",
    betaText: values.get("betaText"),
    description: values.get("description"),
    descriptionRichText: parseRichText(values.get("descriptionRichText")),
    ctaText: values.get("ctaText"),
    accentColor: values.get("accentColor"),
    surfaceColor: values.get("surfaceColor"),
    textColor: values.get("textColor"),
    cornerRadiusPx: values.get("cornerRadiusPx"),
    desktopRightPx: values.get("desktopRightPx"),
    desktopBottomPx: values.get("desktopBottomPx"),
    mobileRightPx: values.get("mobileRightPx"),
    mobileBottomPx: values.get("mobileBottomPx"),
  };
}

function syncPreview(form, items = [], previewMode = "desktop") {
  if (!form) return;
  const host = form.closest("[data-external-embed-host]");
  const preview = host?.querySelector("[data-external-embed-preview]");
  const selected = host?.querySelector("[data-external-embed-site] [data-dd-input]")?.value || "";
  const currentSite = items.find((item) => item.siteId === selected) || { mascotAvatarUrl: "", siteId: selected };
  if (!preview) return;
  const payload = readPayload(form);
  preview.outerHTML = externalEmbedPreviewCanvasHtml({ ...payload, showBadge: payload.showBadge, showBeta: payload.showBeta }, currentSite, previewMode);
  form.querySelectorAll("input[type='color']").forEach((input) => {
    const output = input.closest(".external-embed-color")?.querySelector("output");
    if (output) output.textContent = input.value.toUpperCase();
  });
}

function setSaving(button, busy) {
  if (!button) return;
  button.disabled = busy;
  button.textContent = busy ? "保存中..." : "保存设置";
}

function showError(node, message) {
  if (!node) return;
  node.hidden = !message;
  node.textContent = message || "";
}
