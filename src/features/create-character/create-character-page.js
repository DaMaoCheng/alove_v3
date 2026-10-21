import { handleAvatarFile, openAvatarFilePicker } from "../avatar-cropper/avatar-cropper.js";
import { moderateAvatarFile } from "../../services/upload-service.js";
import { createTopbar } from "../app-shell/app-shell.js";
import { characterAvatarHtml } from "../shared-ui/character-avatar.js";
import { showDialog } from "../shared-ui/dialog.js";
import { showToast } from "../shared-ui/toast.js";
import { bindDropdowns } from "../shared-ui/dropdown.js";
import { resolveCreateCategory } from "./create-character-categories.js";
import { openAvatarGenerationModal } from "./create-avatar-generation-modal.js";
import { createCharacterPageHtml } from "./create-character-template.js";
import { updatePreviewRole, updatePreviewText } from "./create-character-preview.js";
import { updateVisibilityOptions } from "./create-character-visibility.js";
import { bindLanguagePicker } from "./create-character-language-picker.js";
import { bindVoicePreviewButtons } from "./create-character-voice-preview.js";
import { createSiteCopy } from "../../i18n/site-copy.js";

export function createCharacterPage({ createState, user = {}, guestMode = false, pageLanguage = "English", onNavigate, onChange, onAvatarSelected, onAvatarRemove, onAvatarGenerate, onSubmit, onPolish }) {
  const copy = createSiteCopy(pageLanguage);
  const { selectedCat, category: cat } = resolveCreateCategory(createState, user);
  const fragment = document.createDocumentFragment();
  fragment.append(createTopbar(copy.t("create.search"), { guestMode, pageLanguage }));

  const page = document.createElement("div");
  page.className = "page create-page";
  page.innerHTML = createCharacterPageHtml({ createState: { ...createState, cat: selectedCat }, category: cat, user, pageLanguage });
  bindDropdowns(page);
  bindVoicePreviewButtons(page, pageLanguage);
  bindLanguagePicker(page, onChange, pageLanguage);

  page.querySelectorAll("[data-key]").forEach((button) => {
    button.addEventListener("click", () => {
      onChange(button.dataset.key, button.dataset.value);
      if (button.dataset.key === "cat" || button.dataset.key === "vibe") {
        updatePreviewRole(page, button.dataset.key === "cat" ? button.dataset.value : selectedCat, button.dataset.key === "vibe" ? button.dataset.value : createState.vibe, pageLanguage);
      }
    });
  });

  page.querySelector('input[name="voice"]')?.addEventListener("change", (event) => {
    const value = event.target.value;
    onChange("voice", value);
  });

  page.querySelector("[data-voice-clone]")?.addEventListener("click", (event) => {
    event.preventDefault();
    if (guestMode) {
      showGuestCreateAuthPrompt(onNavigate, copy);
      return;
    }
    showDialog({
      type: "warning",
      title: copy.t("create.membersVoice"),
      message: copy.t("create.membersVoiceBody"),
      confirmText: copy.t("common.gotIt"),
      cancelText: copy.t("chat.cancel"),
    });
  });

  page.querySelector("[data-avatar-upload]")?.addEventListener("click", (event) => {
    event.preventDefault();
    if (guestMode) {
      showGuestCreateAuthPrompt(onNavigate, copy);
      return;
    }
    openAvatarFilePicker(page.querySelector("[data-avatar-file]"));
  });

  page.querySelector("[data-avatar-generate]")?.addEventListener("click", (event) => {
    event.preventDefault();
    if (guestMode) {
      showGuestCreateAuthPrompt(onNavigate, copy);
      return;
    }
    openAvatarGenerationModal({
      page,
      createState,
      categoryLabel: cat?.label || "",
      onGenerate: onAvatarGenerate,
      onAvatarSelected,
      onAvatarRemove,
      copy: avatarGenerationCopy(copy),
    });
  });

  page.querySelector("[data-avatar-file]")?.addEventListener("change", (event) => {
    handleAvatarFile(event, {
      onBeforeCrop: moderateAvatarFile,
      retryLabel: copy.t("create.reupload"),
      pageLanguage,
      onCropped: (avatarFile) => {
        if (typeof onAvatarSelected === "function") {
          onAvatarSelected(avatarFile);
        } else {
          onChange("avatarPreviewUrl", avatarFile.previewUrl || "");
        }
      },
    });
  });

  page.querySelector("[data-avatar-remove]")?.addEventListener("click", (event) => {
    event.preventDefault();
    if (typeof onAvatarRemove === "function") {
      onAvatarRemove();
      return;
    }
    onChange("avatarUrl", "");
    onChange("avatarPreviewUrl", "");
    showToast(copy.t("create.avatarRemoved"));
  });

  page.querySelector('input[name="name"]')?.addEventListener("input", (event) => {
    clearCreateError(page);
    onChange("name", event.target.value);
    updatePreviewText(page.querySelector("[data-create-preview-name]"), event.target.value, copy.t("create.previewName"));
    updateLetterAvatar(page, event.target.value);
  });

  page.querySelector('input[name="openingLine"]')?.addEventListener("input", (event) => {
    clearCreateError(page);
    onChange("openingLine", event.target.value);
    updatePreviewText(page.querySelector("[data-create-preview-opening]"), event.target.value, copy.t("create.previewOpening"));
  });

  const backstoryTextarea = page.querySelector('textarea[name="backstory"]');
  backstoryTextarea?.addEventListener("input", (event) => {
    clearCreateError(page);
    onChange("backstory", event.target.value);
    updateBackstoryCount(page, event.target);
  });

  page.querySelectorAll("[data-visibility-option]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      const nextValue = button.dataset.visibilityValue === "public";
      onChange("isPublic", nextValue);
      updateVisibilityOptions(page.querySelector(".vis-options"), nextValue);
    });
  });

  page.querySelector("[data-ai-polish]")?.addEventListener("click", async (event) => {
    event.preventDefault();
    if (guestMode) {
      showGuestCreateAuthPrompt(onNavigate, copy);
      return;
    }
    const textarea = backstoryTextarea;
    const payload = {
      name: createState.name,
      categoryId: selectedCat,
      category: cat?.label || "",
      personality: createState.vibe,
      voice: createState.voice,
      language: createState.language,
      languageCode: createState.languageCode,
      openingLine: createState.openingLine,
      backstory: textarea?.value || createState.backstory,
    };
    if (typeof onPolish === "function") {
      const polished = await onPolish(payload);
      if (polished && textarea) {
        textarea.value = polished;
        updateBackstoryCount(page, textarea);
      }
    }
  });

  page.querySelector("[data-start-chat]")?.addEventListener("click", async (event) => {
    event.preventDefault();
    if (guestMode) {
      showGuestCreateAuthPrompt(onNavigate, copy);
      return;
    }
    if (createState.avatarUploading || createState.avatarGenerating) {
      showToast(copy.t("create.avatarBusy"));
      return;
    }
    const payload = {
      name: createState.name,
      categoryId: selectedCat,
      vibe: createState.vibe,
      voice: createState.voice,
      language: createState.language,
      languageCode: createState.languageCode,
      openingLine: createState.openingLine,
      backstory: createState.backstory,
      avatarUrl: createState.avatarUrl,
      visibility: createState.isPublic === false ? "private" : "public",
    };
    if (typeof onSubmit === "function") {
      await onSubmit(payload);
    }
  });

  fragment.append(page);
  return fragment;
}

function avatarGenerationCopy(copy) {
  return {
    close: copy.t("common.close"),
    title: copy.t("create.avatarAiTitle"),
    scanning: copy.t("create.avatarScanning"),
    detected: copy.t("create.avatarDetected"),
    missing: copy.t("create.avatarMissing"),
    promptLabel: copy.t("create.avatarPromptLabel"),
    promptPlaceholder: copy.t("create.avatarPromptPlaceholder"),
    manualPrompt: copy.t("create.avatarManualPrompt"),
    useBackstory: copy.t("create.avatarUseStory"),
    usePrompt: copy.t("create.avatarGenerate"),
    generate: copy.t("create.avatarGenerate"),
    loading: copy.t("create.avatarGeneratingText"),
    estimate: copy.t("create.avatarEstimate"),
    ready: copy.t("create.avatarReady"),
    retryGenerated: copy.t("create.avatarRegenerate"),
    error: copy.t("create.failed"),
    pageLanguage: copy.language.code,
  };
}

function showGuestCreateAuthPrompt(onNavigate, copy = createSiteCopy("English")) {
  showDialog({
    type: "info",
    title: copy.t("create.authTitle"),
    message: copy.t("create.authBody"),
    confirmText: copy.t("common.createAccount"),
    cancelText: copy.t("common.notNow"),
    onConfirm: () => onNavigate?.("register"),
  });
}

function updateLetterAvatar(page, name) {
  const avatar = page.querySelector("[data-create-avatar]");
  const previewAvatar = page.querySelector(".cp-avatar");
  const hasImagePlaceholder = avatar?.querySelector(".avatar-image-placeholder");
  const hasLetterAvatar = avatar?.querySelector(".letter-avatar");
  if (!hasImagePlaceholder && !hasLetterAvatar) return;
  const html = characterAvatarHtml({
    name: name || "AIOVE",
    className: "cf-avatar-visual",
    placeholder: hasImagePlaceholder ? "image" : "",
  });
  avatar.innerHTML = html;
  if (previewAvatar) previewAvatar.innerHTML = html;
}

function clearCreateError(page) {
  page.querySelector(".cf-error")?.remove();
}

function updateBackstoryCount(page, textarea) {
  const counter = page.querySelector("[data-backstory-count]");
  if (!counter || !textarea) return;
  const maxLength = Number(textarea.maxLength || 4000);
  counter.textContent = `${textarea.value.length} / ${maxLength}`;
}
