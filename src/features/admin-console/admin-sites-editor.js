import { createAdminSite, updateAdminSite } from "../../services/admin-site-service.js";
import { showToast } from "../shared-ui/toast.js";
import { adminSiteEditorHtml } from "./admin-console-sites-template.js";
import { setSavingState } from "./admin-form-utils.js";
import { bindSitePaymentMethodPicker } from "./admin-sites-payment-method-picker.js";
import { bindSiteProductSourcePicker } from "./admin-sites-product-source-picker.js";
import { bindSiteRegionPicker, mergeRegions } from "./admin-sites-region-picker.js";
import { bindSiteMascotPicker } from "./admin-sites-mascot-picker.js";
import { clearSiteBrandingCache } from "../../services/site-branding-service.js";
import { bindAdminLanguagePicker } from "./admin-character-editor-controls.js";

export function closeSiteEditor() {
  document.body.classList.remove("dialog-open");
  document.querySelectorAll(".site-payment-method-menu.is-floating").forEach((menu) => menu.remove());
  const host = document.getElementById("siteEditorHost");
  host?.siteEditorAbortController?.abort();
  host?.remove();
}

export function openSiteEditor(site = null, {
  regions = [],
  mascots = [],
  setRegions = () => {},
  onSaved = () => {},
} = {}) {
  closeSiteEditor();
  const host = document.createElement("div");
  host.id = "siteEditorHost";
  host.className = "dialog-host account-form-host";
  host.innerHTML = adminSiteEditorHtml(site, { regions, mascots });
  host.siteEditorAbortController = new AbortController();
  document.body.append(host);
  document.body.classList.add("dialog-open");
  const form = host.querySelector("[data-site-form]");
  if (!form) return;

  bindSiteRegionPicker(host, {
    getRegions: () => regions,
    setRegions: (nextRegions) => {
      regions = mergeRegions(regions, nextRegions);
      setRegions(regions);
    },
  });
  bindSiteMascotPicker(host);
  bindSitePaymentMethodPicker(host);
  bindSiteProductSourcePicker(host);
  bindAdminLanguagePicker(form, { signal: host.siteEditorAbortController.signal });

  host.querySelector("[data-site-guest-link-copy]")?.addEventListener("click", async () => {
    const slug = String(form.elements.slug?.value || site?.slug || "").trim();
    if (!slug) return showToast("请先填写站点 slug");
    const link = `${window.location.origin}/${encodeURIComponent(slug)}/chat`;
    try {
      await navigator.clipboard.writeText(link);
      showToast("游客链接已复制");
    } catch {
      showToast(link);
    }
  });

  host.querySelectorAll("[data-site-close]").forEach((button) => {
    button.addEventListener("click", closeSiteEditor);
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const saveButton = form.querySelector("[data-site-save]");
    const tip = form.querySelector("[data-site-save-tip]");
    setSavingState(saveButton, tip, true, "保存中...");
    try {
      const payload = readSitePayload(form);
      const result = site?.id
        ? await updateAdminSite(site.id, payload)
        : await createAdminSite(payload);
      clearSiteBrandingCache(site?.slug || "");
      clearSiteBrandingCache(result.item?.slug || "");
      window.dispatchEvent(new CustomEvent("aiove:site-branding-updated", {
        detail: { siteSlug: result.item?.slug || "" },
      }));
      closeSiteEditor();
      onSaved(result.item, site?.id || "");
      showToast("站点设置已保存");
    } catch (error) {
      setSavingState(saveButton, tip, false, error.message || "保存失败，请稍后再试");
    }
  });
}

export function readSitePayload(form) {
  const data = new FormData(form);
  return {
    name: data.get("name"),
    slug: data.get("slug"),
    siteUrl: data.get("siteUrl"),
    logoUrl: data.get("logoUrl"),
    defaultLanguage: data.get("defaultLanguage"),
    mascotCharacterId: data.get("mascotCharacterId"),
    guestChatEnabled: data.get("guestChatEnabled") === "on",
    shopifyLoginEnabled: data.get("shopifyLoginEnabled") === "on",
    commerceEnabled: data.get("commerceEnabled") === "on",
    productApiUrl: data.get("productApiUrl"),
    productSourceType: data.get("productSourceType"),
    productShopDomain: data.get("productShopDomain"),
    productApiVersion: data.get("productApiVersion"),
    productAccessToken: data.get("productAccessToken"),
    productTtmallApiBaseUrl: data.get("productTtmallApiBaseUrl"),
    productTtmallWebsiteId: data.get("productTtmallWebsiteId"),
    paymentMethods: data.get("paymentMethods"),
    paymentMethodsTouched: data.get("paymentMethodsTouched"),
    description: data.get("description"),
    regionIds: String(data.get("regionIds") || "").split(",").map((item) => item.trim()).filter(Boolean),
  };
}
