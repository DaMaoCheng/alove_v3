import { API_ENDPOINTS } from "../config/api-config.js";
import { requestJson } from "./http-client.js";

export function listAdminFeedback({ page = 1, limit = 20, status = "all", query = "", site = "all" } = {}) {
  const params = new URLSearchParams({
    page: String(page || 1),
    limit: String(limit || 20),
    status: String(status || "all"),
  });
  const safeQuery = String(query || "").trim();
  const safeSite = String(site || "all").trim();
  if (safeQuery) params.set("query", safeQuery);
  if (safeSite && safeSite !== "all") params.set("site", safeSite);
  return requestJson(`${API_ENDPOINTS.admin.feedback}?${params.toString()}`).then((result) => ({
    ...result,
    items: Array.isArray(result.items) ? result.items : [],
  }));
}

export async function getAdminNewFeedbackCount() {
  const result = await listAdminFeedback({ page: 1, limit: 1, status: "new" });
  return Math.max(0, Number(result.total || 0));
}

export function markAdminFeedbackDone(feedbackId) {
  return requestJson(`${API_ENDPOINTS.admin.feedback}/${encodeURIComponent(String(feedbackId || "").trim())}/status`, {
    method: "PATCH",
    body: { status: "done" },
  }).then((result) => ({
    ...result,
    item: result.item || null,
  }));
}
