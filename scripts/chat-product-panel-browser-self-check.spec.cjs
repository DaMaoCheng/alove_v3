const { test, expect } = require("@playwright/test");

const BASE_URL = process.env.AIOVE_BASE_URL || "http://127.0.0.1:4173";
const TEST_EMAIL = process.env.AIOVE_TEST_EMAIL || "";
const TEST_PASSWORD = process.env.AIOVE_TEST_PASSWORD || "";
const TEST_SITE = process.env.AIOVE_TEST_SITE || "footballkituk";

test("chat product panel keeps state, switches products, and supports gallery controls", async ({ page }) => {
  if (!TEST_EMAIL || !TEST_PASSWORD) {
    throw new Error("Set AIOVE_TEST_EMAIL and AIOVE_TEST_PASSWORD before running this self-check.");
  }

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

  await page.goto(`${BASE_URL}/${TEST_SITE}/login`);
  await page.getByLabel("Email").fill(TEST_EMAIL);
  await page.getByLabel("Password").fill(TEST_PASSWORD);
  await page.getByRole("button", { name: "Enter the Arena" }).click();

  await expect(page.locator(".chat-wrap")).toBeVisible({ timeout: 20000 });
  await expect(page.locator(".ch-name")).toContainText(/Dani Ultra|Millie|Kit/i, { timeout: 20000 });

  const multiImageCard = page.locator(".product-card").filter({ hasText: "Player Version England Away Football Shirt 2026" }).last();
  await expect(multiImageCard).toBeVisible({ timeout: 20000 });
  await multiImageCard.scrollIntoViewIfNeeded();
  await multiImageCard.click();

  const panel = page.locator(".prod-panel");
  await expect(panel).toBeVisible();
  await expect(page.locator("body")).toHaveClass(/product-open/);
  await expect(panel.locator("[data-product-panel-name]")).toHaveText("Player Version England Away Football Shirt 2026");
  await expect(panel.locator("[data-product-panel-count]")).toHaveText("1/8");

  const input = page.locator("#msgInput");
  await input.fill(`Part1 browser persistence ${Date.now()}`);
  await page.locator(".composer .send").click();
  await expect(page.locator("body")).toHaveClass(/product-open/);
  await expect(panel.locator("[data-product-panel-name]")).toHaveText("Player Version England Away Football Shirt 2026");
  await expect(panel.locator("[data-product-panel-count]")).toHaveText("1/8");

  await panel.locator("[data-product-panel-next]").click();
  await expect(panel.locator("[data-product-panel-count]")).toHaveText("2/8");

  const hero = panel.locator(".pp-hero");
  const box = await hero.boundingBox();
  if (!box) throw new Error("Product gallery hero is not measurable.");
  await page.mouse.move(box.x + box.width * 0.72, box.y + box.height * 0.48);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.24, box.y + box.height * 0.48, { steps: 8 });
  const draggingTransform = await panel.locator("[data-product-panel-track]").evaluate((node) => node.style.transform);
  expect(draggingTransform).toMatch(/px\)/);
  await page.mouse.up();
  await expect(panel.locator("[data-product-panel-count]")).toHaveText("3/8");

  const singleImageCard = page.locator(".product-card").filter({ hasText: "Retro 2009/10 AC Milan Home Football Shirt" }).last();
  await expect(singleImageCard).toBeVisible({ timeout: 20000 });
  await singleImageCard.scrollIntoViewIfNeeded();
  await singleImageCard.click();
  await expect(panel.locator("[data-product-panel-name]")).toHaveText("Retro 2009/10 AC Milan Home Football Shirt");
  await expect(panel.locator("[data-product-panel-count]")).toBeHidden();

  await page.locator(".pp-close").click();
  await expect(page.locator("body")).not.toHaveClass(/product-open/);
  expect(consoleErrors).toEqual([]);
});
