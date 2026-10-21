import { ICONS } from "../../icons/icons.js";
import { AVATAR_UPLOAD_POLICY } from "../../config/upload-policies.js";
import { showDialog } from "../shared-ui/dialog.js";
import { canvasToBlob } from "../../utils/image-processing.js";
import { createSiteCopy } from "../../i18n/site-copy.js";

const CROP_OUT = AVATAR_UPLOAD_POLICY.outputSize;
const CROP_STAGE_SIZE = AVATAR_UPLOAD_POLICY.cropBoxSize;
const ALLOWED_IMAGE_TYPES = new Set(AVATAR_UPLOAD_POLICY.allowedImageTypes);
let cropState = null;
let mouseMoveHandler = null;
let mouseUpHandler = null;

export function openAvatarFilePicker(input) {
  input?.click();
}

export function openAvatarUrlCropper(avatarUrl, { onCropped, onCancel, onRetry, retryLabel, pageLanguage = "English" } = {}) {
  const copy = createSiteCopy(pageLanguage);
  const normalizedUrl = String(avatarUrl || "").trim();
  if (!normalizedUrl) return;
  const image = new Image();
  image.crossOrigin = "anonymous";
  image.onload = () => openCropper(image, { onCropped, onCancel, onRetry, retryLabel, copy });
  image.onerror = () => {
    onCancel?.();
    showDialog({ type: "error", title: copy.t("create.avatarLoadTitle"), message: copy.t("create.avatarLoadBody") });
  };
  image.src = normalizedUrl;
}

export async function handleAvatarFile(event, { onBeforeCrop, onCropped, retryLabel = "Re-upload", pageLanguage = "English" } = {}) {
  const copy = createSiteCopy(pageLanguage);
  const input = event.target;
  const file = event.target.files?.[0] || null;
  event.target.value = "";
  if (!file) return;
  if (!ALLOWED_IMAGE_TYPES.has(String(file.type || "").toLowerCase())) {
    showDialog({ type: "error", title: copy.t("create.avatarUnsupportedTitle"), message: copy.t("create.avatarUnsupportedBody") });
    return;
  }
  if (file.size > AVATAR_UPLOAD_POLICY.maxSourceBytes) {
    showDialog({ type: "error", title: copy.t("create.avatarTooLargeTitle"), message: copy.t("create.avatarTooLargeBody") });
    return;
  }

  if (typeof onBeforeCrop === "function") {
    const closeModeration = showAvatarModerationLoading(copy);
    try {
      await onBeforeCrop(file);
    } catch {
      showDialog({ type: "error", title: copy.t("create.avatarRejectedTitle"), message: copy.t("create.avatarRejectedBody") });
      return;
    } finally {
      closeModeration();
    }
  }

  const reader = new FileReader();
  reader.onload = () => {
    const image = new Image();
    image.onload = () => openCropper(image, {
      onCropped,
      retryLabel,
      copy,
      onRetry: () => window.setTimeout(() => openAvatarFilePicker(input), 0),
    });
    image.onerror = () => showDialog({ type: "error", title: copy.t("create.avatarLoadTitle"), message: copy.t("create.avatarLoadBody") });
    image.src = reader.result;
  };
  reader.onerror = () => showDialog({ type: "error", title: copy.t("create.avatarReadTitle"), message: copy.t("create.avatarLoadBody") });
  reader.readAsDataURL(file);
}

export function closeCropper() {
  closeCropperInternal({ callCancel: true });
}

export function bindCropperEscClose() {
  if (window.__aioveCropperEscBound) return;
  window.__aioveCropperEscBound = true;
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && document.body.classList.contains("crop-open")) {
      closeCropper();
    }
  });
}

function closeCropperInternal({ callCancel = true } = {}) {
  const callback = cropState?.onCancel;
  document.body.classList.remove("crop-open");
  window.dispatchEvent(new CustomEvent("aiove:avatar-crop-state", { detail: { open: false } }));
  document.getElementById("cropHost")?.remove();
  if (mouseMoveHandler) window.removeEventListener("mousemove", mouseMoveHandler);
  if (mouseUpHandler) window.removeEventListener("mouseup", mouseUpHandler);
  mouseMoveHandler = null;
  mouseUpHandler = null;
  cropState = null;
  if (callCancel) callback?.();
}

function showAvatarModerationLoading(copy) {
  const host = document.createElement("div");
  host.className = "aigen-host";
  host.innerHTML = `
    <div class="dialog-scrim"></div>
    <div class="aigen-modal" role="dialog" aria-modal="true">
      <h3 class="aigen-title">${ICONS.spark} ${escapeHtml(copy.t("create.avatarChecking"))}</h3>
      <div class="aigen-body"><div class="aigen-loading"><div class="aigen-orb"><span class="cf-spin aigen-orb-spin"></span></div><div class="aigen-loading-txt">${escapeHtml(copy.t("create.avatarSafety"))}</div><div class="aigen-bar"><i></i></div></div></div>
    </div>`;
  document.body.append(host);
  document.body.classList.add("aigen-open");
  return () => {
    document.body.classList.remove("aigen-open");
    host.remove();
  };
}

function openCropper(image, { onCropped, onCancel, onRetry, retryLabel, copy = createSiteCopy("English") } = {}) {
  closeCropperInternal({ callCancel: false });
  const min = CROP_STAGE_SIZE / Math.min(image.naturalWidth, image.naturalHeight);
  cropState = { image, scale: min, min, x: 0, y: 0, dragging: false, lastX: 0, lastY: 0, onCropped, onCancel, onRetry, copy };
  const hasRetry = typeof onRetry === "function";

  const host = document.createElement("div");
  host.id = "cropHost";
  host.className = "crop-host";
  host.innerHTML = `
    <div class="dialog-scrim" data-crop-close></div>
    <div class="crop-modal" role="dialog" aria-modal="true">
      <button class="dlg-x" type="button" aria-label="${escapeHtml(copy.t("common.close"))}" data-crop-close>${ICONS.close}</button>
      <h3 class="crop-title">${escapeHtml(copy.t("create.cropTitle"))}</h3>
      <p class="crop-hint">${escapeHtml(copy.t("create.cropHint"))}</p>
      <div class="crop-stage" id="cropStage" style="width:${CROP_STAGE_SIZE}px;height:${CROP_STAGE_SIZE}px">
        <canvas id="cropCanvas" width="${CROP_STAGE_SIZE}" height="${CROP_STAGE_SIZE}"></canvas>
        <div class="crop-ring"></div>
      </div>
      <div class="crop-zoom">
        <span>${ICONS.image || ICONS.cam}</span>
        <input id="cropZoom" type="range" min="1" max="3" step="0.01" value="1" />
      </div>
      <div class="crop-actions${hasRetry ? " has-retry" : ""}">
        <button class="btn btn-ghost" type="button" data-crop-close>${escapeHtml(copy.t("create.cropCancel"))}</button>
        ${hasRetry ? `<button class="btn btn-ghost crop-retry" type="button" data-crop-retry aria-label="${escapeHtml(retryLabel || copy.t("common.retry"))}" title="${escapeHtml(retryLabel || copy.t("common.retry"))}">${ICONS.refresh}</button>` : ""}
        <button class="btn btn-primary crop-apply" type="button" data-crop-apply><span class="crop-apply-ic">${ICONS.check || ICONS.spark}</span><span class="crop-apply-text">${escapeHtml(copy.t("create.cropUse"))}</span></button>
      </div>
    </div>`;
  document.body.append(host);
  document.body.classList.add("crop-open");
  window.dispatchEvent(new CustomEvent("aiove:avatar-crop-state", { detail: { open: true } }));
  host.querySelectorAll("[data-crop-close]").forEach((button) => button.addEventListener("click", closeCropper));
  host.querySelector("[data-crop-retry]")?.addEventListener("click", retryCrop);
  host.querySelector("[data-crop-apply]")?.addEventListener("click", applyCrop);
  host.querySelector("#cropZoom")?.addEventListener("input", (event) => setCropZoom(event.target.value));
  bindCropDrag();
  clampCrop();
  drawCrop();
}

function retryCrop() {
  if (!cropState?.onRetry) return;
  const callback = cropState.onRetry;
  cropState.onCancel = null;
  closeCropperInternal({ callCancel: false });
  callback();
}

function bindCropDrag() {
  const stage = document.getElementById("cropStage");
  if (!stage || !cropState) return;
  const start = (x, y) => {
    cropState.dragging = true;
    cropState.lastX = x;
    cropState.lastY = y;
  };
  const move = (x, y) => {
    if (!cropState?.dragging) return;
    cropState.x += x - cropState.lastX;
    cropState.y += y - cropState.lastY;
    cropState.lastX = x;
    cropState.lastY = y;
    clampCrop();
    drawCrop();
  };
  const end = () => {
    if (cropState) cropState.dragging = false;
  };
  stage.addEventListener("mousedown", (event) => {
    event.preventDefault();
    start(event.clientX, event.clientY);
  });
  mouseMoveHandler = (event) => move(event.clientX, event.clientY);
  mouseUpHandler = end;
  window.addEventListener("mousemove", mouseMoveHandler);
  window.addEventListener("mouseup", mouseUpHandler);
  stage.addEventListener("touchstart", (event) => {
    const touch = event.touches[0];
    if (touch) start(touch.clientX, touch.clientY);
  });
  stage.addEventListener("touchmove", (event) => {
    event.preventDefault();
    const touch = event.touches[0];
    if (touch) move(touch.clientX, touch.clientY);
  });
  stage.addEventListener("touchend", end);
}

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function setCropZoom(value) {
  if (!cropState) return;
  cropState.scale = cropState.min * Number(value || 1);
  clampCrop();
  drawCrop();
}

function clampCrop() {
  if (!cropState) return;
  const width = cropState.image.naturalWidth * cropState.scale;
  const height = cropState.image.naturalHeight * cropState.scale;
  cropState.x = Math.max(-(width - CROP_STAGE_SIZE) / 2, Math.min((width - CROP_STAGE_SIZE) / 2, cropState.x));
  cropState.y = Math.max(-(height - CROP_STAGE_SIZE) / 2, Math.min((height - CROP_STAGE_SIZE) / 2, cropState.y));
}

function drawCrop() {
  const canvas = document.getElementById("cropCanvas");
  if (!canvas || !cropState) return;
  const context = canvas.getContext("2d");
  const width = cropState.image.naturalWidth * cropState.scale;
  const height = cropState.image.naturalHeight * cropState.scale;
  context.clearRect(0, 0, CROP_STAGE_SIZE, CROP_STAGE_SIZE);
  context.drawImage(cropState.image, (CROP_STAGE_SIZE - width) / 2 + cropState.x, (CROP_STAGE_SIZE - height) / 2 + cropState.y, width, height);
}

function applyCrop() {
  if (!cropState) return;
  cropState.onCancel = null;
  const output = document.createElement("canvas");
  output.width = CROP_OUT;
  output.height = CROP_OUT;
  const context = output.getContext("2d");
  const ratio = CROP_OUT / CROP_STAGE_SIZE;
  const width = cropState.image.naturalWidth * cropState.scale * ratio;
  const height = cropState.image.naturalHeight * cropState.scale * ratio;
  context.drawImage(cropState.image, (output.width - width) / 2 + cropState.x * ratio, (output.height - height) / 2 + cropState.y * ratio, width, height);
  const callback = cropState.onCropped;
  canvasToBlob(output, AVATAR_UPLOAD_POLICY.outputType, AVATAR_UPLOAD_POLICY.outputQuality).then((blob) => {
    if (!blob) {
      const copy = cropState?.copy || createSiteCopy("English");
      showDialog({ type: "error", title: copy.t("create.cropFailedTitle"), message: copy.t("create.cropFailedBody") });
      return;
    }
    const previewUrl = output.toDataURL(AVATAR_UPLOAD_POLICY.outputType, AVATAR_UPLOAD_POLICY.outputQuality);
    closeCropper();
    callback?.({
      blob,
      previewUrl,
      fileName: `avatar-${Date.now()}${AVATAR_UPLOAD_POLICY.outputExtension}`,
    });
  }).catch(() => {
    const copy = cropState?.copy || createSiteCopy("English");
    showDialog({ type: "error", title: copy.t("create.cropFailedTitle"), message: copy.t("create.cropFailedBody") });
  });
}
