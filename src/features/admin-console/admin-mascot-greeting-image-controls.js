import {
  deleteAdminMascotGreetingImage,
  listAdminMascotGreetingImages,
  uploadAdminMascotGreetingImage,
} from "../../services/admin-mascot-service.js";
import { bindChatAttachmentPreview } from "../chat/chat-attachment-preview.js";
import { showToast } from "../shared-ui/toast.js";

const SLOT_COUNT = 5;
const VIDEO_SLOT = 5;

export function bindAdminMascotGreetingImageControls(host) {
  const gallery = host.querySelector("[data-mascot-greeting-gallery]");
  const characterId = String(gallery?.dataset.mascotCharacterId || "").trim();
  if (!gallery || !characterId) return;
  bindChatAttachmentPreview(gallery);

  const render = (items = []) => {
    const bySlot = new Map(items.map((item) => [Number(item.slotIndex || 0), item]));
    const container = gallery.querySelector("[data-mascot-greeting-gallery-items]");
    if (!container) return;
    container.innerHTML = Array.from({ length: SLOT_COUNT }, (_, index) => galleryCardHtml(bySlot.get(index + 1) || { slotIndex: index + 1 } )).join("");
  };

  const load = async () => {
    try {
      const result = await listAdminMascotGreetingImages(characterId);
      if (!host.isConnected) return;
      render(result.items || []);
    } catch (error) {
      if (!host.isConnected) return;
      const container = gallery.querySelector("[data-mascot-greeting-gallery-items]");
      if (container) container.innerHTML = `<p class="mascot-greeting-gallery-error">${escapeHtml(error.message || "素材库读取失败，请稍后重试")}</p>`;
    }
  };

  gallery.addEventListener("click", (event) => {
    const actionButton = event.target.closest("[data-mascot-greeting-action]");
    if (!actionButton) return;
    const slot = Number(actionButton.dataset.mascotGreetingSlot || 0);
    const action = actionButton.dataset.mascotGreetingAction;
    if (action === "upload") {
      gallery.querySelector(`[data-mascot-greeting-file="${slot}"]`)?.click();
      return;
    }
    void runAction({ action, slot, button: actionButton });
  });

  gallery.addEventListener("change", (event) => {
    const input = event.target.closest("[data-mascot-greeting-file]");
    const slot = Number(input?.dataset.mascotGreetingFile || 0);
    const file = input?.files?.[0];
    if (!file || !slot) return;
    void runAction({ action: "upload-file", slot, file, button: input });
    input.value = "";
  });

  async function runAction({ action, slot, file = null, button }) {
    if (!Number.isInteger(slot) || slot < 1 || slot > SLOT_COUNT) return;
    if (button) {
      button.disabled = true;
      if (action === "upload-file") button.closest(".mascot-greeting-gallery-card")?.classList.add("is-busy");
    }
    try {
      if (action === "delete") await deleteAdminMascotGreetingImage(characterId, slot);
      if (action === "upload-file") await uploadAdminMascotGreetingImage(characterId, slot, file);
      await load();
      if (action === "upload-file") showToast(slot === VIDEO_SLOT ? "问候视频已上传" : "问候图片已上传");
      if (action === "delete") showToast(slot === VIDEO_SLOT ? "已停止使用这个问候视频" : "已停止使用这张问候图片");
    } catch (error) {
      showToast(error.message || "操作失败，请稍后再试");
    } finally {
      if (button && button.isConnected) button.disabled = false;
    }
  }

  void load();
}

function galleryCardHtml(item = {}) {
  const slot = Number(item.slotIndex || 0);
  const mediaUrl = String(item.imageUrl || "").trim();
  const isVideoSlot = slot === VIDEO_SLOT;
  const mediaType = String(item.mediaType || (isVideoSlot ? "video" : "image")).toLowerCase();
  const ready = String(item.status || "").toLowerCase() === "ready" && mediaUrl;
  const label = isVideoSlot ? "问候视频" : `问候图片 ${slot}`;
  const accept = isVideoSlot ? ".mp4,video/mp4" : ".jpg,.jpeg,.jfif,.png,.webp,image/jpeg,image/png,image/webp";
  const readyPreview = mediaType === "video"
    ? `<button class="mascot-greeting-gallery-preview" type="button" data-chat-attachment-preview data-video-url="${escapeAttr(mediaUrl)}" data-image-name="${label}" aria-label="播放${label}"><video src="${escapeAttr(mediaUrl)}" muted playsinline preload="metadata"></video><span class="mascot-greeting-video-play" aria-hidden="true">▶</span></button>`
    : `<button class="mascot-greeting-gallery-preview" type="button" data-chat-attachment-preview data-image-url="${escapeAttr(mediaUrl)}" data-image-name="${label}" aria-label="放大查看${label}"><img src="${escapeAttr(mediaUrl)}" alt="${label}" /></button>`;
  return `
    <article class="mascot-greeting-gallery-card ${ready ? "is-ready" : "is-empty"}">
      ${ready ? readyPreview : `<button class="mascot-greeting-gallery-preview mascot-greeting-gallery-empty" type="button" data-mascot-greeting-action="upload" data-mascot-greeting-slot="${slot}" aria-label="上传${label}"><span>+</span></button>`}
      <div class="mascot-greeting-gallery-card-row"><b>${label}</b>${ready ? `<button class="mascot-greeting-gallery-remove" type="button" data-mascot-greeting-action="delete" data-mascot-greeting-slot="${slot}" aria-label="删除${label}">×</button>` : ""}</div>
      <input type="file" accept="${accept}" hidden data-mascot-greeting-file="${slot}" />
    </article>
  `;
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>\"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

function escapeAttr(value = "") {
  return escapeHtml(value).replace(/`/g, "&#96;");
}
