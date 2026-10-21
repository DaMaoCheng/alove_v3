import assert from "node:assert/strict";
import { closeDbPool, getDbPool } from "../server/db.js";
import { SERVER_CONFIG } from "../server/config.js";
import { createToken, hashSecret, hashSessionToken } from "../server/security.js";
import { assertLocalMutatingSelfCheckEnvironment } from "./self-check-environment-guard.mjs";

await assertLocalMutatingSelfCheckEnvironment({ label: "promotion campaign HTTP self-check" });

const db = getDbPool();
const suffix = Date.now().toString(36);
const sourceRef = `promotion-campaign-http-self-check-${suffix}`;
const adminEmail = SERVER_CONFIG.security.superAdminEmails[0] || "admin@aiove.local";
const adminId = `u_campaign_http_${suffix}`;
const token = createToken();
const cookie = `${SERVER_CONFIG.authCookieName}=${encodeURIComponent(token)}`;
const baseUrl = SERVER_CONFIG.publicBaseUrl;
const expiredMessage = "结束时间必须晚于当前时间，才能将活动状态设为进行中";
const expiredEndsAt = new Date(Date.now() - 60_000).toISOString();
let restoreAdmin = null;
let campaignId = "";

try {
  restoreAdmin = await ensureSuperAdminSession();
  const activeCreate = await request("/api/admin/promotion-campaigns", {
    method: "POST",
    body: campaignPayload({ status: "active" }),
  });
  assert.equal(activeCreate.response.status, 400, "expired active create should return HTTP 400");
  assert.equal(activeCreate.payload.error, expiredMessage, "expired active create should return the public Chinese message");
  assert.equal(activeCreate.payload.code, "PROMOTION_CAMPAIGN_EXPIRED", "expired active create should return a stable public code");

  const draftCreate = await request("/api/admin/promotion-campaigns", {
    method: "POST",
    body: campaignPayload({ status: "draft" }),
  });
  assert.equal(draftCreate.response.status, 201, `historical draft create should return 201: ${JSON.stringify(draftCreate.payload)}`);
  campaignId = String(draftCreate.payload.item?.id || "").trim();
  assert.ok(campaignId, "historical draft create should return a campaign id");

  const activeUpdate = await request(`/api/admin/promotion-campaigns/${encodeURIComponent(campaignId)}`, {
    method: "PATCH",
    body: { status: "active", endsAt: expiredEndsAt },
  });
  assert.equal(activeUpdate.response.status, 400, "expired active update should return HTTP 400");
  assert.equal(activeUpdate.payload.error, expiredMessage, "expired active update should return the public Chinese message");
  assert.equal(activeUpdate.payload.code, "PROMOTION_CAMPAIGN_EXPIRED", "expired active update should return a stable public code");

  console.log("promotion campaign HTTP self-check passed");
} finally {
  await db.execute("DELETE FROM promotion_campaigns WHERE id = ? OR source_ref = ?", [campaignId || "__none__", sourceRef]).catch(() => {});
  if (typeof restoreAdmin === "function") await restoreAdmin();
  await closeDbPool();
}

function campaignPayload({ status }) {
  return {
    title: `Campaign HTTP ${suffix}`,
    siteId: "site_fkk",
    roleTarget: "all",
    productId: `campaign-http-product-${suffix}`,
    productTitle: "Campaign HTTP Product",
    productUrl: "https://example.test/campaign-http-product",
    messageText: "Campaign HTTP validation check.",
    status,
    endsAt: expiredEndsAt,
    sourceRef,
  };
}

async function request(path, { method, body }) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      cookie,
    },
    body: JSON.stringify(body),
  });
  return { response, payload: await response.json() };
}

async function ensureSuperAdminSession() {
  const [[existing]] = await db.execute(
    "SELECT id, account_type, account_status, auth_token, token_expires_at FROM users WHERE email = ? LIMIT 1",
    [adminEmail]
  );
  const tokenHash = hashSessionToken(token);
  if (existing?.id) {
    await db.execute(
      "UPDATE users SET account_type = 'admin', account_status = 'active', auth_token = ?, token_expires_at = DATE_ADD(NOW(3), INTERVAL 1 HOUR) WHERE id = ?",
      [tokenHash, existing.id]
    );
    return async () => {
      await db.execute(
        "UPDATE users SET account_type = ?, account_status = ?, auth_token = ?, token_expires_at = ? WHERE id = ?",
        [existing.account_type, existing.account_status, existing.auth_token, existing.token_expires_at, existing.id]
      ).catch(() => {});
    };
  }

  await db.execute(
    `INSERT INTO users (
       id, platform, platform_uid, locale, username, password_hash, nickname,
       email, email_verified_at, email_auth_provider, account_type, site_id,
       account_status, auth_token, token_expires_at, last_seen_at
     ) VALUES (?, 'web', ?, 'cn', ?, ?, 'Campaign HTTP Admin', ?, NOW(3), 'email',
       'admin', 'site_fkk', 'active', ?, DATE_ADD(NOW(3), INTERVAL 1 HOUR), NOW(3))`,
    [adminId, adminEmail, adminEmail, hashSecret("CampaignHttpCheck1234"), adminEmail, tokenHash]
  );
  return async () => {
    await db.execute("DELETE FROM users WHERE id = ?", [adminId]).catch(() => {});
  };
}
