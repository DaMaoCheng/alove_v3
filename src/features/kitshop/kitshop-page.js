import { getKitshopShelves } from "../../services/kitshop-service.js";
import { ICONS } from "../../icons/icons.js";
import { createTopbar } from "../app-shell/app-shell.js";
import { bindProductPanel, openProductPanelFromCard, productPanelHtml, productSizeChartModalHtml } from "../chat/chat-product-panel.js";
import { productCartHtml } from "../chat/chat-product-cart.js";
import { ttmallAccountBindingHtml } from "../chat/chat-ttmall-binding-panel.js";
import { ttmallCheckoutPanelHtml } from "../chat/chat-ttmall-checkout-panel.js";
import { normalizeProductPanelPayload } from "../chat/chat-product-panel-payload.js";
import { normalizeAssetUrl } from "../shared-ui/character-avatar.js";
import { showDialog } from "../shared-ui/dialog.js";
import { reportCatalogProductImpressions } from "../chat/chat-product-impressions.js";
import { createSiteCopy } from "../../i18n/site-copy.js";
import { getUserFacingErrorMessage } from "../../utils/user-facing-error.js";

const RAIL_EDGE_TOLERANCE = 16;

export function createKitshopPage({ siteSlug = "", pageLanguage = "English", guestMode = false, onNavigate } = {}) {
  const copy = createSiteCopy(pageLanguage);
  const fragment = document.createDocumentFragment();
  fragment.append(createTopbar(copy.t("top.search"), { guestMode, pageLanguage }));
  const page = document.createElement("div");
  page.className = "page kitshop-page";
  page.innerHTML = `
    <div class="kitshop-shell">
      <header class="kitshop-head">
        <span>${copy.t("kitshop.label")}</span>
        <h2>${copy.t("kitshop.title")}</h2>
      </header>
      <div class="kitshop-content" data-kitshop-content>
        ${kitshopLoadingHtml(copy)}
      </div>
    </div>
    <div class="kitshop-detail-shell">
      <div class="prod-scrim"></div>
      <aside class="prod-panel kitshop-prod-panel">${productPanelHtml({ includeSizeChartModal: false, pageLanguage })}</aside>
      ${productCartHtml({ pageLanguage })}
      ${ttmallAccountBindingHtml()}
      ${ttmallCheckoutPanelHtml()}
    </div>
    ${productSizeChartModalHtml({ pageLanguage })}`;

  bindProductPanel(page, {
    language: pageLanguage,
    siteSlug,
    clickEventType: "product_kitshop_card_click",
    clickSource: "kitshop_shelf",
    recordAnalytics: !guestMode,
    guestMode,
    recordDetailEvents: !guestMode,
    requireAuthForCheckout: guestMode,
    onRestrictedCheckout: () => showGuestCheckoutPrompt(onNavigate, copy),
  });
  bindKitshopKeyboardOpen(page);
  loadKitshop(page, { siteSlug, pageLanguage, guestMode });
  fragment.append(page);
  return fragment;
}

async function loadKitshop(page, { siteSlug = "", pageLanguage = "", guestMode = false } = {}) {
  const copy = createSiteCopy(pageLanguage);
  const content = page.querySelector("[data-kitshop-content]");
  if (!content) return;
  try {
    const result = await getKitshopShelves({ siteSlug, guestMode });
    content.innerHTML = kitshopContentHtml(result, { copy });
    if (!guestMode) {
      reportCatalogProductImpressions(content, {
        selector: ".kitshop-product-card[data-product-analytics]",
        eventType: "product_kitshop_impression",
        source: "kitshop_shelf",
      });
    }
    bindKitshopProductButtons(page, content, { pageLanguage, guestMode, copy });
    bindKitshopRails(content);
  } catch (error) {
    content.innerHTML = kitshopErrorHtml(getUserFacingErrorMessage(error, {
      pageLanguage,
      fallbackType: "generic",
      allowKnownValidation: false,
    }), copy);
  }
}

function bindKitshopKeyboardOpen(page) {
  page.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const card = event.target.closest(".kitshop-product-card");
    if (!card || !page.contains(card)) return;
    event.preventDefault();
    card.click();
  });
}

function kitshopContentHtml(result = {}, { copy } = {}) {
  const shelves = Array.isArray(result.shelves) ? result.shelves : [];
  const hasItems = shelves.some((shelf) => Array.isArray(shelf.items) && shelf.items.length);
  if (!hasItems) {
    return `
      ${result.error ? `<div class="kitshop-alert">${escapeHtml(copy.t("kitshop.error"))}</div>` : ""}
      <div class="kitshop-empty">${copy.t("kitshop.empty")}</div>`;
  }
  return `
    ${result.warning ? `<div class="kitshop-alert">${escapeHtml(copy.t("kitshop.cachedWarning"))}</div>` : ""}
    ${shelves.map((shelf) => kitshopShelfHtml(shelf, result.site, copy)).join("")}`;
}

function kitshopShelfHtml(shelf = {}, site = {}, copy) {
  const items = Array.isArray(shelf.items) ? shelf.items : [];
  const storeUrl = resolveStoreUrl(site);
  return `
    <section class="kitshop-shelf" data-kitshop-shelf="${escapeAttr(shelf.key || "")}">
      <div class="kitshop-shelf-head">
        <h3>${escapeHtml(resolveKitshopShelfTitle(shelf, copy))}</h3>
        ${storeUrl ? `<a class="kitshop-view-more" href="${escapeAttr(storeUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(copy.t("kitshop.viewMore"))}${ICONS.back}</a>` : ""}
      </div>
      <div class="kitshop-rail-wrap" data-kitshop-rail>
        <button class="kitshop-rail-nav kitshop-rail-nav--prev" type="button" data-kitshop-rail-prev aria-label="${copy.t("kitshop.previous")}" hidden>${ICONS.back}</button>
        <div class="kitshop-rail-track" data-kitshop-rail-track>
          ${items.length ? items.map((product, index) => kitshopProductCardHtml(product, site, shelf, index, copy)).join("") : `<div class="kitshop-empty-row">${copy.t("kitshop.noProducts")}</div>`}
        </div>
        <button class="kitshop-rail-nav kitshop-rail-nav--next" type="button" data-kitshop-rail-next aria-label="${copy.t("kitshop.next")}" hidden>${ICONS.back}</button>
      </div>
    </section>`;
}

function resolveKitshopShelfTitle(shelf = {}, copy) {
  if (shelf.key === "recommended") return copy.t("kitshop.recommended");
  if (shelf.key === "best_sellers") return copy.t("kitshop.bestSellers");
  // Homepage floor names are merchant content, not fixed Alove UI copy.
  return shelf.title || copy.t("kitshop.shelf");
}

function resolveStoreUrl(site = {}) {
  const url = String(site.siteUrl || site.storefrontUrl || "").trim();
  if (!url || url.startsWith("shopify-admin:")) return "";
  return url;
}

function bindKitshopRails(root) {
  root.querySelectorAll("[data-kitshop-rail]").forEach((rail) => {
    const track = rail.querySelector("[data-kitshop-rail-track]");
    const prev = rail.querySelector("[data-kitshop-rail-prev]");
    const next = rail.querySelector("[data-kitshop-rail-next]");
    if (!track || !prev || !next) return;

    let frame = 0;
    const updateNav = () => {
      frame = 0;
      const maxScroll = Math.max(0, track.scrollWidth - track.clientWidth);
      const currentScroll = Math.max(0, Math.min(track.scrollLeft, maxScroll));
      const hasOverflow = maxScroll > RAIL_EDGE_TOLERANCE;
      const atStart = currentScroll <= RAIL_EDGE_TOLERANCE;
      const atEnd = currentScroll >= maxScroll - RAIL_EDGE_TOLERANCE;
      const peekState = getRailPeekState(track);
      rail.classList.toggle("has-overflow", hasOverflow);
      rail.classList.toggle("has-peek-left", hasOverflow && peekState.left);
      rail.classList.toggle("has-peek-right", hasOverflow && peekState.right);
      prev.hidden = !hasOverflow || atStart;
      next.hidden = !hasOverflow || atEnd;
    };
    const scheduleUpdate = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(updateNav);
    };
    const scrollByPage = (direction) => {
      track.scrollBy({ left: direction * Math.max(280, track.clientWidth * 0.82), behavior: "smooth" });
    };
    let dragStartX = 0;
    let dragStartLeft = 0;
    let dragPointerId = null;
    let isDragging = false;
    let suppressClick = false;
    const finishDrag = () => {
      if (isDragging && dragPointerId !== null && track.hasPointerCapture?.(dragPointerId)) {
        track.releasePointerCapture?.(dragPointerId);
      }
      dragPointerId = null;
      isDragging = false;
      track.classList.remove("is-dragging");
    };

    prev.addEventListener("click", () => scrollByPage(-1));
    next.addEventListener("click", () => scrollByPage(1));
    track.addEventListener("scroll", scheduleUpdate, { passive: true });
    track.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || event.pointerType === "touch") return;
      dragPointerId = event.pointerId;
      dragStartX = event.clientX;
      dragStartLeft = track.scrollLeft;
      isDragging = false;
      suppressClick = false;
    });
    track.addEventListener("pointermove", (event) => {
      if (dragPointerId !== event.pointerId) return;
      const delta = event.clientX - dragStartX;
      if (!isDragging && Math.abs(delta) <= 5) return;
      if (!isDragging) {
        isDragging = true;
        suppressClick = true;
        track.classList.add("is-dragging");
        track.setPointerCapture?.(event.pointerId);
      }
      track.scrollLeft = dragStartLeft - delta;
      event.preventDefault();
    });
    track.addEventListener("pointerup", finishDrag);
    track.addEventListener("pointercancel", finishDrag);
    track.addEventListener("click", (event) => {
      if (!suppressClick) return;
      event.preventDefault();
      event.stopPropagation();
      suppressClick = false;
    }, true);

    if ("ResizeObserver" in window) {
      const observer = new ResizeObserver(scheduleUpdate);
      observer.observe(track);
    }
    if ("MutationObserver" in window) {
      const observer = new MutationObserver(scheduleUpdate);
      observer.observe(track, { childList: true });
    }
    window.setTimeout(updateNav, 0);
  });
}

function getRailPeekState(track) {
  const trackRect = track.getBoundingClientRect();
  const tolerance = 2;
  return Array.from(track.querySelectorAll(".kitshop-product-card")).reduce((state, card) => {
    const cardRect = card.getBoundingClientRect();
    const crossesLeft = cardRect.left < trackRect.left - tolerance && cardRect.right > trackRect.left + tolerance;
    const crossesRight = cardRect.left < trackRect.right - tolerance && cardRect.right > trackRect.right + tolerance;
    return {
      left: state.left || crossesLeft,
      right: state.right || crossesRight,
    };
  }, { left: false, right: false });
}

function kitshopProductCardHtml(product = {}, site = {}, shelf = {}, index = 0, copy) {
  const payload = normalizeProductPanelPayload(product, { site });
  const analytics = {
    ...(payload.analytics || {}),
    siteId: payload.siteId,
    siteSlug: payload.siteSlug,
    productId: payload.productId || payload.id,
    productTitle: payload.name,
    productUrl: payload.url,
    shelfKey: shelf.key || "",
    position: index + 1,
  };
  const imageUrl = normalizeAssetUrl(payload.imageUrl || "/assets/jersey_product.png");
  const tag = payload.tag ? `<span class="pc-tag">${escapeHtml(payload.tag)}</span>` : "";
  const price = payload.priceNow || payload.priceWas
    ? `<div class="pc-price">${payload.priceNow ? `<span class="now">${escapeHtml(payload.priceNow)}</span>` : ""}${payload.priceWas ? `<span class="was">${escapeHtml(payload.priceWas)}</span>` : ""}</div>`
    : "";
  return `
    <article class="product-card kitshop-product-card product-card-trigger"
      role="button"
      tabindex="0"
      data-product="${escapeAttr(JSON.stringify(payload))}"
      data-product-analytics="${escapeAttr(JSON.stringify(analytics))}">
      <div class="pc-img">${tag}<img src="${escapeAttr(imageUrl)}" alt="${escapeAttr(payload.name || copy.t("product.item"))}" loading="lazy" /></div>
      <div class="pc-body">
        <div class="pc-name">${escapeHtml(payload.name || copy.t("product.item"))}</div>
        ${payload.subtitle ? `<div class="pc-sub">${escapeHtml(payload.subtitle)}</div>` : ""}
        ${price}
        <button class="btn btn-primary" type="button" data-kitshop-product-open>${copy.t("search.view")}</button>
      </div>
    </article>`;
}

function bindKitshopProductButtons(page, content, { pageLanguage = "", guestMode = false } = {}) {
  content.addEventListener("click", (event) => {
    const button = event.target.closest("[data-kitshop-product-open]");
    if (!button || !content.contains(button)) return;
    const card = button.closest(".kitshop-product-card");
    if (!card) return;
    event.preventDefault();
    event.stopPropagation();
    openProductPanelFromCard(page, card, {
      clickEventType: "product_kitshop_card_click",
      clickSource: "kitshop_shelf",
      recordAnalytics: !guestMode,
      recordDetailEvents: !guestMode,
      language: pageLanguage,
      siteSlug: page.dataset.productPanelSiteSlug || "",
    });
  }, true);
}

function showGuestCheckoutPrompt(onNavigate, copy) {
  showDialog({
    type: "info",
    title: copy.t("common.checkoutTitle"),
    message: copy.t("common.checkoutMessage"),
    confirmText: copy.t("common.createAccount"),
    cancelText: copy.t("common.notNow"),
    onConfirm: () => onNavigate?.("register"),
  });
}

function kitshopLoadingHtml(copy) {
  return `
    <div class="kitshop-loading">
      <i></i>
      <span>${copy.t("kitshop.loading")}</span>
    </div>`;
}

function kitshopErrorHtml(message = "", copy) {
  return `
    <div class="kitshop-alert">${escapeHtml(message || copy.t("kitshop.error"))}</div>
    <div class="kitshop-empty">${copy.t("kitshop.empty")}</div>`;
}

function escapeHtml(value = "") {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttr(value = "") {
  return escapeHtml(value).replace(/"/g, "&quot;");
}
