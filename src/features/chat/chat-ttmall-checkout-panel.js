import { getTtmallAddressRegions, getTtmallCheckoutOptions, getTtmallCheckoutState, saveTtmallCheckoutAddress, submitTtmallCheckout } from "../../services/product-cart-service.js";
import { bindDropdowns, selectDropdownHtml } from "../shared-ui/dropdown.js";
import { clearProductCart } from "./chat-product-cart.js";

const TTMALL_CONSUMED_OR_UNKNOWN_CODES = new Set([
  "TTMALL_CHECKOUT_STATUS_UNKNOWN",
  "TTMALL_CHECKOUT_RESPONSE_INVALID",
  "TTMALL_ORDER_RESPONSE_INVALID",
  "TTMALL_CART_SELECTION_INVALID",
  "TTMALL_CART_REQUIRED",
]);

export function ttmallCheckoutPanelHtml() {
  return `
    <section class="ttmall-checkout-panel" data-ttmall-checkout-panel hidden aria-label="TTMall checkout">
      <div class="ttmall-checkout-backdrop" data-ttmall-checkout-close></div>
      <div class="ttmall-checkout-dialog" role="dialog" aria-modal="true" aria-labelledby="ttmall-checkout-title">
        <header><h2 id="ttmall-checkout-title">Confirm your TTMall order</h2><button type="button" class="icon-btn" data-ttmall-checkout-close aria-label="Close">×</button></header>
        <div class="ttmall-checkout-body" data-ttmall-checkout-body></div>
      </div>
    </section>`;
}

export function bindTtmallCheckoutPanel(root, { language = "" } = {}) {
  const panel = root.querySelector("[data-ttmall-checkout-panel]");
  if (!panel || panel.dataset.bound === "true") return;
  panel.dataset.bound = "true";
  panel.querySelectorAll("[data-ttmall-checkout-close]").forEach((button) => {
    button.addEventListener("click", () => closeTtmallCheckoutPanel(root));
  });
}

export async function openTtmallCheckoutPanel(root, { siteSlug = "", language = "" } = {}) {
  const panel = root.querySelector("[data-ttmall-checkout-panel]");
  const body = panel?.querySelector("[data-ttmall-checkout-body]");
  if (!panel || !body) throw new Error("TTMall checkout panel is unavailable");
  panel.hidden = false;
  panel.dataset.siteSlug = siteSlug;
  body.innerHTML = `<p class="ttmall-checkout-state">Loading your TTMall checkout…</p>`;
  try {
    const state = await getTtmallCheckoutState({ siteSlug });
    panel._ttmallState = state;
    panel._ttmallSelectedAddressId = state.defaultAddressId || "";
    renderCheckout(root, language);
    const addressId = state.defaultAddressId || "";
    if (addressId) await loadOptions(root, addressId, language);
  } catch (error) {
    renderCheckoutError(root, error, language);
  }
}

export function closeTtmallCheckoutPanel(root) {
  const panel = root.querySelector("[data-ttmall-checkout-panel]");
  if (!panel) return;
  panel.hidden = true;
  panel._ttmallState = null;
  panel._ttmallOptions = null;
  panel._ttmallSelectedAddressId = "";
}

async function loadOptions(root, addressId, language) {
  const panel = root.querySelector("[data-ttmall-checkout-panel]");
  const body = panel?.querySelector("[data-ttmall-checkout-body]");
  if (!panel || !body || !addressId) return;
  const previous = panel._ttmallState;
  body.querySelector("[data-ttmall-checkout-options]")?.replaceChildren(document.createTextNode("Loading delivery and payment options…"));
  try {
    panel._ttmallOptions = await getTtmallCheckoutOptions({ siteSlug: panel.dataset.siteSlug, addressId });
    renderCheckout(root, language);
  } catch (error) {
    panel._ttmallOptions = { error: error?.message || "TTMall delivery options are unavailable." };
    renderCheckout(root, language);
  }
  panel._ttmallState = previous;
}

function renderCheckout(root, language) {
  const panel = root.querySelector("[data-ttmall-checkout-panel]");
  const body = panel?.querySelector("[data-ttmall-checkout-body]");
  const state = panel?._ttmallState || {};
  if (!body) return;
  const addresses = Array.isArray(state.addresses) ? state.addresses : [];
  const selected = panel?._ttmallSelectedAddressId || state.defaultAddressId || addresses[0]?.id || "";
  const options = panel?._ttmallOptions || null;
  body.innerHTML = `
    <div class="ttmall-checkout-field"><span>Delivery address</span>
      <div data-ttmall-checkout-address>
        ${selectDropdownHtml({
          name: "addressId",
          value: selected,
          items: addresses.map((address) => [address.id, formatAddress(address)]),
          placeholder: "No saved TTMall address",
          floating: true,
        })}
      </div>
    </div>
    <button type="button" class="btn btn-ghost btn-block" data-ttmall-checkout-change-address>Add delivery address</button>
    <div data-ttmall-checkout-options>${renderOptions(options)}</div>
  `;
  bindDropdowns(body);
  const addressInput = body.querySelector("[data-ttmall-checkout-address] [data-dd-input]");
  const addressTrigger = body.querySelector("[data-ttmall-checkout-address] [data-dd-trigger]");
  if (!addresses.length && addressTrigger) addressTrigger.disabled = true;
  addressInput?.addEventListener("change", () => {
    panel._ttmallSelectedAddressId = addressInput.value;
    void loadOptions(root, addressInput.value, language);
  });
  body.querySelector("[data-ttmall-checkout-change-address]")?.addEventListener("click", () => {
    void renderAddressForm(root, language);
  });
  body.querySelector("[data-ttmall-checkout-submit]")?.addEventListener("submit", (event) => {
    event.preventDefault();
    void submitCheckout(root, language);
  });
}

async function renderAddressForm(root, language) {
  const panel = root.querySelector("[data-ttmall-checkout-panel]");
  const body = panel?.querySelector("[data-ttmall-checkout-body]");
  if (!panel || !body) return;
  body.innerHTML = `<p class="ttmall-checkout-state">Loading address regions…</p>`;
  try {
    const result = await getTtmallAddressRegions({ siteSlug: panel.dataset.siteSlug });
    const zones = Array.isArray(result.zones) ? result.zones : [];
    panel._ttmallRegions = zones;
    body.innerHTML = addressFormHtml(zones);
    bindDropdowns(body);
    const form = body.querySelector("[data-ttmall-address-form]");
    bindAddressRegionSelectors(form, zones);
    form?.addEventListener("submit", (event) => {
      event.preventDefault();
      void saveAddress(root, event.currentTarget, language);
    });
    body.querySelector("[data-ttmall-checkout-back]")?.addEventListener("click", () => renderCheckout(root, language));
  } catch (error) {
    body.innerHTML = `<p class="ttmall-checkout-error">${escapeHtml(error?.message || "TTMall address regions are unavailable.")}</p>`;
  }
}

function addressFormHtml(zones = []) {
  const countries = zones.flatMap((zone) => zone.countries || []);
  return `<form data-ttmall-address-form>
    <h3>Add a TTMall delivery address</h3>
    <div data-ttmall-address-regions>${addressRegionFieldsHtml(zones)}</div>
    <div class="ttmall-checkout-grid"><label class="ttmall-checkout-field">First name<input name="firstName" required maxlength="255"></label><label class="ttmall-checkout-field">Last name<input name="lastName" required maxlength="255"></label></div>
    <label class="ttmall-checkout-field">Address line<input name="line" required maxlength="255"></label>
    <div class="ttmall-checkout-grid"><label class="ttmall-checkout-field">City<input name="city" maxlength="128"></label><label class="ttmall-checkout-field">Postcode<input name="postcode" required maxlength="64"></label></div>
    <div class="ttmall-checkout-grid"><label class="ttmall-checkout-field">Phone<input name="phone" required maxlength="64"></label><label class="ttmall-checkout-field">Email<input name="email" type="email" required maxlength="254"></label></div>
    <label class="ttmall-checkout-check"><input type="checkbox" name="isDefault"> <span>Set as default address</span></label>
    <button class="btn btn-primary btn-block" type="submit" ${countries.length ? "" : "disabled"}>Save address</button>
    <button class="btn btn-ghost btn-block" type="button" data-ttmall-checkout-back>Cancel</button>
  </form>`;
}

function addressRegionFieldsHtml(zones = [], selection = {}) {
  const zone = zones.find((item) => String(item.id) === String(selection.zoneId)) || zones[0] || {};
  const countries = Array.isArray(zone.countries) ? zone.countries : [];
  const country = countries.find((item) => String(item.id) === String(selection.countryId)) || countries[0] || {};
  const states = Array.isArray(country.states) ? country.states : [];
  const state = states.find((item) => String(item.id) === String(selection.stateId)) || states[0] || {};
  return `
    <div class="ttmall-checkout-field"><span>Zone</span>${selectDropdownHtml({ name: "zoneId", value: zone.id || "", items: zones.map((item) => [item.id, item.name]), placeholder: "Select a zone", floating: true })}</div>
    <div class="ttmall-checkout-field"><span>Country</span>${selectDropdownHtml({ name: "countryId", value: country.id || "", items: countries.map((item) => [item.id, item.name]), placeholder: "Select a country", floating: true })}</div>
    <div class="ttmall-checkout-field"><span>State or region</span>${selectDropdownHtml({ name: "stateId", value: state.id || "", items: states.map((item) => [item.id, item.name]), placeholder: "Select a state or region", floating: true })}</div>
  `;
}

function bindAddressRegionSelectors(form, zones) {
  if (!form) return;
  const regionRoot = form.querySelector("[data-ttmall-address-regions]");
  const refresh = (selection = {}) => {
    if (!regionRoot) return;
    regionRoot.innerHTML = addressRegionFieldsHtml(zones, selection);
    bindDropdowns(regionRoot);
    bindAddressRegionSelectors(form, zones);
  };
  const zoneInput = form.querySelector('[name="zoneId"]');
  const countryInput = form.querySelector('[name="countryId"]');
  zoneInput?.addEventListener("change", () => refresh({ zoneId: zoneInput.value }));
  countryInput?.addEventListener("change", () => refresh({ zoneId: zoneInput.value, countryId: countryInput.value }));
}

async function saveAddress(root, form, language) {
  const panel = root.querySelector("[data-ttmall-checkout-panel]");
  if (!panel) return;
  const data = new FormData(form);
  const zoneId = String(data.get("zoneId") || "");
  const countryId = String(data.get("countryId") || "");
  const stateId = String(data.get("stateId") || "");
  const countryZoneId = findCountryZoneId(panel._ttmallRegions, countryId);
  if (countryZoneId && countryZoneId !== zoneId) {
    form.insertAdjacentHTML("beforeend", `<p class="ttmall-checkout-error">Choose a country that belongs to the selected zone.</p>`);
    return;
  }
  if (!stateId || findStateCountryId(panel._ttmallRegions, stateId) !== countryId) {
    form.insertAdjacentHTML("beforeend", `<p class="ttmall-checkout-error">Choose a state or region that belongs to the selected country.</p>`);
    return;
  }
  try {
    await saveTtmallCheckoutAddress({
      siteSlug: panel.dataset.siteSlug,
      address: { ...Object.fromEntries([...data.entries()].map(([key, value]) => [key, value])), isDefault: data.get("isDefault") === "on" },
    });
    const state = await getTtmallCheckoutState({ siteSlug: panel.dataset.siteSlug });
    panel._ttmallState = state;
    panel._ttmallSelectedAddressId = state.defaultAddressId || "";
    panel._ttmallOptions = null;
    renderCheckout(root, language);
    if (panel._ttmallSelectedAddressId) await loadOptions(root, panel._ttmallSelectedAddressId, language);
  } catch (error) {
    form.insertAdjacentHTML("beforeend", `<p class="ttmall-checkout-error">${escapeHtml(error?.message || "TTMall could not save this address.")}</p>`);
  }
}

function renderOptions(options) {
  if (!options) return `<p class="ttmall-checkout-state">Choose an address to load delivery options.</p>`;
  if (options.error) return `<p class="ttmall-checkout-error">${escapeHtml(options.error)}</p>`;
  const shipping = Array.isArray(options.shipping) ? options.shipping : [];
  const payments = Array.isArray(options.payments) ? options.payments : [];
  return `
    <form data-ttmall-checkout-submit>
      <div class="ttmall-checkout-field"><span>Shipping method</span>
        ${selectDropdownHtml({ name: "shippingId", value: shipping[0]?.id || "", items: shipping.map((item) => [item.id, `${item.name}${item.price ? ` · ${item.price}` : ""}`]), placeholder: "No shipping method available", floating: true })}
      </div>
      <div class="ttmall-checkout-field"><span>Payment method</span>
        ${selectDropdownHtml({ name: "paymentId", value: payments[0]?.id || "", items: payments.map((item) => [item.id, item.name]), placeholder: "No payment method available", floating: true })}
      </div>
      <label class="ttmall-checkout-field">Order note <textarea name="message" maxlength="500" placeholder="Optional"></textarea></label>
      <button class="btn btn-primary btn-block" type="submit" ${shipping.length && payments.length ? "" : "disabled"}>Create TTMall order</button>
    </form>`;
}

async function submitCheckout(root, language) {
  const panel = root.querySelector("[data-ttmall-checkout-panel]");
  const form = panel?.querySelector("[data-ttmall-checkout-submit]");
  const addressId = panel?.querySelector("[data-ttmall-checkout-address] [data-dd-input]")?.value || "";
  if (!panel || !form || !addressId) return;
  const submit = form.querySelector("button[type=submit]");
  if (submit) submit.disabled = true;
  try {
    const result = await submitTtmallCheckout({
      siteSlug: panel.dataset.siteSlug, addressId,
      shippingId: new FormData(form).get("shippingId"), paymentId: new FormData(form).get("paymentId"), message: new FormData(form).get("message"),
    });
    if (result?.cartConsumed) clearProductCart(root, { language });
    if (result?.ok !== false) window.dispatchEvent(new CustomEvent("aiove:ttmall-order-created"));
    if (result?.mode === "redirect" && result.redirectUrl) window.location.assign(result.redirectUrl);
    else renderCheckoutResult(root, result?.message || "TTMall checkout completed.", { failed: result?.paymentOutcome === "failed" });
  } catch (error) {
    renderCheckoutError(root, error, language);
  } finally {
    if (submit && !panel?.querySelector("[data-ttmall-checkout-result]")) submit.disabled = false;
  }
}

function renderCheckoutResult(root, message, { failed = false } = {}) {
  const body = root.querySelector("[data-ttmall-checkout-body]");
  if (!body) return;
  body.innerHTML = `<p class="${failed ? "ttmall-checkout-error" : "ttmall-checkout-state"}" data-ttmall-checkout-result>${escapeHtml(message)}</p>`;
}

function renderCheckoutError(root, error, language) {
  const body = root.querySelector("[data-ttmall-checkout-body]");
  if (!body) return;
  const code = String(error?.payload?.code || "");
  const discardCart = TTMALL_CONSUMED_OR_UNKNOWN_CODES.has(code);
  if (discardCart) clearProductCart(root, { language });
  const message = escapeHtml(error?.message || "TTMall checkout could not be confirmed.");
  const nextStep = discardCart ? "<p class=\"ttmall-checkout-state\">Your ALOVE cart was cleared to prevent a duplicate order. Add the item again before another checkout.</p>" : "";
  body.innerHTML = `<p class="ttmall-checkout-error" data-ttmall-checkout-result>${message}</p>${nextStep}`;
}

function formatAddress(address = {}) { return [address.tag, [address.firstName, address.lastName].filter(Boolean).join(" "), address.line, address.city, address.country].filter(Boolean).join(" · "); }
function findCountryZoneId(zones, countryId) {
  return (Array.isArray(zones) ? zones : []).find((zone) => (zone.countries || []).some((country) => String(country.id) === String(countryId)))?.id || "";
}
function findStateCountryId(zones, stateId) {
  for (const zone of Array.isArray(zones) ? zones : []) {
    for (const country of zone.countries || []) {
      if ((country.states || []).some((state) => String(state.id) === String(stateId))) return String(country.id);
    }
  }
  return "";
}
function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]); }
function escapeAttr(value) { return escapeHtml(value); }
