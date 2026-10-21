import { createHash } from "node:crypto";
import { getDbPool, withTransaction } from "./db.js";
import { createId } from "./security.js";
import { createPublicError } from "./public-error-utils.js";
import { acquireDedicatedDbAdvisoryLock } from "./db-advisory-lock-service.js";
import { resolveSearchSite } from "./product-search-site-service.js";
import { parseShopifyAdminSource, resolveShopifyAdminToken } from "./product-source-shopify-admin-service.js";
import { SERVER_CONFIG } from "./config.js";

const SHOPIFY_CUSTOMER_SYNC_TIMEOUT_MS = Math.max(1000, Number(SERVER_CONFIG.productApi.timeoutMs || 3000));

export async function syncRegisteredShopifyCustomer({ userId = "", email = "", nickname = "", password = "", siteSlug = "", allowCreate = true } = {}) {
  const site = await resolveSearchSite(siteSlug, { allowDefault: false });
  const source = parseShopifyAdminSource(site?.product_api_url || "");
  const token = source ? resolveShopifyAdminToken(source.tokenEnv, site?.product_access_token_encrypted || "") : "";
  if (!site || !source || !token) return { mode: "not_shopify" };
  const operationId = createId("scop");
  const releaseLock = await acquireDedicatedDbAdvisoryLock(customerSyncLockName(site.id, email), 10);
  try {
    const current = await readCustomerBinding(userId, site.id);
    if (current?.shopify_customer_id) {
      await recordCustomerSyncAudit({
        operationId, userId, siteId: site.id, bindingId: current.id, eventType: "binding_reused",
        shopifyCustomerId: current.shopify_customer_id, apiVersion: source.apiVersion,
      });
      return { mode: "bound", customerId: current.shopify_customer_id };
    }

    let searched;
    try {
      searched = await searchCustomer(source, token, email);
    } catch (error) {
      await recordCustomerSyncAudit({
        operationId, userId, siteId: site.id, eventType: "lookup_failed", failureCode: "SHOPIFY_CUSTOMER_LOOKUP_FAILED", apiVersion: source.apiVersion,
      });
      throw error;
    }

    const lookupResult = normalizeLookupResult(searched.length);
    await recordCustomerSyncAudit({
      operationId, userId, siteId: site.id, eventType: "lookup_completed", lookupResult,
      shopifyCustomerId: searched.length === 1 ? searched[0]?.id : "", apiVersion: source.apiVersion,
    });
    if (searched.length > 1) {
      await recordCustomerSyncAudit({
        operationId, userId, siteId: site.id, eventType: "sync_failed", lookupResult,
        failureCode: "SHOPIFY_CUSTOMER_AMBIGUOUS", apiVersion: source.apiVersion,
      });
      throw createPublicError("Shopify account matching is ambiguous. Please contact support.", 409, "SHOPIFY_CUSTOMER_AMBIGUOUS");
    }

    if (searched.length === 1) {
      const binding = await bindCustomerAndRecordAudit({
        operationId, userId, siteId: site.id, customerId: searched[0].id, eventType: "bound_existing", lookupResult, apiVersion: source.apiVersion,
      });
      return { mode: "bound", customerId: binding.shopify_customer_id };
    }

    if (!allowCreate) {
      await recordCustomerSyncAudit({
        operationId, userId, siteId: site.id, eventType: "sync_failed", lookupResult,
        failureCode: "SHOPIFY_CUSTOMER_CREATION_REQUIRES_PASSWORD", apiVersion: source.apiVersion,
      });
      return { mode: "requires_password" };
    }

    let created;
    try {
      created = await createCustomer(source, token, { email, nickname, password });
    } catch (error) {
      const recovery = await recoverCustomerAfterCreateFailure(source, token, email);
      if (recovery.lookupResult) {
        await recordCustomerSyncAudit({
          operationId, userId, siteId: site.id, eventType: "recovery_lookup_completed", lookupResult: recovery.lookupResult,
          shopifyCustomerId: recovery.customer?.id || "", apiVersion: source.apiVersion,
        });
      } else {
        await recordCustomerSyncAudit({
          operationId, userId, siteId: site.id, eventType: "recovery_lookup_failed",
          failureCode: "SHOPIFY_CUSTOMER_RECOVERY_LOOKUP_FAILED", apiVersion: source.apiVersion,
        });
      }
      if (recovery.customer) {
        const binding = await bindCustomerAndRecordAudit({
          operationId, userId, siteId: site.id, customerId: recovery.customer.id, eventType: "customer_recovered", lookupResult: "one", apiVersion: source.apiVersion,
          failureCode: "SHOPIFY_CUSTOMER_CREATE_RECOVERED",
        });
        return { mode: "bound", customerId: binding.shopify_customer_id };
      }
      await recordCustomerSyncAudit({
        operationId, userId, siteId: site.id, eventType: "sync_failed", lookupResult,
        failureCode: "SHOPIFY_CUSTOMER_CREATE_FAILED", apiVersion: source.apiVersion,
      });
      throw error;
    }
    const customerId = created?.id;
    if (!customerId) {
      await recordCustomerSyncAudit({
        operationId, userId, siteId: site.id, eventType: "sync_failed", lookupResult,
        failureCode: "SHOPIFY_CUSTOMER_CREATE_EMPTY", apiVersion: source.apiVersion,
      });
      throw new Error("Shopify customer synchronization did not return an ID");
    }
    const binding = await bindCustomerAndRecordAudit({
      operationId, userId, siteId: site.id, customerId, eventType: "customer_created", lookupResult, apiVersion: source.apiVersion,
    });
    return { mode: "created", customerId: binding.shopify_customer_id };
  } finally {
    await releaseLock();
  }
}

export async function readShopifyCustomerBinding({ userId = "", siteId = "" } = {}) {
  return readCustomerBinding(userId, siteId);
}

async function searchCustomer(source, token, email) {
  const url = new URL(`https://${source.shopDomain}/admin/api/${source.apiVersion}/customers/search.json`);
  url.searchParams.set("query", `email:${String(email || "").trim().toLowerCase()}`);
  const response = await fetchShopifyCustomerAdmin(url, token);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.errors) throw new Error(`Shopify customer search failed (${response.status})`);
  return Array.isArray(payload?.customers) ? payload.customers : [];
}

async function createCustomer(source, token, { email, nickname, password }) {
  const response = await fetchShopifyCustomerAdmin(`https://${source.shopDomain}/admin/api/${source.apiVersion}/customers.json`, token, {
    method: "POST",
    body: JSON.stringify({ customer: {
      first_name: String(nickname || "AIOVE").slice(0, 255), last_name: "", email,
      verified_email: true, addresses: [], password, password_confirmation: password, send_email_welcome: false,
    } }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.customer?.id) throw new Error(`Shopify customer create failed (${response.status})`);
  return payload.customer;
}

async function fetchShopifyCustomerAdmin(url, token, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SHOPIFY_CUSTOMER_SYNC_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...options,
      headers: {
        Accept: "application/json",
        ...(options.headers || {}),
        "X-Shopify-Access-Token": token,
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function readCustomerBinding(userId, siteId, db = getDbPool()) {
  const [rows] = await db.execute(
    "SELECT id, shopify_customer_id, binding_status FROM shopify_customer_bindings WHERE user_id = ? AND site_id = ? LIMIT 1",
    [String(userId || ""), String(siteId || "")],
  );
  return rows[0] || null;
}

async function bindCustomerAndRecordAudit({ operationId, userId, siteId, customerId, eventType, lookupResult, apiVersion, failureCode = null }) {
  try {
    return await withTransaction(async (db) => {
      const binding = await upsertCustomerBinding({ userId, siteId, customerId, db });
      await recordCustomerSyncAudit({
        operationId, userId, siteId, bindingId: binding.id, eventType, lookupResult,
        shopifyCustomerId: binding.shopify_customer_id, failureCode, apiVersion, db,
      });
      return binding;
    });
  } catch (error) {
    await recordCustomerSyncAudit({
      operationId, userId, siteId, eventType: "sync_failed", lookupResult,
      shopifyCustomerId: customerId, failureCode: resolveBindingFailureCode(error), apiVersion,
    });
    throw error;
  }
}

async function upsertCustomerBinding({ userId, siteId, customerId, db = getDbPool() }) {
  const normalizedCustomerId = String(customerId || "");
  const [externalRows] = await db.execute(
    "SELECT id, user_id FROM shopify_customer_bindings WHERE site_id = ? AND shopify_customer_id = ? LIMIT 1",
    [siteId, normalizedCustomerId],
  );
  if (externalRows[0] && String(externalRows[0].user_id) !== String(userId)) {
    throw createPublicError("This Shopify account is already linked to another AIOVE account.", 409, "SHOPIFY_CUSTOMER_ALREADY_BOUND");
  }
  const current = await readCustomerBinding(userId, siteId, db);
  if (current?.shopify_customer_id && String(current.shopify_customer_id) !== normalizedCustomerId) {
    throw createPublicError("This AIOVE account already has a different Shopify account linked.", 409, "SHOPIFY_CUSTOMER_REBIND_FORBIDDEN");
  }
  await db.execute(
    `INSERT INTO shopify_customer_bindings (id, user_id, site_id, shopify_customer_id, binding_status, verified_at)
     VALUES (?, ?, ?, ?, 'active', NOW(3))
     ON DUPLICATE KEY UPDATE binding_status = 'active', verified_at = NOW(3), updated_at = NOW(3)`,
    [current?.id || createId("scb"), userId, siteId, normalizedCustomerId],
  );
  return readCustomerBinding(userId, siteId, db);
}

async function recordCustomerSyncAudit({
  operationId, userId, siteId, bindingId = null, eventType, lookupResult = null,
  shopifyCustomerId = null, failureCode = null, apiVersion = null, db = getDbPool(),
}) {
  await db.execute(
    `INSERT INTO shopify_customer_sync_audits (
       id, operation_id, event_sequence, user_id, site_id, binding_id, event_type, lookup_result,
       shopify_customer_id, failure_code, api_version
     ) SELECT ?, ?, COALESCE(MAX(event_sequence), 0) + 1, ?, ?, ?, ?, ?, ?, ?, ?
       FROM shopify_customer_sync_audits
       WHERE operation_id = ?`,
    [
      createId("sca"), String(operationId || ""), String(userId || ""), String(siteId || ""), bindingId || null,
      String(eventType || ""), lookupResult || null, shopifyCustomerId ? String(shopifyCustomerId) : null,
      failureCode || null, apiVersion || null, String(operationId || ""),
    ],
  );
}

function normalizeLookupResult(count) {
  if (count === 0) return "zero";
  if (count === 1) return "one";
  return "multiple";
}

async function recoverCustomerAfterCreateFailure(source, token, email) {
  try {
    const recovered = await searchCustomer(source, token, email);
    return { customer: recovered.length === 1 ? recovered[0] : null, lookupResult: normalizeLookupResult(recovered.length) };
  } catch {
    return { customer: null, lookupResult: null };
  }
}

function customerSyncLockName(siteId, email) {
  const key = `${String(siteId || "")}\n${String(email || "").trim().toLowerCase()}`;
  return `shopify_customer_sync:${createHash("sha256").update(key).digest("hex")}`.slice(0, 64);
}

function resolveBindingFailureCode(error) {
  if (error?.publicCode === "SHOPIFY_CUSTOMER_ALREADY_BOUND") return "SHOPIFY_CUSTOMER_ALREADY_BOUND";
  if (error?.publicCode === "SHOPIFY_CUSTOMER_REBIND_FORBIDDEN") return "SHOPIFY_CUSTOMER_REBIND_FORBIDDEN";
  return "SHOPIFY_CUSTOMER_BINDING_FAILED";
}
