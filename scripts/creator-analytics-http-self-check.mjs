import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { closeDbPool, getDbPool } from "../server/db.js";
import { SERVER_CONFIG } from "../server/config.js";
import { createToken, hashSessionToken } from "../server/security.js";
import { assertLocalMutatingSelfCheckEnvironment } from "./self-check-environment-guard.mjs";

await assertLocalMutatingSelfCheckEnvironment({ label: "creator analytics HTTP self-check" });

const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
const db = getDbPool();
const siteId = `site_creator_http_${suffix}`;
const creatorId = `u_creator_http_${suffix}`;
const personalId = `u_personal_http_${suffix}`;
const adminId = `u_admin_http_${suffix}`;
const characterId = `char_creator_http_${suffix}`;
const sessions = new Map();

try {
  await seed();
  const unauthenticated = await request("/api/creator/analytics?range=7d");
  assert.equal(unauthenticated.response.status, 401);

  const personal = await request("/api/creator/analytics?range=7d", sessions.get(personalId));
  assert.equal(personal.response.status, 403);
  assert.equal(personal.payload.code, "CREATOR_ACCOUNT_REQUIRED");

  const admin = await request("/api/creator/analytics?range=7d", sessions.get(adminId));
  assert.equal(admin.response.status, 403);

  const invalidRange = await request("/api/creator/analytics?range=invalid", sessions.get(creatorId));
  assert.equal(invalidRange.response.status, 400);
  assert.equal(invalidRange.payload.code, "INVALID_ANALYTICS_RANGE");

  const creator = await request("/api/creator/analytics?range=7d", sessions.get(creatorId));
  assert.equal(creator.response.status, 200, JSON.stringify(creator.payload));
  assert.equal(creator.payload.ok, true);
  assert.equal(creator.payload.character.id, characterId);
  assert.equal(creator.payload.range, "7d");

  console.log("creator analytics HTTP self-check passed");
} finally {
  await db.execute("DELETE FROM ai_characters WHERE id = ?", [characterId]).catch(() => {});
  await db.execute("DELETE FROM users WHERE id IN (?, ?, ?)", [creatorId, personalId, adminId]).catch(() => {});
  await db.execute("DELETE FROM sites WHERE id = ?", [siteId]).catch(() => {});
  await closeDbPool();
}

async function seed() {
  await db.execute(
    `INSERT INTO sites (id, name, slug, time_zone, site_status, is_default)
     VALUES (?, 'Creator HTTP Test', ?, 'UTC', 'active', 0)`,
    [siteId, `creator-http-${suffix}`]
  );
  for (const [id, type] of [[creatorId, "creator"], [personalId, "personal"], [adminId, "admin"]]) {
    const token = createToken();
    sessions.set(id, token);
    await db.execute(
      `INSERT INTO users (
         id, platform, platform_uid, locale, username, password_hash, email, account_type,
         site_id, account_status, auth_token, token_expires_at
       ) VALUES (?, 'web', ?, 'en', ?, 'self-check', ?, ?, ?, 'active', ?, DATE_ADD(NOW(3), INTERVAL 1 HOUR))`,
      [id, id, id, `${id}@example.test`, type, siteId, hashSessionToken(token)]
    );
  }
  await db.execute(
    `INSERT INTO ai_characters (
       id, category_id, owner_uid, site_id, slug, name, visibility, character_status, source_type
     ) VALUES (?, 'creator', ?, ?, ?, 'Creator HTTP Character', 'public', 'published', 'self_check')`,
    [characterId, creatorId, siteId, `creator-http-character-${suffix}`]
  );
}

async function request(path, token = "") {
  const response = await fetch(`${SERVER_CONFIG.publicBaseUrl}${path}`, {
    headers: token ? { cookie: `${SERVER_CONFIG.authCookieName}=${encodeURIComponent(token)}` } : {},
  });
  return { response, payload: await response.json() };
}
