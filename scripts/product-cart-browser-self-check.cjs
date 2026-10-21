const assert = require("node:assert/strict");
const { chromium } = require("playwright");

const BASE_URL = process.env.AIOVE_BASE_URL || "http://127.0.0.1:4173";
const CHROME_EXECUTABLE = process.env.AIOVE_CHROME_EXECUTABLE || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SITE = process.env.AIOVE_TEST_SITE || "footballkituk";
const MASCOT_ID = process.env.AIOVE_TEST_MASCOT_ID || "mascot_c938b082-d466-4c35-a4b2-0389e2d90e46";

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: CHROME_EXECUTABLE });
  try {
    const desktop = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const desktopPage = await desktop.newPage();
    const product = await verifyKitshopCart(desktopPage);
    await verifyThresholdNotice(desktopPage, product);
    await verifyInjectedSharedPanel(desktopPage, `${BASE_URL}/${SITE}/search`, ".search-page", ".search-prod-panel", product);
    await verifyInjectedSharedPanel(desktopPage, `${BASE_URL}/${SITE}/chat?agent=${encodeURIComponent(MASCOT_ID)}`, ".chat-wrap", ".chat-wrap .prod-panel", product);
    await desktop.close();

    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const mobilePage = await mobile.newPage();
    await verifyMobileCart(mobilePage);
    await mobile.close();
  } finally {
    await browser.close();
  }
  console.log("product cart browser self-check passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function verifyKitshopCart(page) {
  await page.goto(`${BASE_URL}/${SITE}/kitshop`, { waitUntil: "networkidle" });
  const card = await waitForKitshopCard(page);
  const product = JSON.parse(await card.getAttribute("data-product"));
  await card.click();
  await page.locator("body.product-open").waitFor({ state: "attached", timeout: 10000 });
  const panel = page.locator(".kitshop-prod-panel");
  await selectFirstAvailableSize(panel);
  const selectedImage = await selectNextGalleryImage(panel);
  await panel.locator('[data-product-quantity-action="increase"]').click();
  assert.equal(await panel.locator("[data-product-panel-quantity]").textContent(), "2");
  assert.match(await panel.locator("[data-product-panel-buy]").innerText(), /Add to cart/i);
  const detailPaymentCount = await panel.locator("[data-product-panel-payments] .pp-payment-method").count();
  const detailPriceNote = (await panel.locator("[data-product-panel-price-note]").textContent()).trim();
  const detailProductName = (await panel.locator("[data-product-panel-name]").textContent()).trim();
  await injectEligibleCartDiscount(page, ".kitshop-page");
  const priceBeforeDiscount = (await panel.locator("[data-product-panel-foot-price]").innerText()).trim();

  await page.evaluate(() => {
    window.__cartCheckoutCount = 0;
    document.querySelector(".kitshop-page")?.addEventListener("aiove:cart-checkout", () => {
      window.__cartCheckoutCount += 1;
    });
  });
  const urlBefore = page.url();
  const cart = page.locator("[data-product-cart-panel]");
  await assertCartIsSeparateSibling(cart, panel);
  await assertCartHeaderReusesProductPanelLayout(cart);
  const desktopCartTransition = await prepareCartOpenTransition(cart);
  await panel.locator("[data-product-panel-buy]").click();
  await cart.waitFor({ state: "visible", timeout: 5000 });
  await page.waitForFunction((cart) => cart.dataset.cartTransitionStarted === "true", desktopCartTransition, { timeout: 1200 });
  assert.equal((await panel.locator("[data-product-panel-name]").textContent()).trim(), detailProductName, "opening cart must retain the product detail DOM");
  assert.equal(await cart.locator(".product-cart-item").count(), 1);
  if (selectedImage) {
    assert.equal(
      await cart.locator(".product-cart-item img").getAttribute("src"),
      new URL(selectedImage, BASE_URL).href,
      "cart thumbnail must match the image currently selected in the product detail gallery",
    );
  }
  assert.equal(await panel.locator("[data-product-cart-count]").textContent(), "2");
  assert.notEqual((await cart.locator("[data-product-cart-subtotal]").textContent()).trim(), "—");
  assert.equal(
    await cart.locator("[data-product-cart-payments] .pp-payment-method").count(),
    detailPaymentCount,
    "cart payment methods must reuse the active product detail configuration",
  );
  assert.equal(
    (await cart.locator("[data-product-cart-price-note]").textContent()).trim(),
    detailPriceNote,
    "cart final-price note must reuse the product detail copy",
  );

  await cart.locator("[data-product-cart-close]").click();
  await page.waitForTimeout(350);
  await panel.locator("[data-product-discount-use]").click();
  const priceAfterDiscount = (await panel.locator("[data-product-panel-foot-price]").innerText()).trim();
  assert.notEqual(priceAfterDiscount, priceBeforeDiscount, "selecting an eligible offer must update the product detail price");
  await panel.locator("[data-product-cart-open]").click();
  await cart.waitFor({ state: "visible", timeout: 5000 });
  assert.equal(await cart.locator("[data-product-cart-discount]").isVisible(), true, "cart must reveal savings when an offer is selected");
  assert.equal((await cart.locator("[data-product-cart-discount-value]").textContent()).trim(), "-£0.01", "a server-confirmed USD fixed offer must display its GBP market amount in the cart");
  assert.notEqual((await cart.locator("[data-product-cart-subtotal]").textContent()).trim(), "—", "cart total must remain calculable after the discount changes");

  await cart.locator("[data-product-cart-close]").click();
  await page.waitForTimeout(350);
  const desktopHeaderCartTransition = await prepareCartOpenTransition(cart);
  await panel.locator("[data-product-cart-open]").click();
  await page.waitForFunction((cart) => cart.dataset.cartTransitionStarted === "true", desktopHeaderCartTransition, { timeout: 1200 });

  await cart.locator('[data-product-cart-item-action="increase"]').click();
  assert.equal(await cart.locator(".product-cart-quantity output").textContent(), "3");
  await cart.locator('[data-product-cart-item-action="decrease"]').click();
  assert.equal(await cart.locator(".product-cart-quantity output").textContent(), "2");
  await cart.locator("[data-product-cart-checkout]").click();
  assert.equal(await page.evaluate(() => window.__cartCheckoutCount), 0, "guest checkout must retain the existing authentication boundary");
  await page.locator('#dialogHost [role="alertdialog"]').filter({ hasText: /create an account|log in/i }).waitFor({ state: "visible", timeout: 5000 });
  assert.equal(page.url(), urlBefore, "frontend-only checkout must not navigate");
  await page.locator('#dialogHost').getByRole('button', { name: 'Close' }).click();

  await cart.locator('[data-product-cart-item-action="remove"]').click();
  assert.equal(await cart.locator(".product-cart-item").count(), 0);
  assert.equal(await cart.locator("[data-product-cart-checkout]").isDisabled(), true);
  assert.equal(
    await cart.locator("[data-product-cart-payments] .pp-payment-method").count(),
    detailPaymentCount,
    "empty cart must retain the active product detail payment configuration",
  );
  return product;
}

async function verifyInjectedSharedPanel(page, url, rootSelector, panelSelector, product) {
  await page.goto(url, { waitUntil: "networkidle" });
  await page.locator(rootSelector).waitFor({ state: "attached", timeout: 20000 });
  await page.evaluate(async ({ selector, payload }) => {
    const root = document.querySelector(selector);
    const { updateProductPanel } = await import("/src/features/chat/chat-product-panel-renderer.js");
    updateProductPanel(root, payload, { language: "English" });
    root.dataset.productPanelProduct = JSON.stringify(payload);
    document.body.classList.add("product-open");
  }, { selector: rootSelector, payload: product });
  const panel = page.locator(panelSelector);
  await panel.waitFor({ state: "visible", timeout: 10000 });
  await selectFirstAvailableSize(panel);
  const cart = page.locator("[data-product-cart-panel]");
  await assertCartIsSeparateSibling(cart, panel);
  await assertCartHeaderReusesProductPanelLayout(cart);
  const cartTransition = await prepareCartOpenTransition(cart);
  await panel.locator("[data-product-panel-buy]").click();
  await cart.waitFor({ state: "visible", timeout: 5000 });
  await page.waitForFunction((cart) => cart.dataset.cartTransitionStarted === "true", cartTransition, { timeout: 1200 });
  assert.equal(await cart.locator(".product-cart-item").count(), 1, `${url} should use the shared cart UI`);
  await cart.locator("[data-product-cart-close]").click();
}

async function verifyThresholdNotice(page, product) {
  await page.evaluate(async (payload) => {
    const cartModule = await import("/src/features/chat/chat-product-cart.js");
    const root = document.createElement("div");
    root.className = "threshold-notice-fixture";
    root.innerHTML = cartModule.productCartHtml({ pageLanguage: "English" });
    root.dataset.productPanelProduct = JSON.stringify({ ...payload, selectedDiscountOfferId: "alove2" });
    document.body.append(root);
    cartModule.bindProductCart(root, {
      language: "English",
      onItemsChange: async () => ({
        ok: true,
        mode: "synced",
        discountEvaluation: {
          state: "threshold_not_met",
          code: "ALOVE2",
          thresholdType: "subtotal",
          remainingAmount: 2,
          currencyCode: "GBP",
        },
      }),
    });
    cartModule.addCurrentProductToCart(root, { language: "English" });
  }, product);
  const fixture = page.locator(".threshold-notice-fixture");
  const notice = fixture.locator("[data-product-cart-discount-notice]");
  await notice.waitFor({ state: "visible", timeout: 5000 });
  assert.match((await notice.textContent()).trim(), /Add £2\.00 more to use ALOVE2\./, "a server-confirmed subtotal threshold must be visible above checkout");
  const positions = await fixture.locator("[data-product-cart-panel]").evaluate((panel) => {
    const noticeBox = panel.querySelector("[data-product-cart-discount-notice]")?.getBoundingClientRect();
    const scrollBox = panel.querySelector(".product-cart-scroll")?.getBoundingClientRect();
    const footBox = panel.querySelector(".product-cart-foot")?.getBoundingClientRect();
    return { noticeTop: noticeBox?.top || 0, scrollBottom: scrollBox?.bottom || 0, footTop: footBox?.top || 0 };
  });
  assert.ok(positions.noticeTop >= positions.scrollBottom - 1 && positions.noticeTop <= positions.footTop + 1, "threshold notice must sit between the scrolling cart list and checkout footer");
  await fixture.evaluate((element) => element.remove());
}

async function injectEligibleCartDiscount(page, selector) {
  await page.evaluate(async ({ selector: rootSelector }) => {
    const root = document.querySelector(rootSelector);
    const { updateProductPanel } = await import("/src/features/chat/chat-product-panel-renderer.js");
    const payload = JSON.parse(root?.dataset?.productPanelProduct || "{}");
    const discountedProduct = {
      ...payload,
      discountOffers: [{
        id: "browser-market-fixed",
        code: "TEST",
        offerDescription: "$0.01 off entire order",
        pricingPreview: {
          eligible: true,
          type: "fixed_amount",
          value: 0.01,
          currencyCode: "USD",
          marketValue: 0.01,
          marketCurrencyCode: "GBP",
          appliesOnEachItem: false,
        },
      }],
      selectedDiscountOfferId: "",
    };
    updateProductPanel(root, discountedProduct, { language: "English" });
  }, { selector });
}

async function verifyMobileCart(page) {
  await page.goto(`${BASE_URL}/${SITE}/kitshop`, { waitUntil: "networkidle" });
  const card = await waitForKitshopCard(page);
  await card.click();
  const panel = page.locator(".kitshop-prod-panel");
  await panel.waitFor({ state: "visible", timeout: 10000 });
  await selectFirstAvailableSize(panel);
  const cart = page.locator("[data-product-cart-panel]");
  await assertCartIsSeparateSibling(cart, panel);
  const mobileCartTransition = await prepareCartOpenTransition(cart);
  await panel.locator("[data-product-panel-buy]").click();
  await cart.waitFor({ state: "visible", timeout: 5000 });
  await page.waitForFunction((cart) => cart.dataset.cartTransitionStarted === "true", mobileCartTransition, { timeout: 1200 });
  await page.waitForTimeout(350);
  const [panelBox, cartBox, transform] = await Promise.all([
    panel.boundingBox(),
    cart.boundingBox(),
    cart.evaluate((element) => getComputedStyle(element).transform),
  ]);
  assert.ok(panelBox && cartBox, "mobile product and cart panels should have visible boxes");
  assert.ok(Math.abs(panelBox.x - cartBox.x) < 2 && cartBox.y >= panelBox.y, "mobile cart should independently slide above the product detail sheet");
  assert.ok(transform === "none" || transform === "matrix(1, 0, 0, 1, 0, 0)", "mobile cart should finish in the open position");
}

async function prepareCartOpenTransition(cartLocator) {
  const cart = await cartLocator.elementHandle();
  assert.ok(cart, "cart panel should exist before opening");
  await cart.evaluate((element) => {
    delete element.dataset.cartTransitionStarted;
    const markTransformTransition = (event) => {
      if (event.propertyName !== "transform") return;
      element.dataset.cartTransitionStarted = "true";
      element.removeEventListener("transitionstart", markTransformTransition);
    };
    element.addEventListener("transitionstart", markTransformTransition);
  });
  return cart;
}

async function assertCartIsSeparateSibling(cart, panel) {
  const [cartHandle, panelHandle] = await Promise.all([cart.elementHandle(), panel.elementHandle()]);
  assert.ok(cartHandle && panelHandle, "cart and product detail panels should exist");
  assert.equal(
    await cartHandle.evaluate((cartElement, productPanel) => !productPanel.contains(cartElement), panelHandle),
    true,
    "cart must be mounted outside the product detail panel rather than replacing its contents",
  );
}

async function assertCartHeaderReusesProductPanelLayout(cart) {
  const layout = await cart.locator(".pp-head").evaluate((header) => {
    const title = header.querySelector(".pp-title")?.getBoundingClientRect();
    const close = header.querySelector("[data-product-cart-close]")?.getBoundingClientRect();
    return { display: getComputedStyle(header).display, titleRight: title?.right || 0, closeLeft: close?.left || 0 };
  });
  assert.equal(layout.display, "flex", "cart header must reuse the product detail flex layout");
  assert.ok(layout.closeLeft > layout.titleRight, "cart close button must remain on the right of the title");
}

async function selectFirstAvailableSize(panel) {
  const size = panel.locator("[data-product-panel-sizes] button:not([disabled])").first();
  if (await size.count()) await size.click();
}

async function selectNextGalleryImage(panel) {
  const next = panel.locator("[data-product-panel-next]");
  if (!await next.isVisible()) return "";
  await next.click();
  return panel.evaluate((element) => {
    const root = element.closest("[data-product-panel-product]");
    const product = JSON.parse(root?.dataset?.productPanelProduct || "{}");
    return product.imageUrls?.[product.imageIndex] || "";
  });
}

async function waitForKitshopCard(page) {
  const card = page.locator(".kitshop-product-card[data-product]").first();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await card.waitFor({ state: "visible", timeout: 12000 });
      return card;
    } catch (error) {
      if (attempt === 2) throw error;
      await page.reload({ waitUntil: "networkidle" });
    }
  }
  return card;
}
