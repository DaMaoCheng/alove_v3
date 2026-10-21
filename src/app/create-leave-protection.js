import { getInitialAgentFromPath, getInitialViewFromPath } from "./access-control.js";
import { pushViewPath } from "./app-navigation.js";
import { closeCropper } from "../features/avatar-cropper/avatar-cropper.js";
import { closeAvatarGenerationModal } from "../features/create-character/create-avatar-generation-modal.js";
import { showDialog } from "../features/shared-ui/dialog.js";
import { createSiteCopy } from "../i18n/site-copy.js";

export function createCreateLeaveProtection({
  appState,
  getCurrentView,
  navigationActions,
  characterActions,
}) {
  function guardedNavigateApp(view, agent) {
    const copy = createSiteCopy(appState?.site?.pageLanguage);
    closeAvatarGenerationModal();
    if (!shouldGuardCreateLeave()) {
      navigationActions.navigateApp(view, agent);
      return;
    }

    showDialog({
      type: "warning",
      title: copy.t("create.leaveTitle"),
      message: copy.t("create.leaveMessage"),
      confirmText: copy.t("create.leave"),
      cancelText: copy.t("create.stay"),
      onConfirm: async () => {
        await characterActions.cleanupCreateDraft();
        closeCropper();
        navigationActions.navigateApp(view, agent);
      },
    });
  }

  function guardedHandlePopState() {
    const copy = createSiteCopy(appState?.site?.pageLanguage);
    closeAvatarGenerationModal();
    if (!shouldGuardCreateLeave()) {
      navigationActions.handlePopState();
      return;
    }

    const targetView = getInitialViewFromPath();
    const targetAgent = getInitialAgentFromPath();
    pushViewPath(appState, getCurrentView(), true);
    showDialog({
      type: "warning",
      title: copy.t("create.leaveTitle"),
      message: copy.t("create.leaveMessage"),
      confirmText: copy.t("create.leave"),
      cancelText: copy.t("create.stay"),
      onConfirm: async () => {
        await characterActions.cleanupCreateDraft();
        closeCropper();
        navigationActions.navigateApp(targetView, targetAgent);
      },
    });
  }

  function shouldGuardCreateLeave() {
    return getCurrentView() === "create"
      && (appState.create.dirty || appState.create.avatarGenerating || appState.create.avatarUploading || appState.create.avatarCropping);
  }

  function bindCreateLeaveProtection() {
    window.addEventListener("beforeunload", (event) => {
      if (!shouldGuardCreateLeave()) return;
      event.preventDefault();
      event.returnValue = "";
    });
    window.addEventListener("pagehide", () => {
      if (shouldGuardCreateLeave()) cleanupCreateDraftOnUnload();
    });
  }

  function cleanupCreateDraftOnUnload() {
    const avatarUrl = String(appState.create.avatarUrl || "").trim();
    if (!avatarUrl) return;
    try {
      fetch("/api/uploads/avatar", {
        method: "DELETE",
        credentials: "include",
        keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avatarUrl }),
      });
    } catch {}
  }

  return {
    bindCreateLeaveProtection,
    guardedHandlePopState,
    guardedNavigateApp,
  };
}
