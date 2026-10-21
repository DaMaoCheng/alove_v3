import { showDialog } from "../../features/shared-ui/dialog.js";

export function bindAuthLeaveProtection(root, {
  onNavigate,
  title = "Leave this page?",
  message = "Unsaved data will be lost. Do you want to leave this page?",
  confirmText = "Leave",
  cancelText = "Stay",
} = {}) {
  const form = root?.querySelector?.("form");
  if (!(form instanceof HTMLFormElement)) {
    return { navigate: onNavigate, markSubmitted: () => {} };
  }

  let submitted = false;
  const isDirty = () => !submitted && Array.from(form.elements).some((element) => {
    if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement)) return false;
    if (element.type === "checkbox" || element.type === "radio") return element.checked !== element.defaultChecked;
    return String(element.value || "") !== String(element.defaultValue || "");
  });

  const beforeUnload = (event) => {
    if (!form.isConnected) {
      window.removeEventListener("beforeunload", beforeUnload);
      return;
    }
    if (!isDirty()) return;
    event.preventDefault();
    event.returnValue = "";
  };
  window.addEventListener("beforeunload", beforeUnload);

  root.addEventListener("auth:destroy", () => {
    window.removeEventListener("beforeunload", beforeUnload);
  }, { once: true });

  return {
    markSubmitted: () => {
      submitted = true;
    },
    navigate: (view) => {
      if (!isDirty()) {
        onNavigate?.(view);
        return;
      }

      showDialog({
        type: "warning",
        title,
        message,
        confirmText,
        cancelText,
        onConfirm: () => onNavigate?.(view),
      });
    },
  };
}
