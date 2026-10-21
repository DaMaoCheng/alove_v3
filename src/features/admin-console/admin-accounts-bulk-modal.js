import { bindDropdowns, selectDropdownHtml } from "../shared-ui/dropdown.js";

export function openBulkSelectModal({ title, fieldLabel, fieldName, value, items, note, confirmText, onSubmit, escapeHtml }) {
  closeBulkSelectModal();
  const host = document.createElement("div");
  host.id = "accountBulkSelectHost";
  host.className = "dialog-host account-form-host";
  host.innerHTML = `
    <div class="dialog-scrim" data-account-bulk-close></div>
    <div class="dlg account-form-modal" role="dialog" aria-modal="true">
      <button class="dlg-x" type="button" aria-label="Close" data-account-bulk-close>×</button>
      <div class="dlg-body"><h3>${escapeHtml(title)}</h3><p>${escapeHtml(note || "")}</p></div>
      <form class="account-form agent-form" data-account-bulk-form>
        <label class="agent-field"><span>${escapeHtml(fieldLabel)}</span>${selectDropdownHtml({ name: fieldName, value, items, className: "agent-dd" })}</label>
        <div class="dlg-actions"><button class="btn btn-ghost" type="button" data-account-bulk-close>取消</button><button class="btn btn-primary" type="submit">${escapeHtml(confirmText)}</button></div>
      </form>
    </div>
  `;
  document.body.append(host);
  document.body.classList.add("dialog-open");
  host.querySelectorAll("[data-account-bulk-close]").forEach((item) => item.addEventListener("click", closeBulkSelectModal));
  host.querySelector("form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    closeBulkSelectModal();
    onSubmit?.(Object.fromEntries(data.entries()));
  });
  bindDropdowns(host);
}

export function closeBulkSelectModal() {
  document.body.classList.remove("dialog-open");
  document.getElementById("accountBulkSelectHost")?.remove();
}
