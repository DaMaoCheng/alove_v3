import { addMemoryJobLeaseColumnsIfMissing } from "./memory-job-schema.js";
import { createReportingTables } from "./reporting-token-service.js";
import { createGuestVisitorTablesIfMissing } from './guest-visitor-schema.js';
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { PROJECT_ROOT } from "./config.js";
import { closeDbPool, getDbPool, withTransaction } from "./db-core.js";
import {
  addAdminAccountColumnsIfMissing,
  addCharacterSettingsColumnsIfMissing,
  addCharacterVoiceAssetColumnsIfMissing,
  addChatSessionPreferenceColumnsIfMissing,
  addGuestExternalSourceContextColumnIfMissing,
  addHomeCarouselColumnsIfMissing,
  addMascotSettingsColumnsIfMissing,
  addSiteColumnsIfMissing,
  addUserCharacterActivationPreferenceColumnsIfMissing,
  addUserProfileColumnsIfMissing,
  ensureUserAccountTypeMigration,
  ensureCreatorCharacterOwnerUniqueness,
} from "./db-column-migrations.js";
import {
  createAdminOperationLogsTableIfMissing,
  createAiReplyLogsTableIfMissing,
  createChatImageTablesIfMissing,
  createMascotGreetingImageTablesIfMissing,
  createGuestChatTablesIfMissing,
  createAppErrorLogsTableIfMissing,
  createChatQuickRepliesTableIfMissing,
  createDiscountCodeTablesIfMissing,
  createGeoRegionTablesIfMissing,
  createHomeCarouselItemsTableIfMissing,
  createKnowledgeBaseBindingsTableIfMissing,
  createKnowledgeBaseTablesIfMissing,
  createMascotAdDeliveriesTableIfMissing,
  createMascotSettingsTableIfMissing,
  createProactiveMessageDeliveriesTableIfMissing,
  createProductAnalyticsEventsTableIfMissing,
  createPromotionCampaignTablesIfMissing,
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
  createSiteExternalEmbedsTableIfMissing,
  createSiteProductCacheTableIfMissing,
  createSitesTableIfMissing,
  createUserCharacterActivationsTableIfMissing,
  createUserFeedbackTableIfMissing,
} from "./db-bootstrap-tables.js";
import {
  backfillUserCharacterActivationsFromSessions,
  cleanupDuplicateProductImpressions,
  seedDefaultChatQuickReplies,
  seedDefaultGeoRegions,
  seedDefaultHomeCarouselItem,
  seedDefaultMascotCharacters,
  seedDefaultMascotSettings,
  syncFrontDeskMascotContent,
  seedDefaultSites,
  seedMascotCategory,
} from "./db-bootstrap-seeds.js";
import { addColumnIfMissing, addIndexIfMissing, tableExists } from "./db-schema-utils.js";

export { closeDbPool, getDbPool, withTransaction } from "./db-core.js";

export async function initializeDatabase() {
  const schema = await readFile(join(PROJECT_ROOT, "database/schema.sql"), "utf8");
  await runPreSchemaMigrations();
  await getDbPool().query(schema);
  await runSchemaMigrations();
}

async function runSchemaMigrations() {
  await addMemoryJobLeaseColumnsIfMissing();
  await createReportingTables();
  await ensureUserAccountTypeMigration();
  await addLastAccessColumnsIfMissing();
  await seedMascotCategory();
  await addEmailVerificationCodeColumnsIfMissing();
  await addUserProfileColumnsIfMissing();
  await addAdminAccountColumnsIfMissing();
  await addCharacterSettingsColumnsIfMissing();
  await ensureCreatorCharacterOwnerUniqueness();
  await addCharacterVoiceAssetColumnsIfMissing();
  await addChatSessionPreferenceColumnsIfMissing();
  await createUserCharacterActivationsTableIfMissing();
  await addUserCharacterActivationPreferenceColumnsIfMissing();
  await backfillUserCharacterActivationsFromSessions();
  await createAiReplyLogsTableIfMissing();
  await createAppErrorLogsTableIfMissing();
  await createAdminOperationLogsTableIfMissing();
  await createUserFeedbackTableIfMissing();
  await createChatQuickRepliesTableIfMissing();
  await createChatImageTablesIfMissing();
  await createMascotGreetingImageTablesIfMissing();
  await createGuestChatTablesIfMissing();
  await createGuestVisitorTablesIfMissing();
  await addGuestExternalSourceContextColumnIfMissing();
  await seedDefaultChatQuickReplies();
  await createProductAnalyticsEventsTableIfMissing();
  await createSiteProductCacheTableIfMissing();
  await createSiteHomeProductSectionsTableIfMissing();
  await createSiteKitshopSalesCacheTableIfMissing();
  await createTtmallCartSessionsTableIfMissing();
  await createTtmallAccountBindingsTableIfMissing();
  await createTtmallBindingCandidatesTableIfMissing();
  await createTtmallCheckoutAttemptsTableIfMissing();
  await createShopifyCustomerBindingsTableIfMissing();
  await createShopifyCustomerSyncAuditsTableIfMissing();
  await createShopifyCartSessionsTableIfMissing();
  await createShopifyDraftOrderAttemptsTableIfMissing();
  await cleanupDuplicateProductImpressions();
  await createHomeCarouselItemsTableIfMissing();
  await addHomeCarouselColumnsIfMissing();
  await seedDefaultHomeCarouselItem();
  await createSitesTableIfMissing();
  await addSiteColumnsIfMissing();
  await seedDefaultSites();
  await createSiteExternalEmbedsTableIfMissing();
  await createGeoRegionTablesIfMissing();
  await seedDefaultGeoRegions();
  await createMascotSettingsTableIfMissing();
  await createMascotAdDeliveriesTableIfMissing();
  await createDiscountCodeTablesIfMissing();
  await createPromotionCampaignTablesIfMissing();
  await createProactiveMessageDeliveriesTableIfMissing();
  await createKnowledgeBaseTablesIfMissing();
  await createKnowledgeBaseBindingsTableIfMissing();
  await seedDefaultMascotCharacters();
  await seedDefaultMascotSettings();
  await syncFrontDeskMascotContent();
}

async function runPreSchemaMigrations() {
  if (await tableExists("character_categories")) {
    await seedMascotCategory();
  }
  if (await tableExists("ai_characters")) {
    await addCharacterSettingsColumnsIfMissing();
    await ensureCreatorCharacterOwnerUniqueness();
  }
  if (await tableExists("character_voice_assets")) {
    await addCharacterVoiceAssetColumnsIfMissing();
  }
  if (await tableExists("chat_sessions")) {
    await addChatSessionPreferenceColumnsIfMissing();
  }
  if (await tableExists("guest_sessions")) {
    await addGuestExternalSourceContextColumnIfMissing();
  }
  if (await tableExists("user_character_activations")) {
    await addUserCharacterActivationPreferenceColumnsIfMissing();
  }
  if (await tableExists("sites")) {
    await addSiteColumnsIfMissing();
    await createGeoRegionTablesIfMissing();
  }
  if (await tableExists("mascot_settings")) {
    await addMascotSettingsColumnsIfMissing();
  }
  if (await tableExists("knowledge_bases")) {
    await createKnowledgeBaseTablesIfMissing();
    await createKnowledgeBaseBindingsTableIfMissing();
  }
  if (await tableExists("home_carousel_items")) {
    await addHomeCarouselColumnsIfMissing();
  }
}
async function addEmailVerificationCodeColumnsIfMissing() {
  await addColumnIfMissing("email_verification_codes", "request_ip", "VARCHAR(64) NULL AFTER provider");
  await addColumnIfMissing("email_verification_codes", "attempts_count", "INT UNSIGNED NOT NULL DEFAULT 0 AFTER request_ip");
  await addColumnIfMissing("email_verification_codes", "last_attempt_at", "DATETIME(3) NULL AFTER attempts_count");
  await addIndexIfMissing("email_verification_codes", "idx_email_codes_ip_created", "CREATE INDEX idx_email_codes_ip_created ON email_verification_codes(request_ip, created_at)");
}

async function addLastAccessColumnsIfMissing() {
  await addColumnIfMissing("users", "last_ip", "VARCHAR(64) NULL AFTER last_seen_at");
  await addColumnIfMissing("users", "last_ip_region", "VARCHAR(96) NULL AFTER last_ip");
  await addColumnIfMissing("users", "last_ip_at", "DATETIME(3) NULL AFTER last_ip_region");
  await addColumnIfMissing("users", "last_login_user_agent", "VARCHAR(500) NULL AFTER last_ip_at");
  await addColumnIfMissing("guest_sessions", "last_ip", "VARCHAR(64) NULL AFTER target_chat_session_id");
  await addColumnIfMissing("guest_sessions", "last_ip_region", "VARCHAR(96) NULL AFTER last_ip");
  await addColumnIfMissing("guest_sessions", "last_ip_at", "DATETIME(3) NULL AFTER last_ip_region");
  await addColumnIfMissing("guest_sessions", "last_user_agent", "VARCHAR(500) NULL AFTER last_ip_at");
}
