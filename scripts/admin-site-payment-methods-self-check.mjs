import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initializeDatabase, getDbPool, closeDbPool } from "../server/db.js";
import { createAdminSite, updateAdminSite } from "../server/admin-site-service.js";
import { mapSiteRow } from "../server/admin-site-mapper.js";
import { PAYMENT_METHOD_OPTIONS, normalizePaymentMethods } from "../shared/payment-methods.js";

const suffix = Date.now().toString(36);
const sitePayload = {
  name: `Payment Methods ${suffix}`,
  slug: `payment-methods-${suffix}`,
  siteUrl: "",
  defaultLanguage: "English",
  mascotCharacterId: "",
  productSourceType: "",
  productApiUrl: "",
  productShopDomain: "",
  productApiVersion: "2026-04",
  productAccessToken: "",
  paymentMethods: ["visa", "paypal", "visa", "not_allowed"],
  description: "self-check",
  regionIds: [],
};

assert.equal(PAYMENT_METHOD_OPTIONS.length, 11, "payment method V1 should expose 11 options");
assert.deepEqual(
  normalizePaymentMethods(["visa", "paypal", "visa", "bad"]),
  ["visa", "paypal"],
  "payment method normalizer should keep allowed unique keys"
);
assert.deepEqual(
  normalizePaymentMethods(Buffer.from(JSON.stringify(["visa", "paypal"]))),
  ["visa", "paypal"],
  "payment method normalizer should parse JSON values returned as database buffers"
);
assert.deepEqual(
  mapSiteRow({
    id: "site_buffer",
    name: "Buffer Site",
    slug: "buffer-site",
    payment_methods_json: Buffer.from(JSON.stringify(["visa", "paypal"])),
  }).paymentMethods,
  ["visa", "paypal"],
  "admin site mapper should expose payment methods when MySQL returns JSON as a Buffer"
);

const sitesTemplate = readFileSync("src/features/admin-console/admin-console-sites-template.js", "utf8");
assert.match(sitesTemplate, /data-site-payment-picker/, "site editor should render payment method picker");
assert.match(sitesTemplate, /data-site-payment-search/, "payment method picker should include search input");
assert.match(sitesTemplate, /name="paymentMethods"/, "payment method picker should submit paymentMethods");
assert.match(sitesTemplate, /name="paymentMethodsTouched"/, "payment method picker should submit whether the selection was changed");
assert.match(sitesTemplate, /selectedMethods\.map/, "payment method tags should follow selected order instead of option order");
assert.doesNotMatch(sitesTemplate, /index \+ 1/, "payment method tags should not render visible order numbers");
assert.match(sitesTemplate, /未配置，产品详情不展示支付方式/, "empty payment method state should be explicit");

const editorSource = readFileSync("src/features/admin-console/admin-sites-editor.js", "utf8");
assert.match(editorSource, /bindSitePaymentMethodPicker/, "site editor should bind payment method picker");
assert.match(editorSource, /paymentMethods: data\.get\("paymentMethods"\)/, "site editor should submit payment methods payload");
assert.match(editorSource, /paymentMethodsTouched: data\.get\("paymentMethodsTouched"\)/, "site editor should submit payment method touch state");
assert.match(editorSource, /site-payment-method-menu\.is-floating/, "site editor close should clean up floating payment menus");

const pickerSource = readFileSync("src/features/admin-console/admin-sites-payment-method-picker.js", "utf8");
assert.match(pickerSource, /open = true;\s+render\(\);/s, "payment method option click should keep dropdown open for multi-select");
assert.match(pickerSource, /document\.body\.append\(menu\)/, "payment method menu should float outside clipped modal containers");
assert.match(pickerSource, /position:fixed|is-floating/, "payment method menu should use floating positioning");
assert.match(pickerSource, /markTouched/, "payment method picker should only mark the field changed after user selection changes");

const adminCss = readFileSync("src/features/app-shell/styles/admin-console.css", "utf8");
assert.match(adminCss, /site-payment-method-menu\.is-floating\{[^}]*z-index:10050/, "payment method floating menu should render above dialog-host");

await initializeDatabase();
const db = getDbPool();
let siteId = "";

try {
  const created = await createAdminSite(sitePayload);
  siteId = created.item.id;

  assert.deepEqual(created.item.paymentMethods, ["visa", "paypal"], "created site should expose normalized payment methods");

  const [[stored]] = await db.execute(
    "SELECT payment_methods_json FROM sites WHERE id = ? LIMIT 1",
    [siteId]
  );
  assert.deepEqual(normalizePaymentMethods(stored.payment_methods_json), ["visa", "paypal"], "payment methods should be stored as JSON");

  const updated = await updateAdminSite(siteId, {
    ...sitePayload,
    name: `Payment Methods Updated ${suffix}`,
    paymentMethods: "amex,klarna,unknown",
    paymentMethodsTouched: "1",
  });
  assert.deepEqual(updated.item.paymentMethods, ["amex", "klarna"], "updated site should preserve configured payment method order");

  const untouchedUpdate = await updateAdminSite(siteId, {
    ...sitePayload,
    name: `Payment Methods Untouched ${suffix}`,
    paymentMethods: "",
    paymentMethodsTouched: "0",
  });
  assert.deepEqual(untouchedUpdate.item.paymentMethods, ["amex", "klarna"], "untouched site saves should not clear existing payment methods");

  const legacyUpdate = await updateAdminSite(siteId, {
    ...sitePayload,
    name: `Payment Methods Legacy ${suffix}`,
    paymentMethods: "visa,mastercard",
  });
  assert.deepEqual(legacyUpdate.item.paymentMethods, ["visa", "mastercard"], "legacy payloads without touch state should still update payment methods when provided");

  const clearUpdate = await updateAdminSite(siteId, {
    ...sitePayload,
    name: `Payment Methods Cleared ${suffix}`,
    paymentMethods: "",
    paymentMethodsTouched: "1",
  });
  assert.deepEqual(clearUpdate.item.paymentMethods, [], "explicitly touched empty selection should clear payment methods");

  console.log("admin site payment methods self-check passed");
} finally {
  if (siteId) {
    await db.execute("DELETE FROM site_geo_regions WHERE site_id = ?", [siteId]).catch(() => {});
    await db.execute("DELETE FROM sites WHERE id = ?", [siteId]).catch(() => {});
  }
  await closeDbPool();
}
