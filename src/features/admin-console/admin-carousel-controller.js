import { listAdminSites } from "../../services/admin-site-service.js";
import { listAdminCharacters } from "../../services/character-admin-service.js";
import { createAdminCarouselItem, listAdminCarouselItems, updateAdminCarouselItem, uploadAdminCarouselImage } from "../../services/home-carousel-service.js";
import { bindDropdowns } from "../shared-ui/dropdown.js";
import { showToast } from "../shared-ui/toast.js";
import { handleCarouselImageFile, openCarouselFilePicker } from "./admin-carousel-image-cropper.js";
import { adminCarouselEditorModalHtml, adminCarouselListHtml } from "./admin-console-carousel-template.js";
import { adminLogsErrorHtml } from "./admin-console-content.js";
import { setSavingState } from "./admin-form-utils.js";

export function bindAdminCarousel(shell) {
  const list = shell.querySelector("[data-carousel-list]");
  const count = shell.querySelector("[data-carousel-count]");
  const newButton = shell.querySelector("[data-carousel-new]");
  if (!list) return;

  let items = [];
  let sites = [];
  let characters = [];
  let activeId = "";
  let editorAbortController = null;

  const render = () => {
    list.innerHTML = adminCarouselListHtml(items, activeId);
    if (count) count.textContent = `${items.length} 张轮播图`;
    bindCarouselRows();
  };

  const bindCarouselRows = () => {
    list.querySelectorAll("[data-carousel-edit]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        openCarouselItem(button.dataset.carouselEdit || "");
      });
    });
  };

  const openCarouselItem = (carouselId) => {
    activeId = carouselId;
    const activeItem = items.find((item) => item.id === activeId);
    if (!activeItem) return;
    render();
    openEditor(activeItem);
  };

  const closeEditor = () => {
    editorAbortController?.abort();
    editorAbortController = null;
    document.body.classList.remove("dialog-open");
    document.getElementById("carouselEditorHost")?.remove();
  };

  const openEditor = (item = null) => {
    closeEditor();
    editorAbortController = new AbortController();
    const host = document.createElement("div");
    host.id = "carouselEditorHost";
    host.className = "dialog-host account-form-host";
    host.innerHTML = adminCarouselEditorModalHtml(item, { sites, characters });
    document.body.append(host);
    document.body.classList.add("dialog-open");
    host.querySelectorAll("[data-carousel-editor-close]").forEach((button) => button.addEventListener("click", closeEditor));
    const preview = host.querySelector("[data-carousel-image-preview]");
    if (preview && !item?.imageUrl) preview.removeAttribute("src");
    bindCarouselForm(host, item, closeEditor, editorAbortController.signal);
    bindDropdowns(host);
  };

  const bindCarouselForm = (host, carouselItem, close, signal) => {
    const form = host.querySelector("[data-carousel-form]");
    if (!form) return;
    bindCarouselImageUpload(form);
    bindCarouselCtaTarget(form, { sites, characters, signal });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const saveButton = form.querySelector("[data-carousel-save]");
      const tip = form.querySelector("[data-carousel-save-tip]");
      setSavingState(saveButton, tip, true, "保存中...");
      try {
        const payload = await readCarouselFormPayload(form, tip);
        const result = carouselItem?.id
          ? await updateAdminCarouselItem(carouselItem.id, payload)
          : await createAdminCarouselItem(payload);
        const savedItem = result.item;
        if (savedItem) {
          items = carouselItem?.id
            ? items.map((current) => current.id === savedItem.id ? savedItem : current)
            : [...items, savedItem];
          items.sort((left, right) => Number(left.displayOrder || 0) - Number(right.displayOrder || 0));
          activeId = savedItem.id;
        }
        render();
        close?.();
        showToast("轮播图已保存");
      } catch (error) {
        setSavingState(saveButton, tip, false, error.message || "保存失败，请稍后再试");
      }
    });
  };

  const load = async () => {
    list.innerHTML = `<div class="log-empty">正在加载轮播图...</div>`;
    try {
      const [carouselResult, siteResult, characterResult] = await Promise.all([
        listAdminCarouselItems(),
        listAdminSites(),
        listAdminCharacters(),
      ]);
      items = carouselResult.items || [];
      sites = siteResult.items || [];
      characters = Array.isArray(characterResult.items) ? characterResult.items : [];
      activeId = items[0]?.id || "";
      render();
    } catch (error) {
      list.innerHTML = adminLogsErrorHtml(error.message);
      if (count) count.textContent = "读取失败";
    }
  };

  newButton?.addEventListener("click", () => {
    activeId = "";
    render();
    openEditor(null);
  });

  load();
}

function bindCarouselImageUpload(form) {
  const uploadButton = form.querySelector("[data-carousel-image-upload]");
  const fileInput = form.querySelector("[data-carousel-image-file]");
  const preview = form.querySelector("[data-carousel-image-preview]");
  const pendingBlobInput = form.querySelector("[data-carousel-pending-blob]");
  const pendingNameInput = form.querySelector("[data-carousel-pending-name]");
  const tip = form.querySelector("[data-carousel-save-tip]");
  if (!uploadButton || !fileInput || !pendingBlobInput || !pendingNameInput) return;

  uploadButton.addEventListener("click", () => openCarouselFilePicker(fileInput));
  fileInput.addEventListener("change", (event) => {
    handleCarouselImageFile(event, {
      onCropped: ({ blob, previewUrl, fileName }) => {
        const objectUrl = URL.createObjectURL(blob);
        pendingBlobInput.__carouselBlob = blob;
        pendingNameInput.value = fileName || "carousel.webp";
        pendingBlobInput.value = objectUrl;
        if (preview) {
          preview.src = previewUrl || objectUrl;
          preview.hidden = false;
          preview.closest(".carousel-image-preview")?.classList.remove("is-empty");
        }
        if (tip) tip.textContent = "图片已裁剪，点击保存后才会上传并替换轮播图。";
      },
    });
  });
}

function bindCarouselCtaTarget(form, { sites = [], characters = [], signal } = {}) {
  const typeSelect = form.querySelector('input[name="ctaType"]');
  const siteSelect = form.querySelector('input[name="siteId"]');
  const targetInput = form.querySelector("[data-carousel-cta-target]");
  const characterPicker = form.querySelector("[data-carousel-character-target]");
  const characterCurrent = form.querySelector("[data-carousel-character-current]");
  const characterSearch = form.querySelector("[data-carousel-character-search]");
  const urlInput = form.querySelector("[data-carousel-url-target]");
  const optionButtons = Array.from(form.querySelectorAll("[data-carousel-character-option]"));
  if (!typeSelect || !targetInput || !characterPicker || !characterSearch || !urlInput) return;

  const syncCurrentLabel = () => {
    const selected = optionButtons.find((option) => option.dataset.carouselCharacterOption === targetInput.value);
    characterCurrent.innerHTML = selected
      ? `<i>${escapeHtml(`${selected.dataset.name || selected.dataset.carouselCharacterOption} · ${selected.dataset.carouselCharacterOption}`)}</i>`
      : `<span>未选择角色</span>`;
  };

  const getEffectiveMascotIdForSite = (siteId) => {
    if (!siteId) return "";
    const site = sites.find((item) => item.id === siteId);
    const mascotId = String(site?.mascotCharacterId || "").trim();
    return mascotId || "mascot_template";
  };

  const isEligibleForSite = (option, siteId) => {
    const categoryId = option.dataset.categoryId || "";
    const optionSiteId = option.dataset.siteId || "";
    if (categoryId !== "mascot" && categoryId !== "creator") return false;
    if (!siteId) return true;
    if (categoryId === "creator") return optionSiteId === siteId;
    return option.dataset.carouselCharacterOption === getEffectiveMascotIdForSite(siteId);
  };

  const filterOptions = () => {
    const query = String(characterSearch.value || "").trim().toLowerCase();
    const siteId = String(siteSelect?.value || "").trim();
    let firstVisible = null;
    optionButtons.forEach((option) => {
      const matchesSite = isEligibleForSite(option, siteId);
      const matchesQuery = !query || String(option.dataset.search || "").includes(query);
      const hidden = !matchesSite || !matchesQuery;
      option.hidden = hidden;
      option.classList.toggle("is-active", option.dataset.carouselCharacterOption === targetInput.value);
      if (!hidden && !firstVisible) firstVisible = option;
    });

    const selectedStillVisible = optionButtons.some((option) => !option.hidden && option.dataset.carouselCharacterOption === targetInput.value);
    if (!selectedStillVisible && siteId) {
      const mascotId = getEffectiveMascotIdForSite(siteId);
      const mascotOption = optionButtons.find((option) => option.dataset.carouselCharacterOption === mascotId);
      targetInput.value = mascotOption && !mascotOption.hidden ? mascotId : "";
    }
    syncCurrentLabel();
    characterPicker.classList.toggle("is-empty", !firstVisible);
  };

  const sync = () => {
    const type = typeSelect.value;
    characterPicker.hidden = type !== "character";
    urlInput.hidden = type !== "url";
    targetInput.disabled = type === "none";
    if (type === "none") {
      targetInput.value = "";
      urlInput.value = "";
    } else if (type === "url") {
      targetInput.value = urlInput.value || "";
    } else if (type === "character") {
      filterOptions();
    }
    syncCurrentLabel();
  };
  typeSelect.addEventListener("change", sync);
  siteSelect?.addEventListener("change", () => {
    if (typeSelect.value === "character") filterOptions();
  });
  characterSearch.addEventListener("focus", () => {
    characterPicker.classList.add("is-open");
    filterOptions();
  });
  characterSearch.addEventListener("input", filterOptions);
  characterPicker.addEventListener("click", (event) => {
    const option = event.target.closest("[data-carousel-character-option]");
    if (!option) return;
    event.preventDefault();
    targetInput.value = option.dataset.carouselCharacterOption || "";
    characterSearch.value = "";
    characterPicker.classList.remove("is-open");
    filterOptions();
  });
  urlInput.addEventListener("input", () => {
    if (typeSelect.value === "url") targetInput.value = urlInput.value || "";
  });
  document.addEventListener("click", (event) => {
    if (!characterPicker.contains(event.target)) characterPicker.classList.remove("is-open");
  }, signal ? { capture: true, signal } : { capture: true });
  sync();
}

async function readCarouselFormPayload(form, tip) {
  const data = new FormData(form);
  const pendingBlobInput = form.querySelector("[data-carousel-pending-blob]");
  let imageUrl = data.get("imageUrl");
  if (pendingBlobInput?.__carouselBlob) {
    if (tip) tip.textContent = "图片上传中...";
    const result = await uploadAdminCarouselImage({
      blob: pendingBlobInput.__carouselBlob,
      filename: data.get("pendingImageName") || "carousel.webp",
    });
    imageUrl = result.imageUrl;
  }
  return {
    title: data.get("title"),
    subtitle: data.get("subtitle"),
    eyebrow: data.get("eyebrow"),
    imageUrl,
    siteId: data.get("siteId"),
    ctaText: data.get("ctaText"),
    ctaType: data.get("ctaType"),
    ctaTarget: resolveCarouselCtaTarget(form, data),
    displayOrder: data.get("displayOrder"),
    status: data.get("status"),
  };
}

function resolveCarouselCtaTarget(form, data) {
  const type = String(data.get("ctaType") || "").trim();
  if (type === "url") return form.querySelector("[data-carousel-url-target]")?.value || "";
  if (type === "character") return data.get("ctaTarget");
  return "";
}

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
