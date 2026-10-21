export {
  createUserCharacterActivationsTableIfMissing,
  createSitesTableIfMissing,
  createGeoRegionTablesIfMissing,
} from "./db-bootstrap-core-tables.js";

export {
  createSiteProductCacheTableIfMissing,
  createSiteHomeProductSectionsTableIfMissing,
  createSiteKitshopSalesCacheTableIfMissing,
  createTtmallCartSessionsTableIfMissing,
  createTtmallAccountBindingsTableIfMissing,
  createTtmallBindingCandidatesTableIfMissing,
  createTtmallCheckoutAttemptsTableIfMissing,
  createShopifyCustomerBindingsTableIfMissing,
  createShopifyCustomerSyncAuditsTableIfMissing,
  createShopifyCartSessionsTableIfMissing,
  createShopifyDraftOrderAttemptsTableIfMissing,
  createDiscountCodeTablesIfMissing,
  createPromotionCampaignTablesIfMissing,
  createProductAnalyticsEventsTableIfMissing,
} from "./db-bootstrap-commerce-tables.js";

export {
  createMascotSettingsTableIfMissing,
  createChatQuickRepliesTableIfMissing,
  createChatImageTablesIfMissing,
  createMascotGreetingImageTablesIfMissing,
  createGuestChatTablesIfMissing,
} from "./db-bootstrap-chat-tables.js";

export {
  createAiReplyLogsTableIfMissing,
  createAppErrorLogsTableIfMissing,
  createAdminOperationLogsTableIfMissing,
  createUserFeedbackTableIfMissing,
  createHomeCarouselItemsTableIfMissing,
  createMascotAdDeliveriesTableIfMissing,
  createProactiveMessageDeliveriesTableIfMissing,
} from "./db-bootstrap-operations-tables.js";

export { createSiteExternalEmbedsTableIfMissing } from "./db-bootstrap-external-embed-tables.js";

export {
  createKnowledgeBaseTablesIfMissing,
  createKnowledgeBaseBindingsTableIfMissing,
} from "./db-bootstrap-knowledge-tables.js";
