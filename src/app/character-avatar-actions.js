import { trackEvent } from "../analytics/track.js";
import { generateCharacterAvatar } from "../features/create-character/character-avatar-generator.js";
import { showToast } from "../features/shared-ui/toast.js";
import { deleteTemporaryAvatar, uploadAvatar } from "../services/upload-service.js";
import { createSiteCopy } from "../i18n/site-copy.js";

export function createCharacterAvatarActions({ appState, mountApp } = {}) {
  const copy = () => createSiteCopy(appState?.site?.pageLanguage);
  async function handleGenerateCreateAvatar(payload = {}) {
    if (appState.create.avatarGenerating || appState.create.avatarUploading) return null;

    appState.create.avatarGenerating = true;
    appState.create.avatarError = "";
    appState.create.error = "";
    mountApp();

    try {
      const generated = await generateCharacterAvatar(payload);
      const avatarUrl = String(generated?.avatarUrl || "").trim();
      if (!avatarUrl) {
        throw new Error("AI avatar generation failed. Please try again.");
      }

      appState.create.dirty = true;
      trackEvent("character_avatar_generated", {
        has_name: Boolean(payload.name),
        has_backstory: Boolean(payload.backstory),
        language: payload.language || "",
      });
      showToast(copy().t("create.avatarGenerated"));
      return { avatarUrl };
    } catch (error) {
      appState.create.avatarError = copy().t("create.avatarGenericError");
      trackEvent("character_avatar_generate_failed", {
        reason: appState.create.avatarError,
        raw_reason: error.message,
        status: error.status || 0,
      });
      throw error;
    } finally {
      appState.create.avatarGenerating = false;
      mountApp();
    }
  }

  async function handleCreateAvatarSelected(avatarFile) {
    if (!avatarFile?.blob) return;

    await cleanupTemporaryAvatar(appState.create.avatarUrl);
    appState.create.avatarPreviewUrl = avatarFile.previewUrl || "";
    appState.create.avatarUploading = true;
    appState.create.avatarError = "";
    appState.create.error = "";
    mountApp();

    try {
      const result = await uploadAvatar({
        blob: avatarFile.blob,
        filename: avatarFile.fileName || "avatar.webp",
      });
      if (!result.avatarUrl) {
        throw new Error("Avatar upload failed. Please try again.");
      }
      appState.create.avatarUrl = result.avatarUrl;
      appState.create.avatarPreviewUrl = "";
      appState.create.dirty = true;
      trackEvent("character_avatar_uploaded", {
        bytes: result.bytes || 0,
        content_type: result.contentType || "",
      });
    } catch (error) {
      appState.create.avatarUrl = "";
      appState.create.avatarError = copy().t("create.avatarGenericError");
      trackEvent("character_avatar_upload_failed", {
        reason: appState.create.avatarError,
        raw_reason: error.message,
        status: error.status || 0,
      });
    } finally {
      appState.create.avatarUploading = false;
      mountApp();
    }
  }

  async function handleCreateAvatarRemove(avatarUrl = "") {
    const targetUrl = String(avatarUrl || "").trim();
    if (targetUrl && targetUrl !== appState.create.avatarUrl) {
      await cleanupTemporaryAvatar(targetUrl);
      return;
    }
    await cleanupTemporaryAvatar(appState.create.avatarUrl);
    appState.create.avatarUrl = "";
    appState.create.avatarPreviewUrl = "";
    appState.create.avatarUploading = false;
    appState.create.avatarGenerating = false;
    appState.create.avatarError = "";
    mountApp();
  }

  async function cleanupTemporaryAvatar(avatarUrl) {
    try {
      await deleteTemporaryAvatar(avatarUrl);
    } catch (error) {
      trackEvent("temporary_avatar_cleanup_failed", {
        reason: error.message || "cleanup failed",
      });
    }
  }

  async function cleanupCreateDraft() {
    await cleanupTemporaryAvatar(appState.create.avatarUrl);
    if (appState.create.avatarPreviewUrl) {
      URL.revokeObjectURL?.(appState.create.avatarPreviewUrl);
    }
    resetCreateDraftState();
  }

  function resetCreateDraftState() {
    Object.assign(appState.create, {
      cat: "",
      vibe: "",
      voice: "",
      language: "",
      name: "",
      openingLine: "",
      backstory: "",
      avatarUrl: "",
      avatarPreviewUrl: "",
      avatarUploading: false,
      avatarGenerating: false,
      dirty: false,
      isPublic: false,
      avatarError: "",
      submitting: false,
      polishing: false,
      error: "",
      polishError: "",
    });
  }

  return {
    cleanupCreateDraft,
    cleanupTemporaryAvatar,
    handleCreateAvatarRemove,
    handleCreateAvatarSelected,
    handleGenerateCreateAvatar,
    resetCreateDraftState,
  };
}
