import { ICONS } from "../../icons/icons.js";
import { createSiteCopy } from "../../i18n/site-copy.js";

let activeConfirm = null;
let activeCancel = null;

const DIALOG_ICONS = Object.freeze({
  error: ICONS.close,
  warning: ICONS.spark,
  info: ICONS.bell,
  success: ICONS.check || ICONS.spark,
});

export function showDialog({
  type = "info",
  title = "",
  message = "",
  confirmText = "OK",
  cancelText = "",
  onConfirm = null,
  onCancel = null,
} = {}) {
  const copy = createSiteCopy(globalThis.document?.documentElement?.lang || "English");
  closeDialog();
  activeConfirm = typeof onConfirm === "function" ? onConfirm : null;
  activeCancel = typeof onCancel === "function" ? onCancel : null;

  const host = document.createElement("div");
  host.id = "dialogHost";
  host.className = "dialog-host";
  host.innerHTML = `
    <div class="dialog-scrim" data-dialog-close></div>
    <div class="dlg dlg-${normalizeType(type)}" role="alertdialog" aria-modal="true">
      <button class="dlg-x" type="button" aria-label="${copy.t("common.close")}" data-dialog-close>${ICONS.close}</button>
      <div class="dlg-icon">${DIALOG_ICONS[normalizeType(type)] || DIALOG_ICONS.info}</div>
      <div class="dlg-body">
        <h3>${escapeHtml(title || copy.t("common.notice"))}</h3>
        <p>${escapeHtml(message || "")}</p>
      </div>
      <div class="dlg-actions">
        ${cancelText ? `<button class="btn btn-ghost" type="button" data-dialog-cancel>${escapeHtml(cancelText)}</button>` : ""}
        <button class="btn btn-primary" type="button" data-dialog-confirm>${escapeHtml(confirmText || copy.t("common.ok"))}</button>
      </div>
    </div>
  `;

  document.body.append(host);
  document.body.classList.add("dialog-open");
  host.querySelectorAll("[data-dialog-close]").forEach((item) => item.addEventListener("click", closeDialog));
  host.querySelector("[data-dialog-cancel]")?.addEventListener("click", () => {
    const callback = activeCancel;
    closeDialog();
    callback?.();
  });
  host.querySelector("[data-dialog-confirm]")?.addEventListener("click", () => {
    const callback = activeConfirm;
    closeDialog();
    callback?.();
  });
}

export function closeDialog() {
  document.body.classList.remove("dialog-open");
  document.getElementById("dialogHost")?.remove();
  activeConfirm = null;
  activeCancel = null;
}

export function bindDialogEscClose() {
  if (window.__aioveDialogEscBound) return;
  window.__aioveDialogEscBound = true;
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && document.body.classList.contains("dialog-open")) {
      closeDialog();
    }
  });
}

function normalizeType(type) {
  const normalized = String(type || "").trim().toLowerCase();
  return ["error", "warning", "info", "success"].includes(normalized) ? normalized : "info";
}

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
