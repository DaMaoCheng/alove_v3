import { createAdminAccount, listAdminAccounts, resetAdminAccountPassword, updateAdminAccountProfile } from "../../services/admin-account-service.js";
import { bindDropdowns, selectDropdownHtml } from "../shared-ui/dropdown.js";
import { showToast } from "../shared-ui/toast.js";

export function openAccountFormModal({ mode, account = null, state, renderAccounts, updateAccount, onAccountUpdated }) {
  closeAccountFormModal();
  const host = document.createElement("div");
  host.id = "accountFormHost";
  host.className = "dialog-host account-form-host";
  host.innerHTML = accountFormModalHtml({ mode, account });
  document.body.append(host);
  document.body.classList.add("dialog-open");
  host.querySelectorAll("[data-account-form-close]").forEach((item) => item.addEventListener("click", closeAccountFormModal));
  host.querySelector("form")?.addEventListener("submit", (event) => submitAccountForm(event, { mode, account, state, renderAccounts, updateAccount, onAccountUpdated }));
  bindDropdowns(host);
  host.querySelector("input:not([readonly]), [data-dd-trigger]")?.focus();
}

function closeAccountFormModal() {
  document.body.classList.remove("dialog-open");
  document.getElementById("accountFormHost")?.remove();
}

async function submitAccountForm(event, { mode, account, state, renderAccounts, updateAccount, onAccountUpdated }) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("[data-account-form-submit]");
  const errorBox = form.querySelector("[data-account-form-error]");
  setAccountFormBusy(button, errorBox, true, "");
  try {
    const data = new FormData(form);
    let result = null;
    if (mode === "create") {
      result = await createAdminAccount({
        email: data.get("email"),
        nickname: data.get("nickname"),
        accountType: data.get("accountType"),
        password: data.get("password"),
        confirmPassword: data.get("confirmPassword"),
      });
      state.page = 1;
      state.openId = result.item?.id || "";
      closeAccountFormModal();
      showToast("账号已新增");
      await reloadAccountsAfterWrite({ state, renderAccounts });
      return;
    }
    if (mode === "edit" && account) {
      result = await updateAdminAccountProfile(account.id, {
        nickname: data.get("nickname"),
        accountType: data.get("accountType"),
      });
      updateAccount(result.item);
      onAccountUpdated?.(result.item);
      closeAccountFormModal();
      showToast("资料已保存");
      renderAccounts?.({ keepScroll: true });
      return;
    }
    if (mode === "password" && account) {
      await resetAdminAccountPassword(account.id, {
        password: data.get("password"),
        confirmPassword: data.get("confirmPassword"),
      });
      closeAccountFormModal();
      showToast("密码已重置");
    }
  } catch (error) {
    setAccountFormBusy(button, errorBox, false, error.message || "操作失败，请稍后再试");
  }
}

async function reloadAccountsAfterWrite({ state, renderAccounts }) {
  state.loading = true;
  renderAccounts?.({ keepScroll: true });
  const result = await listAdminAccounts(state);
  Object.assign(state, {
    items: result.items || [],
    summary: result.summary || {},
    total: result.total || 0,
    pages: result.pages || 1,
    loading: false,
    error: "",
  });
  renderAccounts?.({ keepScroll: true });
}

function setAccountFormBusy(button, errorBox, busy, message) {
  if (button) button.disabled = busy;
  if (errorBox) {
    errorBox.textContent = message || "";
    errorBox.hidden = !message;
  }
}

function accountFormModalHtml({ mode, account }) {
  const isCreate = mode === "create";
  const isEdit = mode === "edit";
  const title = isCreate ? "新增账号" : isEdit ? "编辑资料" : "重置密码";
  const submitText = isCreate ? "创建账号" : isEdit ? "保存资料" : "重置密码";
  return `
    <div class="dialog-scrim" data-account-form-close></div>
    <div class="dlg account-form-modal" role="dialog" aria-modal="true">
      <button class="dlg-x" type="button" aria-label="Close" data-account-form-close>×</button>
      <div class="dlg-body"><h3>${escapeHtml(title)}</h3></div>
      <form class="account-form agent-form">
        ${isCreate ? accountInputField("邮箱", "email", "email", "", "请输入邮箱") : accountReadonlyField("邮箱", account?.email || "")}
        ${isCreate || isEdit ? accountInputField("昵称", "nickname", "text", account?.username || "", "请输入昵称") : ""}
        ${isCreate || isEdit ? accountTypeField(account?.accountType || "personal") : ""}
        ${isCreate || mode === "password" ? accountInputField("密码", "password", "password", "", "至少8位，包含字母和数字") : ""}
        ${isCreate || mode === "password" ? accountInputField("确认密码", "confirmPassword", "password", "", "再次输入密码") : ""}
        <div class="account-form-error" data-account-form-error hidden></div>
        <div class="dlg-actions"><button class="btn btn-ghost" type="button" data-account-form-close>取消</button><button class="btn btn-primary" type="submit" data-account-form-submit>${escapeHtml(submitText)}</button></div>
      </form>
    </div>
  `;
}

function accountInputField(label, name, type, value, placeholder) {
  return `<label class="agent-field"><span>${escapeHtml(label)}</span><input name="${escapeAttr(name)}" type="${escapeAttr(type)}" value="${escapeAttr(value)}" placeholder="${escapeAttr(placeholder)}" /></label>`;
}

function accountReadonlyField(label, value) {
  return `<label class="agent-field"><span>${escapeHtml(label)}</span><input value="${escapeAttr(value)}" readonly /></label>`;
}

function accountTypeField(value) {
  return `<label class="agent-field"><span>身份</span>${selectDropdownHtml({
    name: "accountType",
    value,
    className: "agent-dd",
    items: [
      ["personal", "普通用户"],
      ["creator", "创作者"],
      ["admin", "运营"],
    ],
  })}</label>`;
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[char]);
}

function escapeAttr(value = "") {
  return escapeHtml(value);
}
