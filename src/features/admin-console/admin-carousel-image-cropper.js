import { ICONS } from "../../icons/icons.js";
import { CAROUSEL_UPLOAD_POLICY } from "../../config/upload-policies.js";
import { canvasToBlob } from "../../utils/image-processing.js";
import { showDialog } from "../shared-ui/dialog.js";

const CROP_WIDTH = CAROUSEL_UPLOAD_POLICY.outputWidth;
const CROP_HEIGHT = CAROUSEL_UPLOAD_POLICY.outputHeight;
const STAGE_WIDTH = CAROUSEL_UPLOAD_POLICY.cropStageWidth;
const STAGE_HEIGHT = CAROUSEL_UPLOAD_POLICY.cropStageHeight;
const ALLOWED_IMAGE_TYPES = new Set(CAROUSEL_UPLOAD_POLICY.allowedImageTypes);
let cropState = null;
let mouseMoveHandler = null;
let mouseUpHandler = null;

export function openCarouselFilePicker(input) {
  input?.click();
}

export function handleCarouselImageFile(event, { onCropped } = {}) {
  const file = event.target.files?.[0] || null;
  event.target.value = "";
  if (!file) return;
  if (!ALLOWED_IMAGE_TYPES.has(String(file.type || "").toLowerCase())) {
    showDialog({ type: "error", title: "Unsupported file", message: "Please choose a JPG, JFIF, PNG, or WebP image." });
    return;
  }
  if (file.size > CAROUSEL_UPLOAD_POLICY.maxSourceBytes) {
    showDialog({ type: "error", title: "File too large", message: "That image is over 12 MB. Please choose a smaller image." });
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    const image = new Image();
    image.onload = () => openCropper(image, { onCropped });
    image.onerror = () => showDialog({ type: "error", title: "Could not load image", message: "We could not read that image. Try another image." });
    image.src = reader.result;
  };
  reader.onerror = () => showDialog({ type: "error", title: "Read failed", message: "We could not read that file. Try again." });
  reader.readAsDataURL(file);
}

function closeCropper() {
  document.body.classList.remove("carousel-crop-open");
  document.getElementById("carouselCropHost")?.remove();
  if (mouseMoveHandler) window.removeEventListener("mousemove", mouseMoveHandler);
  if (mouseUpHandler) window.removeEventListener("mouseup", mouseUpHandler);
  mouseMoveHandler = null;
  mouseUpHandler = null;
  cropState = null;
}

function openCropper(image, { onCropped } = {}) {
  closeCropper();
  const min = Math.max(STAGE_WIDTH / image.naturalWidth, STAGE_HEIGHT / image.naturalHeight);
  cropState = { image, scale: min, min, x: 0, y: 0, dragging: false, lastX: 0, lastY: 0, onCropped };

  const host = document.createElement("div");
  host.id = "carouselCropHost";
  host.className = "crop-host carousel-crop-host";
  host.innerHTML = `
    <div class="dialog-scrim" data-carousel-crop-close></div>
    <div class="crop-modal carousel-crop-modal" role="dialog" aria-modal="true">
      <button class="dlg-x" type="button" aria-label="Close" data-carousel-crop-close>${ICONS.close}</button>
      <h3 class="crop-title">Position banner image</h3>
      <p class="crop-hint">Drag to move · slide to zoom · 16:9</p>
      <div class="carousel-crop-stage" id="carouselCropStage" style="width:${STAGE_WIDTH}px;height:${STAGE_HEIGHT}px">
        <canvas id="carouselCropCanvas" width="${STAGE_WIDTH}" height="${STAGE_HEIGHT}"></canvas>
        <div class="carousel-crop-frame"></div>
      </div>
      <div class="crop-zoom">
        <span>${ICONS.image || ICONS.cam}</span>
        <input id="carouselCropZoom" type="range" min="1" max="3" step="0.01" value="1" />
      </div>
      <div class="crop-actions">
        <button class="btn btn-ghost" type="button" data-carousel-crop-close>Cancel</button>
        <button class="btn btn-primary crop-apply" type="button" data-carousel-crop-apply><span class="crop-apply-ic">${ICONS.check || ICONS.spark}</span><span class="crop-apply-text">Use image</span></button>
      </div>
    </div>`;
  document.body.append(host);
  document.body.classList.add("carousel-crop-open");
  host.querySelectorAll("[data-carousel-crop-close]").forEach((button) => button.addEventListener("click", closeCropper));
  host.querySelector("[data-carousel-crop-apply]")?.addEventListener("click", applyCrop);
  host.querySelector("#carouselCropZoom")?.addEventListener("input", (event) => setCropZoom(event.target.value));
  bindCropDrag();
  clampCrop();
  drawCrop();
}

function bindCropDrag() {
  const stage = document.getElementById("carouselCropStage");
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
  cropState.x = Math.max(-(width - STAGE_WIDTH) / 2, Math.min((width - STAGE_WIDTH) / 2, cropState.x));
  cropState.y = Math.max(-(height - STAGE_HEIGHT) / 2, Math.min((height - STAGE_HEIGHT) / 2, cropState.y));
}

function drawCrop() {
  const canvas = document.getElementById("carouselCropCanvas");
  if (!canvas || !cropState) return;
  const context = canvas.getContext("2d");
  const width = cropState.image.naturalWidth * cropState.scale;
  const height = cropState.image.naturalHeight * cropState.scale;
  context.clearRect(0, 0, STAGE_WIDTH, STAGE_HEIGHT);
  context.drawImage(cropState.image, (STAGE_WIDTH - width) / 2 + cropState.x, (STAGE_HEIGHT - height) / 2 + cropState.y, width, height);
}

function applyCrop() {
  if (!cropState) return;
  const output = document.createElement("canvas");
  output.width = CROP_WIDTH;
  output.height = CROP_HEIGHT;
  const context = output.getContext("2d");
  const ratio = CROP_WIDTH / STAGE_WIDTH;
  const width = cropState.image.naturalWidth * cropState.scale * ratio;
  const height = cropState.image.naturalHeight * cropState.scale * ratio;
  context.drawImage(cropState.image, (output.width - width) / 2 + cropState.x * ratio, (output.height - height) / 2 + cropState.y * ratio, width, height);
  const callback = cropState.onCropped;
  canvasToBlob(output, CAROUSEL_UPLOAD_POLICY.outputType, CAROUSEL_UPLOAD_POLICY.outputQuality).then((blob) => {
    const previewUrl = output.toDataURL(CAROUSEL_UPLOAD_POLICY.outputType, CAROUSEL_UPLOAD_POLICY.outputQuality);
    closeCropper();
    callback?.({
      blob,
      previewUrl,
      fileName: `carousel-${Date.now()}${CAROUSEL_UPLOAD_POLICY.outputExtension}`,
    });
  }).catch(() => {
    showDialog({ type: "error", title: "Processing failed", message: "Banner cropping failed. Please choose another image." });
  });
}
