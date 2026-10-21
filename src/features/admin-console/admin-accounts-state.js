export const accountPageState = {
  managementView: "accounts",
  page: 1,
  limit: 10,
  openId: "",
  query: "",
  type: "all",
  site: "all",
  dateRange: "all",
  startDate: "",
  endDate: "",
  datePickerOpen: false,
  selectedIds: new Set(),
  items: [],
  sites: [],
  siteCounts: [],
  summary: {},
  guestTotal: 0,
  guestSessionsWithUserMessages: 0,
  total: 0,
  pages: 1,
  loading: true,
  error: "",
};

export function selectedAccounts(state = accountPageState) {
  return state.items.filter((account) => state.selectedIds.has(account.id));
}

export function visibleAccounts(state = accountPageState) {
  return Array.isArray(state.items) ? state.items : [];
}

export function pruneSelectionToCurrentItems(state = accountPageState) {
  const ids = new Set(state.items.map((account) => account.id));
  state.selectedIds.forEach((id) => {
    if (!ids.has(id)) state.selectedIds.delete(id);
  });
}

export function updateAccountInState(account, state = accountPageState) {
  if (!account) return;
  state.items = state.items.map((item) => item.id === account.id ? account : item);
}

export function resetAccountListView(state = accountPageState) {
  state.page = 1;
  state.openId = "";
  state.selectedIds.clear();
}
