export function accountManagementSwitchHtml(activeView = "accounts", { accountCount = 0, guestCount = 0, guestSessionsWithUserMessages = 0 } = {}) {
  return `
    <div class="account-view-switch" role="tablist" aria-label="账号管理数据范围">
      ${viewButtonHtml({
        value: "accounts",
        activeView,
        label: "正式账号",
        description: "普通用户、创作者和运营账号",
        count: accountCount,
      })}
      ${viewButtonHtml({
        value: "guests",
        activeView,
        label: "游客会话",
        description: "未注册浏览器身份及其聊天状态",
        count: guestCount,
        secondaryCount: guestSessionsWithUserMessages,
        countVariant: "guest",
      })}
    </div>
  `;
}

function viewButtonHtml({ value, activeView, label, description, count, secondaryCount = 0, countVariant = "default" }) {
  const active = activeView === value;
  const countHtml = countVariant === "guest"
    ? `<span class="account-view-count account-view-guest-count" aria-label="${formatNumber(secondaryCount)} 个游客已发送消息，共 ${formatNumber(count)} 个游客会话"><strong data-account-guest-conversation-count>${formatNumber(secondaryCount)}</strong><small data-account-guest-total-count>/${formatNumber(count)}</small></span>`
    : `<span class="account-view-count">${formatNumber(count)}</span>`;
  return `
    <button class="account-view-tab ${active ? "active" : ""}" type="button" role="tab" aria-selected="${active}" data-account-management-view="${value}">
      <span class="account-view-copy"><b>${label}</b><small>${description}</small></span>
      ${countHtml}
    </button>
  `;
}

function formatNumber(value) {
  const numeric = Number(value || 0);
  return Number.isFinite(numeric) ? numeric.toLocaleString("zh-CN") : "0";
}
