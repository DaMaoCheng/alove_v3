import { API_ENDPOINTS } from "../config/api-config.js";
import { requestJson } from "./http-client.js";

export function resolveSiteForVisitor() {
  return requestJson(API_ENDPOINTS.site.resolve).then((result) => ({
    ...result,
    siteSlug: String(result.siteSlug || "").trim(),
  }));
}
