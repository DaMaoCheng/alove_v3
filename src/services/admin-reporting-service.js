import { requestJson } from "./http-client.js";

const BASE = "/api/admin/reporting-tokens";
export const listReportingTokens = () => requestJson(BASE);
export const createReportingToken = (body) => requestJson(BASE, { method: "POST", body });
export const revokeReportingToken = (id) => requestJson(`${BASE}/${encodeURIComponent(id)}/revoke`, { method: "POST" });
