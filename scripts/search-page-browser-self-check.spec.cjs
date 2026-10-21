const { test, expect } = require("@playwright/test");

const BASE_URL = process.env.AIOVE_BASE_URL || "http://127.0.0.1:4173";
const TEST_EMAIL = process.env.AIOVE_TEST_EMAIL || "";
const TEST_PASSWORD = process.env.AIOVE_TEST_PASSWORD || "";
const TEST_SITE = process.env.AIOVE_TEST_SITE || "footballkituk";

function wireConsoleCapture(page) {
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
  await page.goto(`${BASE_URL}/${TEST_SITE}/login`);
  await page.getByLabel("Email").fill(TEST_EMAIL);
  await page.getByLabel("Password").fill(TEST_PASSWORD);
  await page.getByRole("button", { name: "Enter the Arena" }).click();
  await expect(page.locator(".chat-wrap")).toBeVisible({ timeout: 20000 });
}

async function openSearch(page) {
  await page.goto(`${BASE_URL}/${TEST_SITE}/search`);
  await expect(page.locator(".search-topbar")).toBeVisible({ timeout: 20000 });
  await expect(page.locator("[data-search-results]")).toBeVisible({ timeout: 20000 });
}

test("search page split keeps desktop and mobile flows intact", async ({ page }) => {
  if (!TEST_EMAIL || !TEST_PASSWORD) {
    throw new Error("Set AIOVE_TEST_EMAIL and AIOVE_TEST_PASSWORD before running this self-check.");
  }

  const consoleErrors = wireConsoleCapture(page);

  await login(page);
  await openSearch(page);

  const input = page.locator("#searchInput");
  await expect(input).toBeFocused();
  await expect(page.locator(".search-tag").first()).toBeVisible();

  await input.fill("milan");
  await expect(page.locator(".search-products-muted")).toContainText("Searching products...", { timeout: 5000 });
  const productRow = page.locator(".search-product-row").first();
  await expect(productRow).toBeVisible({ timeout: 15000 });
  await expect(page.locator(".search-product-action").first()).toContainText("View");

  await productRow.click();
  await expect(page.locator("body")).toHaveClass(/product-open/);
  await expect(page.locator(".search-prod-panel")).toBeVisible();
  await expect(page.locator("[data-product-panel-name]")).not.toHaveText("", { timeout: 5000 });

  await input.fill("dani");
  const characterRow = page.locator("[data-search-character]").first();
  await expect(characterRow).toBeVisible({ timeout: 15000 });
  await characterRow.click();
  await expect(page.locator(".chat-wrap")).toBeVisible({ timeout: 20000 });

  await page.setViewportSize({ width: 390, height: 844 });
  await openSearch(page);

  const mobileInput = page.locator("#searchInput");
  await mobileInput.fill("milan");
  const mobileProductRow = page.locator(".search-product-row").first();
  await expect(mobileProductRow).toBeVisible({ timeout: 15000 });
  await mobileProductRow.click();
  await expect(page.locator("body")).toHaveClass(/product-open/);
  await expect(page.locator(".search-prod-panel")).toBeVisible();
  await expect(page.locator("[data-product-panel-name]")).not.toHaveText("", { timeout: 5000 });

  expect(consoleErrors).toEqual([]);
});
