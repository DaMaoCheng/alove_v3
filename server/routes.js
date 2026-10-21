import { buildRequestLogContext, recordAppErrorLog } from "./app-error-log-service.js";
import { handleAdminRoute } from "./admin-routes.js";
import { handleReportingRoute } from "./reporting-routes.js";
import { handleAuthRoute } from "./auth-routes.js";
import { handleBillingRoute } from "./billing-routes.js";
import { handleCharacterRoute } from "./character-routes.js";
import { handleChatRoute } from "./chat-routes.js";
import { handleCreatorRoute } from "./creator-routes.js";
import { handleDemoProductRoute } from "./demo-product-routes.js";
import { handleFeedbackRoute } from "./feedback-routes.js";
import { handleGuestChatRoute } from "./guest-chat-routes.js";
import { handleHomeRoute } from "./home-routes.js";
import { handleKitshopRoute } from "./kitshop-routes.js";
import { handleProfileRoute } from "./profile-routes.js";
import { handleProductSearchRoute } from "./product-search-service.js";
import { handleProductCheckoutRoute } from "./product-checkout-routes.js";
import { handlePublicExternalEmbedRoute } from "./public-external-embed-routes.js";
import { handleTtmallCartRoute } from "./ttmall-cart-routes.js";
import { handleTtmallAccountBindingRoute } from "./ttmall-account-binding-routes.js";
import { handleTtmallCheckoutRoute } from "./ttmall-checkout-routes.js";
import { handleShopifyCartRoute } from "./shopify-cart-routes.js";
import { handleProtectedUploadRoute } from "./protected-upload-routes.js";
import { sendError, sendJson } from "./http-utils.js";

const routeHandlers = [
  handleReportingRoute,
  handleAuthRoute,
  handleAdminRoute,
  handleProtectedUploadRoute,
  handleProfileRoute,
  handleFeedbackRoute,
  handleGuestChatRoute,
  handleKitshopRoute,
  handleProductSearchRoute,
  handleTtmallAccountBindingRoute,
  handleTtmallCheckoutRoute,
  handleTtmallCartRoute,
  handleShopifyCartRoute,
  handleProductCheckoutRoute,
  handlePublicExternalEmbedRoute,
  handleHomeRoute,
  handleDemoProductRoute,
  handleChatRoute,
  handleCreatorRoute,
  handleCharacterRoute,
  handleBillingRoute,
];

export async function handleApiRoute(req, res) {
  const requestUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const context = {
    path: requestUrl.pathname,
    requestUrl,
  };

  try {
    if (context.path === "/api/health") {
      sendJson(res, 200, {
        ok: true,
        status: "ok",
        service: "aiove-page-rebuild",
      });
      return true;
    }

    for (const handleRoute of routeHandlers) {
      if (await handleRoute(req, res, context)) return true;
    }
    if (context.path.startsWith("/api/")) {
      sendJson(res, 404, { ok: false, error: "接口不存在" });
      return true;
    }
    return false;
  } catch (error) {
    const routeErrorLog = buildApiRouteErrorLog(error, context, req, requestUrl);
    if (routeErrorLog) await recordAppErrorLog(routeErrorLog);
    sendError(res, error);
    return true;
  }
}

export function buildApiRouteErrorLog(error, context = {}, req = null, requestUrl = null) {
  const statusCode = normalizeApiErrorStatusCode(error?.statusCode);
  if (statusCode >= 400 && statusCode < 429) return null;

  return {
    source: "server",
    level: statusCode === 429 ? "warning" : "error",
    type: "api_route_failed",
    action: "api_route",
    statusCode,
    rawMessage: error?.message || error,
    stack: error?.stack || "",
    endpoint: context.path || "",
    request: buildRequestLogContext(req, requestUrl),
  };
}

function normalizeApiErrorStatusCode(value) {
  const statusCode = Number(value || 0);
  return Number.isInteger(statusCode) && statusCode >= 400 && statusCode <= 599
    ? statusCode
    : 500;
}
