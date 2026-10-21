import { API_ENDPOINTS } from "../config/api-config.js";
import { requestJson } from "./http-client.js";

export function submitFeedback({ subject = "", content = "", contactEmail = "", pagePath = "" } = {}) {
  return requestJson(API_ENDPOINTS.feedback, {
    method: "POST",
    body: {
      subject,
      content,
      contactEmail,
      pagePath,
    },
  });
}
