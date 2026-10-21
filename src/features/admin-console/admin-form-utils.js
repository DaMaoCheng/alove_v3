export function setSavingState(button, tip, isSaving, message) {
  if (button) {
    button.disabled = isSaving;
    button.textContent = isSaving ? "保存中..." : "保存设置";
  }
  if (tip) tip.textContent = message;
}
