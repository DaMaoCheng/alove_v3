import { requireAuth } from "./auth-service.js";
import { getCreatorAnalytics, isValidCreatorAnalyticsRange } from "./creator-analytics-service.js";
import { readAuthToken, sendJson } from "./http-utils.js";
import { createPublicError } from "./public-error-utils.js";

export async function handleCreatorRoute(req, res, { path, requestUrl }) {
  if (req.method !== "GET" || path !== "/api/creator/analytics") return false;

  const user = await requireAuth(req, readAuthToken);
  if (String(user.account_type || "").toLowerCase() !== "creator") {
    throw createPublicError("Creator account required.", 403, "CREATOR_ACCOUNT_REQUIRED");
  }
  const requestedRange = requestUrl.searchParams.get("range");
  if (requestedRange && !isValidCreatorAnalyticsRange(requestedRange)) {
    throw createPublicError("Invalid analytics range.", 400, "INVALID_ANALYTICS_RANGE");
  }
  sendJson(res, 200, await getCreatorAnalytics(user, {
    range: requestedRange || "30d",
  }));
  return true;
}
