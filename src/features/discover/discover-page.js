import { openDiscoverCharacterConfirm } from "./discover-character-confirm.js";
import { CREATE_CATS } from "../../data/demo-data.js";
import { ICONS } from "../../icons/icons.js";
import { createTopbar } from "../app-shell/app-shell.js";
import { characterAvatarHtml } from "../shared-ui/character-avatar.js";
import { showDialog } from "../shared-ui/dialog.js";
import { showToast } from "../shared-ui/toast.js";
import { createSiteCopy } from "../../i18n/site-copy.js";

const MAX_VISIBLE_CHARACTER_CARDS = 30;

export function createDiscoverPage({ activeCategory, characters = [], categories = [], carouselItems = [], activatedCharacterIds = [], loading = false, error = "", guestMode = false, guestMascotCharacterId = "", pageLanguage = "English", onCategoryChange, onNavigate, onActivate }) {
  const copy = createSiteCopy(pageLanguage);
  const fragment = document.createDocumentFragment();
  fragment.append(createTopbar(copy.t("top.search"), { guestMode, pageLanguage }));
  const activatedCharacterIdSet = new Set(activatedCharacterIds.map((id) => String(id || "").trim()).filter(Boolean));
  const categoryList = (categories.length
    ? categories.map((item) => ({ id: item.id || "", label: item.label }))
    : CREATE_CATS.map((item) => ({ id: item.id || item.key || "", label: item.label }))
  ).filter((item) => !isMascotCategory(item));
  const discoverCharacters = characters.filter((item) => !isMascotCharacter(item));
  const guestMascot = guestMode ? characters.find((item) => item.id === guestMascotCharacterId) : null;
  const visibleCharacters = [guestMascot, ...filterCharacters(discoverCharacters, activeCategory)].filter(Boolean);
  const heroBanner = carouselItems[0] || getFallbackBanner(copy);

  const page = document.createElement("div");
  page.className = "page";
  page.innerHTML = `
    ${bannerHtml(heroBanner, copy)}
    <div class="chips-row">
      ${categoryList.map((cat) => `<button class="chip ${activeCategory === cat.label ? "active" : ""}" data-cat="${escapeAttr(cat.label)}">${escapeHtml(discoverCategoryLabel(cat, copy))}</button>`).join("")}
    </div>
    ${renderCharacterSection({ characters: visibleCharacters, loading, error, copy })}
  `;

  page.querySelectorAll("[data-cat]").forEach((button) => {
    button.addEventListener("click", () => onCategoryChange(button.dataset.cat));
  });
  page.querySelector(".banner [data-banner-character]")?.addEventListener("click", async (event) => {
    const characterId = event.currentTarget.dataset.bannerCharacter;
    await activateAndNavigate(characterId, { guestMode, guestMascotCharacterId, alreadyActivated: activatedCharacterIdSet.has(characterId), onActivate, onNavigate, copy });
  });
  page.querySelector(".banner [data-banner-url]")?.addEventListener("click", (event) => {
    const url = event.currentTarget.dataset.bannerUrl || "";
    if (url) window.location.href = url;
  });
  bindCharacterRail(page);
  page.querySelectorAll(".char-card[data-chat]").forEach((card) => {
    card.addEventListener("click", () => {
      const characterId = card.dataset.chat;
      const character = characters.find((item) => item.id === characterId);
      openDiscoverCharacterConfirm({
        character,
        pageLanguage,
        confirmText: activatedCharacterIdSet.has(characterId) ? copy.t("common.continue") : copy.t("common.start"),
        onConfirm: () => activateAndNavigate(characterId, { guestMode, guestMascotCharacterId, alreadyActivated: activatedCharacterIdSet.has(characterId), onActivate, onNavigate, copy }),
      });
    });
  });

  fragment.append(page);
  return fragment;
}

function bindCharacterRail(page) {
  page.querySelectorAll("[data-character-rail]").forEach((rail) => {
    const track = rail.querySelector("[data-character-rail-track]");
    const prev = rail.querySelector("[data-rail-prev]");
    const next = rail.querySelector("[data-rail-next]");
    if (!track || !prev || !next) return;

    let frame = 0;
    const updateNav = () => {
      frame = 0;
      const maxScroll = Math.max(0, track.scrollWidth - track.clientWidth);
      const hasOverflow = maxScroll > 2;
      rail.classList.toggle("has-overflow", hasOverflow);
      prev.hidden = !hasOverflow;
      next.hidden = !hasOverflow;
      prev.disabled = !hasOverflow || track.scrollLeft <= 2;
      next.disabled = !hasOverflow || track.scrollLeft >= maxScroll - 2;
    };
    const scheduleUpdate = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(updateNav);
    };
    const scrollByPage = (direction) => {
      track.scrollBy({ left: direction * Math.max(240, track.clientWidth * 0.82), behavior: "smooth" });
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
      if (Math.max(0, track.scrollWidth - track.clientWidth) <= 2) {
        finishDrag();
        suppressClick = false;
        return;
      }
      dragPointerId = event.pointerId;
      dragStartX = event.clientX;
      dragStartLeft = track.scrollLeft;
      isDragging = false;
      suppressClick = false;
    });
    track.addEventListener("pointermove", (event) => {
      if (dragPointerId !== event.pointerId) return;
      if ((event.buttons & 1) === 0) {
        finishDrag();
        suppressClick = false;
        return;
      }
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

function bannerHtml(item, copy) {
  const cta = bannerCtaHtml(item, copy);
  const imageUrl = normalizeBannerImageUrl(item.imageUrl);
  const style = imageUrl ? ` style="--banner-image:url('${escapeCssUrl(imageUrl)}')"` : "";
  return `
    <div class="banner"${style}>
      <div class="banner-copy">
        <span class="eyebrow">${ICONS.ball} ${escapeHtml(item.eyebrow || copy.t("discover.featured"))}</span>
        <h2>${escapeHtml(item.title || copy.t("discover.featuredCharacter"))}</h2>
        ${item.subtitle ? `<p>${escapeHtml(item.subtitle)}</p>` : ""}
        ${cta}
      </div>
    </div>
  `;
}

function bannerCtaHtml(item, copy) {
  const label = item.ctaText || copy.t("discover.open");
  if (item.ctaType === "character" && item.ctaTarget) {
    return `<button class="btn btn-primary" data-banner-character="${escapeAttr(item.ctaTarget)}">${escapeHtml(label)}</button>`;
  }
  if (item.ctaType === "url" && item.ctaTarget) {
    return `<button class="btn btn-primary" data-banner-url="${escapeAttr(item.ctaTarget)}">${escapeHtml(label)}</button>`;
  }
  return "";
}

function getFallbackBanner(copy) {
  return {
    title: copy.t("discover.fallbackTitle"),
    subtitle: copy.t("discover.fallbackBody"),
    eyebrow: copy.t("discover.fallbackEyebrow"),
    imageUrl: "/assets/banner_hero.png",
    ctaText: copy.t("discover.fallbackCta"),
    ctaType: "character",
    ctaTarget: "striker",
  };
}

async function activateAndNavigate(characterId, { guestMode = false, guestMascotCharacterId = "", alreadyActivated = false, onActivate, onNavigate, copy }) {
  if (guestMode) {
    onNavigate?.("chat", characterId);
    return;
  }
  if (alreadyActivated) {
    onNavigate?.("chat", characterId);
    return;
  }
  try {
    const result = await onActivate?.(characterId);
    if (result?.alreadyActivated) {
      onNavigate?.("chat", characterId);
      return;
    }
    showToast(copy.t("discover.added"));
    onNavigate("chat", characterId);
  } catch {
    showDialog({
      type: "error",
      title: copy.t("discover.activateFailed"),
      message: copy.t("common.tryAgain"),
      confirmText: copy.t("common.gotIt"),
    });
  }
}

function cardHtml(character, copy) {
  const badge = character.cardTag ? `<span class="card-badge ${character.cardTag === "live" ? "live" : ""}">${character.cardTagText}</span>` : "";
  const cardImageUrl = character.coverUrl || character.avatarUrl;
  return `
    <div class="char-card" data-chat="${character.id}">
      ${characterAvatarHtml({ name: character.name, imageUrl: cardImageUrl })}
      ${badge}
      <div class="char-meta">
        <div class="name">${character.name}</div>
        <div class="role">${character.roleTitle}</div>
        <div class="stats"><span><b>${character.metrics?.chatCountLabel || "-"}</b> ${copy.t("discover.chats")}</span><span>★ ${character.metrics?.activationCountLabel || "0"}</span></div>
      </div>
    </div>
  `;
}

function renderCharacterSection({ characters, loading, error, copy }) {
  if (loading) {
    return characterRailHtml(`<div class="char-card"><div class="char-meta"><div class="name">${copy.t("discover.loading")}</div><div class="role">${copy.t("discover.wait")}</div></div></div>`, copy);
  }
  if (error) {
    return characterRailHtml(`<div class="char-card"><div class="char-meta"><div class="name">${copy.t("discover.loadFailed")}</div><div class="role">${error}</div></div></div>`, copy);
  }
  if (!characters.length) {
    return characterRailHtml(`<div class="char-card"><div class="char-meta"><div class="name">${copy.t("discover.empty")}</div><div class="role">${copy.t("discover.emptyCategory")}</div></div></div>`, copy);
  }
  return characterRailHtml(characters.slice(0, MAX_VISIBLE_CHARACTER_CARDS).map((character) => cardHtml(character, copy)).join(""), copy);
}

function characterRailHtml(content, copy) {
  return `
    <div class="character-rail" data-character-rail>
      <button class="character-rail-nav character-rail-nav--prev" type="button" data-rail-prev aria-label="${copy.t("discover.previous")}" hidden>${ICONS.back}</button>
      <div class="card-grid" data-character-rail-track>${content}</div>
      <button class="character-rail-nav character-rail-nav--next" type="button" data-rail-next aria-label="${copy.t("discover.next")}" hidden>${ICONS.back}</button>
    </div>
  `;
}

function filterCharacters(characters, activeCategory) {
  return characters.filter((item) => !activeCategory || item.category?.label === activeCategory);
}

function isMascotCategory(category = {}) {
  return String(category.id || category.key || category.label || "").trim().toLowerCase() === "mascot";
}

function isMascotCharacter(character = {}) {
  return String(character.category?.id || character.categoryId || character.category?.label || "").trim().toLowerCase() === "mascot";
}

function discoverCategoryLabel(category = {}, copy) {
  const normalized = String(category.id || category.key || category.label || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  const keyByCategory = {
    babe: "create.categoryBabe",
    football_babe: "create.categoryBabe",
    creator: "create.categoryCreator",
    pundit: "create.categoryPundit",
    fan: "create.categoryFan",
    companion: "create.categoryCompanion",
  };
  return keyByCategory[normalized] ? copy.t(keyByCategory[normalized]) : category.label;
}

function normalizeBannerImageUrl(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return "";
  if (/^(https?:)?\/\//i.test(normalized) || normalized.startsWith("/")) return normalized;
  return `/${normalized.replace(/^\/+/, "")}`;
}

function escapeCssUrl(value) {
  return String(value == null ? "" : value)
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/\n|\r|\f/g, "");
}

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/'/g, "\\'");
}
