import { getAdminExternalPromotion, saveAdminExternalPromotion } from "../../services/admin-external-promotion-service.js";
import { uploadAdminCarouselImage } from "../../services/home-carousel-service.js";
import { showToast } from "../shared-ui/toast.js";
import { externalPromotionEditorHtml } from "./admin-external-promotion-template.js";

export function readPromotionForm(form) {
  // Disabled controls retain the visible draft during uploads, saves and preview handshakes.
  const value = key => String(form.elements[key]?.value || "").trim();
  return { launcherImageUrl: value("launcherImageUrl"), popupImageUrl: value("popupImageUrl"), label: value("label"),
    autoAvoid: form.elements.autoAvoid?.checked === true,
    ...Object.fromEntries(["desktopRightPx", "desktopBottomPx", "mobileRightPx", "mobileBottomPx"].map(key => [key, Number(value(key))])) };
}

export function bindAdminExternalPromotion(host, site, draftCache) {
  if (!host || !site?.siteId) return () => {};
  let disposed = false, form = null, item = null, busy = false, device = "desktop", frameResize = null;
  const previews = new Set();
  const origin = window.location.origin;
  const detachObserver = new MutationObserver(() => { if (!host.isConnected) dispose(); });
  detachObserver.observe(document.body, { childList: true, subtree: true });
  const jump = document.createElement("button");
  jump.type = "button"; jump.className = "btn btn-ghost sm"; jump.textContent = "活动礼盒 ↓";
  jump.addEventListener("click", () => host.scrollIntoView({ block: "start", behavior: "smooth" }));
  host.closest("[data-external-embed-host]")?.querySelector(".external-embed-actions")?.append(jump);
  const config = () => form ? readPromotionForm(form) : null;
  const sendPreview = target => {
    if (!disposed && config()) target?.postMessage({ type: "aiove-promotion-preview", config: config() }, origin);
  };
  const receive = event => {
    if (event.origin !== origin || event.data?.type !== "aiove-promotion-preview-ready") return;
    if (event.source === host.querySelector("[data-promotion-frame]")?.contentWindow || previews.has(event.source)) sendPreview(event.source);
  };
  window.addEventListener("message", receive);
  const error = message => {
    const node = host.querySelector("[data-promotion-error]");
    if (node) { node.hidden = !message; node.textContent = message || ""; }
  };
  const changed = () => {
    draftCache.set(site.siteId, config());
    sendPreview(host.querySelector("[data-promotion-frame]")?.contentWindow);
    for (const target of previews) { if (target.closed) previews.delete(target); else sendPreview(target); }
  };
  const render = () => {
    if (disposed) return;
    frameResize?.disconnect();
    host.innerHTML = externalPromotionEditorHtml(item, draftCache.get(site.siteId) || item.draft, site.siteName || site.siteSlug);
    form = host.querySelector("[data-promotion-form]");
    const wrap = host.querySelector("[data-promotion-frame-wrap]");
    const frame = host.querySelector("[data-promotion-frame]");
    const scaleFrame = () => {
      const width = device === "mobile" ? 390 : 1024;
      const scale = Math.min(1, wrap.clientWidth / width);
      frame.style.width = `${width}px`; frame.style.height = "760px";
      frame.style.transform = `scale(${scale})`; wrap.style.height = `${Math.round(760 * scale)}px`;
    };
    wrap.classList.toggle("is-mobile", device === "mobile");
    host.querySelectorAll("[data-promotion-device]").forEach(b => b.classList.toggle("active", b.dataset.promotionDevice === device));
    frameResize = new ResizeObserver(scaleFrame); frameResize.observe(wrap); scaleFrame();
    host.querySelector("[data-promotion-frame]").addEventListener("load", () => sendPreview(host.querySelector("[data-promotion-frame]")?.contentWindow));
    form.addEventListener("input", changed);
    form.addEventListener("change", changed);
    form.addEventListener("submit", event => { event.preventDefault(); void save("save_draft"); });
    host.querySelectorAll("[data-promotion-action]").forEach(button => {
      if (button.type !== "submit") button.addEventListener("click", () => void save(button.dataset.promotionAction));
    });
    host.querySelectorAll("[data-promotion-device]").forEach(button => button.addEventListener("click", () => {
      device = button.dataset.promotionDevice;
      host.querySelectorAll("[data-promotion-device]").forEach(b => b.classList.toggle("active", b === button));
      wrap.classList.toggle("is-mobile", device === "mobile"); scaleFrame();
    }));
    host.querySelector("[data-promotion-open]").addEventListener("click", () => {
      const target = window.open("/embed/promotion-preview.html", "_blank");
      if (target) previews.add(target); else showToast("请允许此页面打开预览窗口");
    });
    host.querySelector("[data-promotion-copy]").addEventListener("click", async () => {
      const input = host.querySelector("[data-promotion-snippet]");
      try { await navigator.clipboard.writeText(item.installerSnippet); showToast("活动安装代码已复制"); }
      catch { input.focus(); input.select(); showToast("请复制已选中的活动安装代码"); }
    });
    host.querySelector("[data-promotion-upload]").addEventListener("click", () => host.querySelector("[data-promotion-file]").click());
    host.querySelector("[data-promotion-file]").addEventListener("change", async event => {
      const file = event.target.files?.[0];
      if (!file || busy) return;
      if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 3 * 1024 * 1024) { error("请选择 3MB 内的 PNG、JPG 或 WebP 图片"); return; }
      busy = true;
      const controls = [...form.querySelectorAll("input,button")].map(node => [node, node.disabled]);
      controls.forEach(([node]) => node.disabled = true); error("");
      try {
        const result = await uploadAdminCarouselImage({ blob: file, filename: file.name });
        if (disposed) return;
        if (!result.imageUrl) throw Error("活动图上传失败");
        form.elements.popupImageUrl.value = result.imageUrl; changed(); showToast("活动图已上传，保存草稿后保留；尚未发布");
      } catch (e) { if (!disposed) error(e.message); }
      finally { busy = false; if (!disposed) { controls.forEach(([node, disabled]) => node.disabled = disabled); event.target.value = ""; } }
    });
  };
  async function save(action) {
    if (busy || !form) return;
    if (action === "publish" && !form.reportValidity()) return;
    if (action === "save_draft" && [...form.querySelectorAll("input[type=number]")].some(input => !input.reportValidity())) return;
    const currentDraft = config();
    busy = true; error("");
    const controls = [...form.querySelectorAll("input,button")].map(node => [node, node.disabled]);
    controls.forEach(([node]) => node.disabled = true);
    try {
      const result = await saveAdminExternalPromotion(site.siteId, action, action !== "disable" ? currentDraft : undefined);
      if (disposed) return;
      item = result.item; draftCache.set(site.siteId, action === "disable" ? currentDraft : item.draft); render();
      showToast(action === "publish" ? "活动礼盒已发布" : action === "disable" ? "活动礼盒已停用，草稿保留" : "活动草稿已保存，外站展示未变");
    } catch (e) { if (!disposed) error(e.message || "保存失败，请重试"); }
    finally { busy = false; if (!disposed) controls.forEach(([node, disabled]) => node.disabled = disabled); }
  }
  getAdminExternalPromotion(site.siteId).then(result => { if (!disposed) { item = result.item; render(); } }).catch(e => { if (!disposed) host.textContent = e.message || "活动配置读取失败"; });
  function dispose() {
    if (disposed) return;
    disposed = true; frameResize?.disconnect(); detachObserver.disconnect();
    window.removeEventListener("message", receive); previews.clear(); jump.remove();
  }
  return dispose;
}
