const { chromium } = require("playwright");
const assert = require("node:assert/strict");

const BASE_URL = process.env.AIOVE_BASE_URL || "http://127.0.0.1:4173";
const TEST_EMAIL = process.env.AIOVE_TEST_EMAIL || "";
const TEST_PASSWORD = process.env.AIOVE_TEST_PASSWORD || "";
const TEST_SITE = process.env.AIOVE_TEST_SITE || "footballkituk";

if (!TEST_EMAIL || !TEST_PASSWORD) {
  throw new Error("Set AIOVE_TEST_EMAIL and AIOVE_TEST_PASSWORD before running this self-check.");
}

async function wireConsoleCapture(page) {
  const consoleErrors = [];
  let sawAuthProbeUnauthorized = false;

  page.on("response", (response) => {
    if (response.status() !== 401) return;
    if (response.url().includes("/api/auth/me")) {
      sawAuthProbeUnauthorized = true;
    }
  });

  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (sawAuthProbeUnauthorized && text.includes("401 (Unauthorized)")) return;
    consoleErrors.push(text);
  });

  page.on("pageerror", (error) => {
    consoleErrors.push(error.message);
  });

  return consoleErrors;
}

async function login(page) {
  await page.goto(`${BASE_URL}/${TEST_SITE}/login`, { waitUntil: "networkidle" });
  await page.getByLabel("Email").fill(TEST_EMAIL);
  await page.getByLabel("Password").fill(TEST_PASSWORD);
  await page.getByRole("button", { name: "Enter the Arena" }).click();
  await page.locator(".chat-wrap").waitFor({ state: "visible", timeout: 20000 });
}

async function openSearch(page) {
  await page.goto(`${BASE_URL}/${TEST_SITE}/search`, { waitUntil: "networkidle" });
  await page.locator(".search-topbar").waitFor({ state: "visible", timeout: 20000 });
  await page.locator("[data-search-results]").waitFor({ state: "visible", timeout: 20000 });
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const consoleErrors = await wireConsoleCapture(page);

  try {
    await login(page);
    await openSearch(page);

    const input = page.locator("#searchInput");
    await input.waitFor({ state: "visible", timeout: 10000 });
    await input.fill("milan");
    await page.locator(".search-products-muted").waitFor({ state: "visible", timeout: 5000 });
    const productRow = page.locator(".search-product-row").first();
    await productRow.waitFor({ state: "visible", timeout: 15000 });
    const actionText = await page.locator(".search-product-action").first().innerText();
    assert.match(actionText, /View/i);

    await productRow.click();
    await page.locator("body.product-open").waitFor({ state: "attached", timeout: 10000 });
    await page.locator(".search-prod-panel").waitFor({ state: "visible", timeout: 10000 });
    const productName = (await page.locator("[data-product-panel-name]").textContent()) || "";
    assert.ok(productName.trim().length > 0, "product detail should show a non-empty name");

    await input.fill("dani");
    const characterRow = page.locator("[data-search-character]").first();
    await characterRow.waitFor({ state: "visible", timeout: 15000 });
    await characterRow.click();
    await page.locator(".chat-wrap").waitFor({ state: "visible", timeout: 20000 });

    const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const mobilePage = await mobileContext.newPage();
    const mobileConsoleErrors = await wireConsoleCapture(mobilePage);
    await login(mobilePage);
    await openSearch(mobilePage);
    const mobileInput = mobilePage.locator("#searchInput");
    await mobileInput.fill("milan");
    const mobileProductRow = mobilePage.locator(".search-product-row").first();
    await mobileProductRow.waitFor({ state: "visible", timeout: 15000 });
    await mobileProductRow.click();
    await mobilePage.locator("body.product-open").waitFor({ state: "attached", timeout: 10000 });
    await mobilePage.locator(".search-prod-panel").waitFor({ state: "visible", timeout: 10000 });
    const mobileProductName = (await mobilePage.locator("[data-product-panel-name]").textContent()) || "";
    assert.ok(mobileProductName.trim().length > 0, "mobile product detail should show a non-empty name");
    assert.deepEqual(mobileConsoleErrors, []);
    await mobileContext.close();

    assert.deepEqual(consoleErrors, []);
    console.log("search page browser self-check passed");
  } finally {
    await context.close();
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
