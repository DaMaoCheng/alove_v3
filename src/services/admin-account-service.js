import { API_ENDPOINTS } from "../config/api-config.js";
import { requestJson } from "./http-client.js";

export function listAdminAccounts({ page = 1, limit = 10, query = "", type = "all", site = "all", dateRange = "all", startDate = "", endDate = "" } = {}) {
  const params = new URLSearchParams({
    page: String(page || 1),
    limit: String(limit || 10),
    type: String(type || "all"),
    dateRange: String(dateRange || "all"),
  });
  if (String(query || "").trim()) params.set("query", String(query || "").trim());
  if (String(site || "all") !== "all") params.set("site", String(site || "all"));
  if (String(startDate || "").trim()) params.set("startDate", String(startDate || "").trim());
  if (String(endDate || "").trim()) params.set("endDate", String(endDate || "").trim());
  return requestJson(`${API_ENDPOINTS.admin.accounts}?${params.toString()}`).then((result) => ({ 
    ...result,
    items: Array.isArray(result.items) ? result.items : [],
    summary: result.summary || {},
  }));
}

export function listAdminGuestSessions({ page = 1, limit = 10, query = "", status = "all", site = "all", dateRange = "all", startDate = "", endDate = "" } = {}) {
  const params = new URLSearchParams({
    page: String(page || 1),
    limit: String(limit || 10),
    status: String(status || "all"),
    dateRange: String(dateRange || "all"),
  });
  if (String(query || "").trim()) params.set("query", String(query || "").trim());
  if (String(site || "all") !== "all") params.set("site", String(site || "all"));
  if (String(startDate || "").trim()) params.set("startDate", String(startDate || "").trim());
  if (String(endDate || "").trim()) params.set("endDate", String(endDate || "").trim());
  return requestJson(`${API_ENDPOINTS.admin.accounts}/guests?${params.toString()}`).then((result) => ({
    ...result,
    items: Array.isArray(result.items) ? result.items : [],
    summary: result.summary || {},
  }));
}

export function getAdminGuestConversation(guestSessionId) {
  return requestJson(`${API_ENDPOINTS.admin.accounts}/guests/${encodeURIComponent(String(guestSessionId || "").trim())}/conversation`).then((result) => ({
    ...result,
    item: result.item || null,
  }));
}

export function listAdminGuestConversations(guestSessionId, { query = "" } = {}) {
  const params = new URLSearchParams();
  if (query) params.set("query", query);
  const suffix = params.size ? `?${params.toString()}` : "";
  return requestJson(`/api/admin/accounts/guests/${encodeURIComponent(String(guestSessionId || "").trim())}/conversations${suffix}`);
}

export function getAdminGuestConversationDetail(guestSessionId, conversationId) {
  return requestJson(`/api/admin/accounts/guests/${encodeURIComponent(String(guestSessionId || "").trim())}/conversations/${encodeURIComponent(String(conversationId || "").trim())}`);
}

export function listAdminAccountConversations(accountId, { query = "" } = {}) {
  const params = new URLSearchParams();
  if (String(query || "").trim()) params.set("query", String(query || "").trim());
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return requestJson(`${API_ENDPOINTS.admin.accounts}/${encodeURIComponent(String(accountId || "").trim())}/conversations${suffix}`).then((result) => ({
    ...result,
    items: Array.isArray(result.items) ? result.items : [],
  }));
}

export function getAdminAccountConversation(accountId, conversationId) {
  return requestJson(`${API_ENDPOINTS.admin.accounts}/${encodeURIComponent(String(accountId || "").trim())}/conversations/${encodeURIComponent(String(conversationId || "").trim())}`).then((result) => ({
    ...result,
    item: result.item || null,
  }));
}

export function updateAdminAccountStatus(accountId, status) {
  return requestJson(`${API_ENDPOINTS.admin.accounts}/${encodeURIComponent(String(accountId || "").trim())}/status`, {
    method: "PATCH",
    body: { status },
  }).then((result) => ({
    ...result,
    item: result.item || null,
  }));
}

export function createAdminAccount(payload) {
  return requestJson(API_ENDPOINTS.admin.accounts, {
    method: "POST",
    body: payload,
  }).then((result) => ({
    ...result,
    item: result.item || null,
  }));
}

export function updateAdminAccountProfile(accountId, payload) {
  return requestJson(`${API_ENDPOINTS.admin.accounts}/${encodeURIComponent(String(accountId || "").trim())}/profile`, {
    method: "PATCH",
    body: payload,
  }).then((result) => ({
    ...result,
    item: result.item || null,
  }));
}

export function resetAdminAccountPassword(accountId, payload) {
  return requestJson(`${API_ENDPOINTS.admin.accounts}/${encodeURIComponent(String(accountId || "").trim())}/password`, {
    method: "PATCH",
    body: payload,
  });
}

export function updateAdminAccountSite(accountIds = [], siteId = "") {
  return requestJson(`${API_ENDPOINTS.admin.accounts}/site`, {
    method: "PATCH",
    body: { accountIds, siteId },
  }).then((result) => ({
    ...result,
    items: Array.isArray(result.items) ? result.items : [],
  }));
}
