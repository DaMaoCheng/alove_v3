import { handleAdminAccountRoute } from "./admin-account-routes.js";
import { handleAdminAnalyticsRoute } from "./admin-analytics-routes.js";
import { handleAdminCarouselRoute } from "./admin-carousel-routes.js";
import { handleAdminCharacterRoute } from "./admin-character-routes.js";
import { handleAdminClientEventRoute } from "./admin-client-event-routes.js";
import { handleAdminDiscountCodeRoute } from "./admin-discount-code-routes.js";
import { handleAdminExternalEmbedRoute } from "./admin-external-embed-routes.js";
import { handleAdminFeedbackRoute } from "./admin-feedback-routes.js";
import { handleAdminKitshopRoute } from "./admin-kitshop-routes.js";
import { handleAdminKnowledgeRoute } from "./admin-knowledge-routes.js";
import { handleAdminLogRoute } from "./admin-log-routes.js";
import { handleAdminMascotRoute } from "./admin-mascot-routes.js";
import { handleAdminPromotionRoute } from "./admin-promotion-routes.js";
import { handleAdminSiteRoute } from "./admin-site-routes.js";

const adminRouteHandlers = [
  handleAdminClientEventRoute,
  handleAdminAnalyticsRoute,
  handleAdminDiscountCodeRoute,
  handleAdminExternalEmbedRoute,
  handleAdminPromotionRoute,
  handleAdminKitshopRoute,
  handleAdminFeedbackRoute,
  handleAdminLogRoute,
  handleAdminCharacterRoute,
  handleAdminAccountRoute,
  handleAdminSiteRoute,
  handleAdminKnowledgeRoute,
  handleAdminMascotRoute,
  handleAdminCarouselRoute,
];

export async function handleAdminRoute(req, res, context) {
  for (const handleRoute of adminRouteHandlers) {
    if (await handleRoute(req, res, context)) return true;
  }
  return false;
}
