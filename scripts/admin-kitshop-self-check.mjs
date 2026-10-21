import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { closeDbPool, getDbPool, initializeDatabase } from "../server/db.js";
import { getAdminKitshop, refreshAdminKitshop } from "../server/admin-kitshop-service.js";
import { SERVER_CONFIG } from "../server/config.js";
import { ADMIN_SCOPES, requireAdmin } from "../server/route-utils.js";
import { createToken, hashSecret, hashSessionToken } from "../server/security.js";

const SITE_ID = "site_admin_kitshop_self_check";
const SITE_SLUG = "admin-kitshop-self-check";
const ADMIN_ID = "u_admin_kitshop_self_check";
const ADMIN_EMAIL = "admin-kitshop-self-check@example.local";
const USER_ID = "u_admin_kitshop_user_self_check";
const USER_EMAIL = "admin-kitshop-user-self-check@example.local";
const SUPER_ADMIN_ID = "u_admin_kitshop_super_self_check";
const SUPER_ADMIN_EMAIL = SERVER_CONFIG.security.superAdminEmails[0] || "admin@aiove.local";
const adminTemplateSource = readFileSync("src/features/admin-console/admin-kitshop-template.js", "utf8");

assert.doesNotMatch(adminTemplateSource, /最近 30 天商品热度/, "admin Kitshop hint must not describe the retired behavior-based ranking");
assert.match(adminTemplateSource, /近 30\/60 天销量与其他首页商品混排，最多 15 件且不重复/, "admin Kitshop hint should summarize the current sales mix");

await initializeDatabase();
const db = getDbPool();
let superAdminRestore = null;

try {
  await cleanup();
  await seedSite();
  await seedCache();

  const initial = await getAdminKitshop({ site: SITE_ID });
  assert.equal(initial.ok, true, "admin kitshop list should return ok");
  assert.equal(initial.site.id, SITE_ID, "selected site should map by id");
  assert.equal(initial.summary.activeProducts, 1, "summary should count active cached products");
  assert.equal(initial.summary.inactiveProducts, 1, "summary should count inactive cached products");
  assert.equal(initial.productPagination.total, 2, "product pagination should include total rows");
  assert.equal(initial.productPagination.page, 1, "product pagination should map current page");
  assert.equal(initial.sections.length, 1, "home sections should be listed");
  assert.equal(initial.sections[0].productCount, 1, "section product count should map");
  assert.equal(initial.products[0].title, "Cached Home Kit", "cached product should map title");

  const bySlug = await getAdminKitshop({ site: SITE_SLUG });
  assert.equal(bySlug.site.id, SITE_ID, "selected site should map by slug");

  const secondProductPage = await getAdminKitshop({ site: SITE_ID, productPage: 2, productLimit: 1 });
  assert.equal(secondProductPage.productPagination.page, 2, "product pagination should support page 2");
  assert.equal(secondProductPage.productPagination.pages, 2, "product pagination should calculate pages");
  assert.equal(secondProductPage.products.length, 1, "product pagination limit should apply");
  assert.equal(secondProductPage.products[0].externalProductKey, "prod_admin_old", "page 2 should return the second cached product");

  const refreshed = await refreshAdminKitshop({ site: SITE_ID }, {
    fetchProducts: async () => mockProducts(),
    fetchHomepageSections: async () => mockHomepageSections(),
  });
  assert.equal(refreshed.ok, true, "refresh should return ok");
  assert.equal(refreshed.refresh.refreshed, true, "refresh should report refreshed cache");
  assert.equal(refreshed.summary.activeProducts, 2, "refresh should upsert mock products");
  assert.equal(refreshed.summary.inactiveProducts, 1, "refresh should keep old cache as inactive");
  assert.equal(refreshed.productPagination.total, 3, "refresh response should include active and inactive cached products");
  assert.equal(refreshed.products.some((item) => item.externalProductKey === "prod_admin_away"), true, "refreshed products should include away product");
  assert.equal(refreshed.sections[0].title, "Homepage admin kits", "refreshed section should map title");

  const emptyRefresh = await refreshAdminKitshop({ site: SITE_ID }, {
    fetchProducts: async () => [],
    fetchHomepageSections: async () => [],
  });
  assert.equal(emptyRefresh.refresh.ok, false, "empty source refresh should not report success");
  assert.equal(emptyRefresh.refresh.refreshed, false, "empty source refresh should keep existing cache without claiming refresh");
  assert.equal(Boolean(emptyRefresh.refresh.warning || emptyRefresh.refresh.error), true, "empty source refresh should explain that cached data was retained");

  const adminToken = createToken();
  const userToken = createToken();
  const superAdminToken = createToken();
  await insertUser({ id: ADMIN_ID, email: ADMIN_EMAIL, accountType: "admin", token: adminToken });
  await insertUser({ id: USER_ID, email: USER_EMAIL, accountType: "personal", token: userToken });
  superAdminRestore = await ensureSuperAdminSession(superAdminToken);

  const admin = await requireAdmin(fakeRequest(adminToken));
  assert.equal(admin.id, ADMIN_ID, "admin should access read endpoint");
  await assert.rejects(
    () => requireAdmin(fakeRequest(adminToken), ADMIN_SCOPES.KITSHOP_WRITE),
    /当前管理员没有执行该操作的权限/,
    "admin without kitshop write scope should not refresh"
  );
  await assert.rejects(
    () => requireAdmin(fakeRequest(userToken), ADMIN_SCOPES.KITSHOP_WRITE),
    /无权访问管理后台/,
    "personal user should not refresh kitshop cache"
  );
  const superAdmin = await requireAdmin(fakeRequest(superAdminToken), ADMIN_SCOPES.KITSHOP_WRITE);
  assert.equal(superAdmin.email, SUPER_ADMIN_EMAIL, "super admin should have kitshop write permission");

  console.log("admin kitshop self-check passed");
} finally {
  if (typeof superAdminRestore === "function") await superAdminRestore();
  await cleanup();
  await closeDbPool();
}

async function seedSite() {
  await db.execute(
    `INSERT INTO sites (
       id, name, slug, site_url, default_language, currency, time_zone,
       site_status, is_default, mascot_character_id, product_api_url, description
     ) VALUES (?, 'Admin Kitshop Self Check', ?, 'https://store.example', 'English', 'GBP', 'UTC',
       'active', 0, NULL, 'https://store.example/products', 'Temporary admin kitshop self-check site.')
     ON DUPLICATE KEY UPDATE
       name = VALUES(name),
       slug = VALUES(slug),
       site_url = VALUES(site_url),
       product_api_url = VALUES(product_api_url),
       site_status = 'active'`,
    [SITE_ID, SITE_SLUG]
  );
}

async function seedCache() {
  await db.execute(
    `INSERT INTO site_product_cache (
       id, site_id, site_slug, external_product_key, product_title, product_subtitle,
       product_url, image_url, price_now, price_was, source_type, source_rank,
       cached_status, last_synced_at
     ) VALUES
       ('spc_admin_kitshop_active', ?, ?, 'prod_admin_home', 'Cached Home Kit', 'Self check', 'https://store.example/products/home', '/assets/jersey_product.png', '£40.00', '£80.00', 'site_source', 1, 'active', NOW(3)),
       ('spc_admin_kitshop_inactive', ?, ?, 'prod_admin_old', 'Old Cached Kit', 'Self check', 'https://store.example/products/old', '/assets/jersey_product.png', '£20.00', NULL, 'site_source', 2, 'inactive', NOW(3))
     ON DUPLICATE KEY UPDATE cached_status = VALUES(cached_status), product_title = VALUES(product_title), updated_at = NOW(3)`,
    [SITE_ID, SITE_SLUG, SITE_ID, SITE_SLUG]
  );
  await db.execute(
    `INSERT INTO site_home_product_sections (
       id, site_id, site_slug, theme_id, theme_name, section_key, section_type, section_title,
       collection_handles_json, product_handles_json, product_keys_json, source_rank, section_status, last_synced_at
     ) VALUES (
       'hps_admin_kitshop_self_check', ?, ?, 'theme_admin_self_check', 'Self Check Theme',
       'featured_admin_self_check', 'featured-collection', 'Cached admin kits',
       CAST('["admin-kits"]' AS JSON), CAST('[]' AS JSON), CAST('["prod_admin_home"]' AS JSON), 1, 'active', NOW(3)
     )
     ON DUPLICATE KEY UPDATE section_status = 'active', product_keys_json = VALUES(product_keys_json), updated_at = NOW(3)`,
    [SITE_ID, SITE_SLUG]
  );
}

function mockProducts() {
  return [
    {
      id: "prod_admin_home",
      name: "Admin Home Kit",
      subtitle: "Self check",
      price: "£49.99",
      priceWas: "£89.99",
      url: "https://store.example/products/home",
      imageUrl: "/assets/jersey_product.png",
      available: true,
    },
    {
      id: "prod_admin_away",
      name: "Admin Away Kit",
      subtitle: "Self check",
      price: "£59.99",
      url: "https://store.example/products/away",
      imageUrl: "/assets/jersey_product.png",
      available: true,
    },
  ];
}

function mockHomepageSections() {
  return [
    {
      sectionKey: "featured_admin_self_check",
      sectionType: "featured-collection",
      sectionTitle: "Homepage admin kits",
      collectionHandles: ["homepage-admin-kits"],
      productHandles: [],
      displayOrder: 1,
      themeId: "theme_admin_self_check",
      themeName: "Self Check Theme",
      rawSection: { type: "featured-collection" },
      products: [mockProducts()[1], mockProducts()[0]],
    },
  ];
}

async function insertUser({ id, email, accountType, token }) {
  await db.execute(
    `INSERT INTO users (
       id, platform, platform_uid, locale, username, password_hash, nickname,
       email, email_verified_at, email_auth_provider, account_type, site_id,
       account_status, auth_token, token_expires_at, last_seen_at
     ) VALUES (?, 'web', ?, 'cn', ?, ?, ?, ?, NOW(3), 'email', ?, ?, 'active', ?, DATE_ADD(NOW(3), INTERVAL 1 HOUR), NOW(3))`,
    [
      id,
      email,
      email,
      hashSecret("AdminKitshop1234"),
      accountType === "admin" ? "Admin Kitshop Check" : "Kitshop User Check",
      email,
      accountType,
      SITE_ID,
      hashSessionToken(token),
    ]
  );
}

async function ensureSuperAdminSession(token) {
  const [[existing]] = await db.execute(
    "SELECT id, account_type, auth_token, token_expires_at FROM users WHERE email = ? LIMIT 1",
    [SUPER_ADMIN_EMAIL]
  );
  const tokenHash = hashSessionToken(token);
  if (existing?.id) {
    await db.execute(
      "UPDATE users SET account_type = 'admin', auth_token = ?, token_expires_at = DATE_ADD(NOW(3), INTERVAL 1 HOUR), account_status = 'active' WHERE id = ?",
      [tokenHash, existing.id]
    );
    return async () => {
      await db.execute(
        "UPDATE users SET account_type = ?, auth_token = ?, token_expires_at = ? WHERE id = ?",
        [existing.account_type, existing.auth_token, existing.token_expires_at, existing.id]
      ).catch(() => {});
    };
  }

  await insertUser({
    id: SUPER_ADMIN_ID,
    email: SUPER_ADMIN_EMAIL,
    accountType: "admin",
    token,
  });
  return async () => {
    await db.execute("DELETE FROM users WHERE id = ?", [SUPER_ADMIN_ID]).catch(() => {});
  };
}

function fakeRequest(token) {
  return {
    headers: {
      cookie: token ? `aiove_auth_token=${encodeURIComponent(token)}` : "",
    },
  };
}

async function cleanup() {
  await db.execute("DELETE FROM site_product_cache WHERE site_id = ?", [SITE_ID]).catch(() => {});
  await db.execute("DELETE FROM site_home_product_sections WHERE site_id = ?", [SITE_ID]).catch(() => {});
  await db.execute("DELETE FROM users WHERE id IN (?, ?) OR email IN (?, ?)", [
    ADMIN_ID,
    USER_ID,
    ADMIN_EMAIL,
    USER_EMAIL,
  ]).catch(() => {});
  await db.execute("DELETE FROM sites WHERE id = ?", [SITE_ID]).catch(() => {});
}
