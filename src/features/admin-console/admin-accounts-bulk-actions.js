import { listAdminAccounts, updateAdminAccountProfile, updateAdminAccountSite, updateAdminAccountStatus } from "../../services/admin-account-service.js";
import { showDialog } from "../shared-ui/dialog.js";
import { showToast } from "../shared-ui/toast.js";
import { accountWritableSiteItems } from "./admin-account-sites.js";
import { openBulkSelectModal } from "./admin-accounts-bulk-modal.js";
import { selectedAccounts, updateAccountInState } from "./admin-accounts-state.js";
import { updateOpenAccountConversationAccount } from "./admin-account-conversations.js";

export function createAdminAccountsBulkActions({ state, renderAccounts, reloadAccounts, escapeHtml }) {
  async function selectAllMatchingAccounts() {
    try {
      const result = await listAdminAccounts({
        ...state,
        page: 1,
        limit: Math.max(Number(state.total || 0), Number(state.limit || 10), 1000),
      });
      const matching = result.items || [];
      matching.forEach((account) => state.selectedIds.add(account.id));
      showToast(`已选择 ${matching.length} 个账号`);
      renderAccounts?.({ keepScroll: true });
    } catch (error) {
      showDialog({ type: "error", title: "选择失败", message: error.message || "账号选择失败，请稍后再试。", confirmText: "知道了" });
    }
  }

  function openBulkSiteDialog() {
    const accounts = selectedAccounts(state);
    if (!accounts.length) return;
    openBulkSelectModal({
      title: "批量修改站点",
      fieldLabel: "目标站点",
      fieldName: "siteId",
      value: accounts[0]?.siteId || "unassigned",
      items: accountWritableSiteItems(state.sites),
      note: `将修改 ${accounts.length} 个账号的所属站点。`,
      confirmText: "修改站点",
      onSubmit: ({ siteId }) => applyBulkSiteChange(accounts, siteId || "unassigned"),
      escapeHtml,
    });
  }

  function openBulkRoleDialog() {
    const accounts = selectedAccounts(state);
    if (!accounts.length) return;
    openBulkSelectModal({
      title: "批量修改身份",
      fieldLabel: "目标身份",
      fieldName: "accountType",
      value: "personal",
      items: [
        ["personal", "普通用户"],
        ["creator", "创作者"],
        ["admin", "运营"],
      ],
      note: `将修改 ${accounts.length} 个账号的身份。`,
      confirmText: "修改身份",
      onSubmit: ({ accountType }) => applyBulkRoleChange(accounts, accountType || "personal"),
      escapeHtml,
    });
  }

  function confirmBulkBan() {
    const accounts = selectedAccounts(state);
    if (!accounts.length) return;
    showDialog({
      type: "warning",
      title: "确认批量封禁账号",
      message: `封禁后，选中的 ${accounts.length} 个账号将无法继续登录和使用。`,
      confirmText: "确认封禁",
      cancelText: "取消",
      onConfirm: () => applyBulkStatusChange(accounts, "banned"),
    });
  }

  async function applyBulkRoleChange(accounts, role) {
    await applyBulkOperation(accounts, async (account) => updateAdminAccountProfile(account.id, { nickname: account.username || account.email, accountType: role }));
    showToast("已批量修改身份");
  }

  async function applyBulkSiteChange(accounts, siteId) {
    try {
      const result = await updateAdminAccountSite(accounts.map((account) => account.id), siteId);
      (result.items || []).forEach((item) => {
        updateAccountInState(item, state);
        updateOpenAccountConversationAccount(item);
      });
      state.selectedIds.clear();
      showToast(`已修改 ${Number(result.updatedCount || 0)} 个账号的所属站点`);
      await reloadAccounts?.({ keepScroll: true });
    } catch (error) {
      showDialog({ type: "error", title: "站点修改失败", message: error.message || "账号站点修改失败，请稍后再试。", confirmText: "知道了" });
    }
  }

  async function applyBulkStatusChange(accounts, status) {
    await applyBulkOperation(accounts, async (account) => updateAdminAccountStatus(account.id, status));
    showToast("已批量封禁账号");
  }

  async function applyBulkOperation(accounts, updater) {
    try {
      const results = await Promise.all(accounts.map((account) => updater(account).catch((error) => ({ error, account }))));
      const failures = results.filter((result) => result?.error);
      const updatedItems = results.map((result) => result?.item).filter(Boolean);
      updatedItems.forEach((item) => {
        updateAccountInState(item, state);
        updateOpenAccountConversationAccount(item);
      });
      state.selectedIds.clear();
      renderAccounts?.({ keepScroll: true });
      if (failures.length) {
        showDialog({
          type: "warning",
          title: "部分账号处理失败",
          message: `成功 ${updatedItems.length} 个，失败 ${failures.length} 个。`,
          confirmText: "知道了",
        });
      }
    } catch (error) {
      showDialog({
        type: "error",
        title: "批量操作失败",
        message: error.message || "批量操作失败，请稍后再试。",
        confirmText: "知道了",
      });
    }
  }

  return {
    selectAllMatchingAccounts,
    openBulkSiteDialog,
    openBulkRoleDialog,
    confirmBulkBan,
  };
}
