import { updateAdminAccountStatus } from "../../services/admin-account-service.js";
import { showDialog } from "../shared-ui/dialog.js";
import { showToast } from "../shared-ui/toast.js";
import { openAccountConversations, updateOpenAccountConversationAccount } from "./admin-account-conversations.js";
import { openAccountFormModal } from "./admin-account-form-modal.js";
import { resetAccountListView, updateAccountInState, visibleAccounts } from "./admin-accounts-state.js";
import { bindAdminDateRangeFilter } from "./admin-date-range-filter.js";

export function bindAdminAccountsListActions({ main, state, renderAccounts, loadAccounts, bulkActions }) {
  let accountSearchTimer = null;

  const openManagedAccountForm = ({ mode, account = null }) => {
    openAccountFormModal({
      mode,
      account,
      state,
      renderAccounts,
      updateAccount: (item) => updateAccountInState(item, state),
      onAccountUpdated: updateOpenAccountConversationAccount,
    });
  };

  main.querySelectorAll("[data-account-toggle]").forEach((row) => {
    row.addEventListener("click", (event) => {
      if (event.target?.closest?.("[data-account-select]")) return;
      const id = row.dataset.accountToggle || "";
      state.openId = state.openId === id ? "" : id;
      renderAccounts({ keepScroll: true });
    });
  });

  main.querySelectorAll("[data-account-open]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const account = state.items.find((item) => item.id === button.dataset.accountOpen);
      if (account) openAccountConversations(account);
    });
  });

  main.querySelectorAll("[data-account-status]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const account = state.items.find((item) => item.id === button.dataset.accountStatus);
      if (account) confirmAccountStatusChange(account, button.dataset.nextStatus || "");
    });
  });

  main.querySelector("[data-account-new]")?.addEventListener("click", () => openManagedAccountForm({ mode: "create" }));

  main.querySelectorAll("[data-account-edit]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const account = state.items.find((item) => item.id === button.dataset.accountEdit);
      if (account) openManagedAccountForm({ mode: "edit", account });
    });
  });

  main.querySelectorAll("[data-account-password]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const account = state.items.find((item) => item.id === button.dataset.accountPassword);
      if (account) openManagedAccountForm({ mode: "password", account });
    });
  });

  main.querySelectorAll("[data-account-page]").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.disabled) return;
      state.page = Number(button.dataset.accountPage || 1);
      state.openId = "";
      state.selectedIds.clear();
      loadAccounts();
    });
  });

  main.querySelectorAll("[data-account-type]").forEach((button) => {
    button.addEventListener("click", () => {
      state.type = button.dataset.accountType || "all";
      resetAccountListView(state);
      loadAccounts();
    });
  });

  main.querySelector('input[name="accountSite"]')?.addEventListener("change", (event) => {
    state.site = event.target.value || "all";
    resetAccountListView(state);
    loadAccounts();
  });

  bindAdminDateRangeFilter(main, {
    state,
    onPreset: () => {
      resetAccountListView(state);
      loadAccounts();
    },
    onOpenCustom: () => renderAccounts({ keepScroll: true }),
    onCancelCustom: () => renderAccounts({ keepScroll: true }),
    onApplyCustom: () => {
      resetAccountListView(state);
      loadAccounts();
    },
  });

  main.querySelectorAll("[data-account-select]").forEach((checkbox) => {
    checkbox.addEventListener("click", (event) => event.stopPropagation());
    checkbox.addEventListener("change", () => {
      const id = checkbox.dataset.accountSelect || "";
      if (!id) return;
      if (checkbox.checked) state.selectedIds.add(id);
      else state.selectedIds.delete(id);
      renderAccounts({ keepScroll: true });
    });
  });

  main.querySelector("[data-account-select-page]")?.addEventListener("click", () => {
    visibleAccounts(state).forEach((account) => state.selectedIds.add(account.id));
    renderAccounts({ keepScroll: true });
  });

  main.querySelector("[data-account-select-all]")?.addEventListener("click", () => bulkActions.selectAllMatchingAccounts());
  main.querySelector("[data-account-select-clear]")?.addEventListener("click", () => {
    state.selectedIds.clear();
    renderAccounts({ keepScroll: true });
  });
  main.querySelector("[data-account-bulk-site]")?.addEventListener("click", () => bulkActions.openBulkSiteDialog());
  main.querySelector("[data-account-bulk-role]")?.addEventListener("click", () => bulkActions.openBulkRoleDialog());
  main.querySelector("[data-account-bulk-ban]")?.addEventListener("click", () => bulkActions.confirmBulkBan());
  main.querySelector("[data-account-search]")?.addEventListener("input", (event) => {
    state.query = event.target.value || "";
    state.page = 1;
    state.openId = "";
    state.selectedIds.clear();
    clearTimeout(accountSearchTimer);
    accountSearchTimer = setTimeout(() => loadAccounts({ keepFocus: true }), 300);
  });

  function confirmAccountStatusChange(account, nextStatus) {
    const isBan = nextStatus === "banned";
    const title = isBan ? "确认封禁账号" : "确认解封账号";
    const message = isBan
      ? `封禁后，${account.email} 将无法继续登录和使用当前账号。`
      : `解封后，${account.email} 可以重新登录和使用账号。`;
    showDialog({
      type: isBan ? "warning" : "info",
      title,
      message,
      confirmText: isBan ? "确认封禁" : "确认解封",
      cancelText: "取消",
      onConfirm: () => applyAccountStatusChange(account, nextStatus),
    });
  }

  async function applyAccountStatusChange(account, nextStatus) {
    try {
      const result = await updateAdminAccountStatus(account.id, nextStatus);
      const updated = result.item;
      if (updated) {
        updateAccountInState(updated, state);
        updateOpenAccountConversationAccount(updated);
      }
      showToast(nextStatus === "banned" ? "账号已封禁" : "账号已解封");
      renderAccounts?.({ keepScroll: true });
    } catch (error) {
      showDialog({
        type: "error",
        title: "操作失败",
        message: error.message || "账号状态更新失败，请稍后再试。",
        confirmText: "知道了",
      });
    }
  }
}
