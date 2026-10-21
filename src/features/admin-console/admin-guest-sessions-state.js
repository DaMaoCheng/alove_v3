export const guestSessionPageState = {
  page: 1,
  limit: 10,
  openId: "",
  query: "",
  status: "all",
  site: "all",
  dateRange: "all",
  startDate: "",
  endDate: "",
  datePickerOpen: false,
  items: [],
  sites: [],
  siteCounts: [],
  summary: {},
  accountTotal: 0,
  total: 0,
  pages: 1,
  loading: true,
  error: "",
};

export function resetGuestSessionListView(state = guestSessionPageState) {
  state.page = 1;
  state.openId = "";
}
