import {
  parseProductPanelImages,
  parseProductPayload,
  setProductPanelImage,
  setProductPanelTrackOffset,
} from "./chat-product-panel-renderer.js";

export function shiftProductPanelImage(root, direction, onProductChange) {
  const images = parseProductPanelImages(root);
  if (images.length < 2) return;
  const current = Number(root.dataset.productPanelImageIndex || 0);
  const next = (current + direction + images.length) % images.length;
  root.dataset.productPanelImageIndex = String(next);
  setProductPanelImage(root);
  const product = parseProductPayload(root.dataset.productPanelProduct);
  const nextProduct = { ...product, imageIndex: next };
  root.dataset.productPanelProduct = JSON.stringify(nextProduct);
  onProductChange?.(nextProduct);
}

export function bindProductGalleryDrag(root, onProductChange) {
  const hero = root.querySelector(".pp-hero");
  if (!hero) return;
  let startX = 0;
  let startY = 0;
  let pointerId = null;
  let dragging = false;
  let dragDeltaX = 0;

  hero.addEventListener("pointerdown", (event) => {
    if (event.target.closest("button")) return;
    if (parseProductPanelImages(root).length < 2) return;
    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    dragging = true;
    dragDeltaX = 0;
    hero.setPointerCapture?.(pointerId);
    hero.classList.add("is-dragging");
    hero.querySelector("[data-product-panel-track]")?.classList.add("is-dragging");
  });

  hero.addEventListener("pointermove", (event) => {
    if (!dragging || event.pointerId !== pointerId) return;
    const deltaX = event.clientX - startX;
    const deltaY = event.clientY - startY;
    if (Math.abs(deltaY) > Math.abs(deltaX) * 1.4) return;
    dragDeltaX = deltaX;
    setProductPanelTrackOffset(root, { dragDeltaX });
  });

  hero.addEventListener("pointerup", (event) => {
    if (!dragging || event.pointerId !== pointerId) return;
    finishProductGalleryDrag(root, hero, {
      deltaX: event.clientX - startX,
      deltaY: event.clientY - startY,
      onProductChange,
    });
    dragging = false;
    pointerId = null;
    dragDeltaX = 0;
  });

  hero.addEventListener("pointercancel", () => {
    dragging = false;
    pointerId = null;
    hero.classList.remove("is-dragging");
    hero.querySelector("[data-product-panel-track]")?.classList.remove("is-dragging");
    setProductPanelTrackOffset(root);
  });
}

function finishProductGalleryDrag(root, hero, { deltaX = 0, deltaY = 0, onProductChange } = {}) {
  hero.classList.remove("is-dragging");
  hero.querySelector("[data-product-panel-track]")?.classList.remove("is-dragging");
  const absX = Math.abs(deltaX);
  const absY = Math.abs(deltaY);
  if (absX < 45 || absX < absY * 1.25) {
    setProductPanelTrackOffset(root);
    return;
  }
  shiftProductPanelImage(root, deltaX < 0 ? 1 : -1, onProductChange);
}
