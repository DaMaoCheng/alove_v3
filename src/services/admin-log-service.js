import { API_ENDPOINTS } from "../config/api-config.js";
import { requestJson } from "./http-client.js";

export function listAdminErrorLogs({
  level = "all",
  page = 1,
  source = "all",
  startDate = "",
  endDate = "",
} = {}) {
  const params = new URLSearchParams();
  params.set("level", level);
  params.set("limit", "20");
  params.set("page", String(page));
  params.set("source", source);
  if (startDate) params.set("startDate", startDate);
  if (endDate) params.set("endDate", endDate);
  return requestJson(`${API_ENDPOINTS.admin.errorLogs}?${params.toString()}`);
}
