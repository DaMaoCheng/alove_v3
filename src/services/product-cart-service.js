import { API_ENDPOINTS } from "../config/api-config.js";
import { requestJson } from "./http-client.js";

export function syncTtmallProductCart({ siteSlug = "", items = [], signal } = {}) {
  return requestJson(API_ENDPOINTS.products.ttmallCartSync, {
    method: "POST",
    signal,
    body: { siteSlug, items: Array.isArray(items) ? items : [] },
  });
}

export function getTtmallCheckoutState({ siteSlug = "", signal } = {}) {
  return requestJson(`${API_ENDPOINTS.ttmallCheckout.state}?siteSlug=${encodeURIComponent(siteSlug)}`, { signal });
}

export function getTtmallCheckoutOptions({ siteSlug = "", addressId = "", signal } = {}) {
  const params = new URLSearchParams({ siteSlug, addressId });
  return requestJson(`${API_ENDPOINTS.ttmallCheckout.options}?${params.toString()}`, { signal });
}

export function getTtmallAddressRegions({ siteSlug = "", signal } = {}) {
  return requestJson(`${API_ENDPOINTS.ttmallCheckout.addressRegions}?siteSlug=${encodeURIComponent(siteSlug)}`, { signal });
}

export function saveTtmallCheckoutAddress({ siteSlug = "", addressId = "", address = {}, signal } = {}) {
  const path = addressId ? `${API_ENDPOINTS.ttmallCheckout.address}/${encodeURIComponent(addressId)}` : API_ENDPOINTS.ttmallCheckout.address;
  return requestJson(path, { method: addressId ? "PUT" : "POST", signal, body: { siteSlug, address } });
}

export function submitTtmallCheckout({ siteSlug = "", addressId = "", shippingId = "", paymentId = "", billingAddressId = "", message = "", signal } = {}) {
  return requestJson(API_ENDPOINTS.ttmallCheckout.submit, { method: "POST", signal, body: { siteSlug, addressId, shippingId, paymentId, billingAddressId, message } });
}

export function syncShopifyProductCart({ siteSlug = "", items = [], signal } = {}) {
  return requestJson(API_ENDPOINTS.products.shopifyCartSync, { method: "POST", signal, body: { siteSlug, items: Array.isArray(items) ? items : [] } });
}

export function getShopifyProductCartReadiness({ siteSlug = "", signal } = {}) {
  return requestJson(API_ENDPOINTS.products.shopifyCartReady, { method: "POST", signal, body: { siteSlug } });
}

export function checkoutShopifyProductCart({ siteSlug = "", signal } = {}) {
  return requestJson(API_ENDPOINTS.products.shopifyCartCheckout, { method: "POST", signal, body: { siteSlug } });
}
