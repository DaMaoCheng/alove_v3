import { API_ENDPOINTS } from "../config/api-config.js";
import { requestJson } from "./http-client.js";

export function getProfile() {
  return requestJson(API_ENDPOINTS.profile).then((result) => ({
    ...result,
    profile: normalizeProfile(result.profile),
  }));
}

export function updateProfile(payload = {}) {
  return requestJson(API_ENDPOINTS.profile, {
    method: "PATCH",
    body: {
      nickname: payload.nickname || "",
      favoriteClub: payload.favoriteClub || "",
    },
  }).then((result) => ({
    ...result,
    profile: normalizeProfile(result.profile),
  }));
}

export function getProfileOrders() {
  return requestJson(API_ENDPOINTS.profileOrders).then(normalizeOrdersResult);
}

export function reconcileProfileOrders() {
  return requestJson(API_ENDPOINTS.profileOrdersReconcile, { method: "POST" });
}

export function getProfileOrderDetail(orderId = "") {
  return requestJson(`${API_ENDPOINTS.profileOrders}/${encodeURIComponent(String(orderId || ""))}`).then((result) => ({
    ...result,
    order: normalizeOrder(result.order),
  }));
}

function normalizeProfile(profile = {}) {
  return {
    id: profile.id || "",
    email: profile.email || "",
    nickname: profile.nickname || "",
    displayName: profile.displayName || profile.nickname || "AIOVE User",
    accountType: profile.accountType || "personal",
    avatarUrl: profile.avatarUrl || "",
    favoriteClub: profile.favoriteClub || "",
    stats: {
      chats: Number(profile.stats?.chats || 0),
      legends: Number(profile.stats?.legends || 0),
      kitsUnlocked: Number(profile.stats?.kitsUnlocked || 0),
    },
    invite: {
      code: profile.invite?.code || "",
      friendsJoined: Number(profile.invite?.friendsJoined || 0),
      earnedCredits: Number(profile.invite?.earnedCredits || 0),
    },
  };
}

function normalizeOrdersResult(result = {}) {
  return {
    ...result,
    provider: result.provider || "unavailable",
    account: normalizeOrderAccount(result.account),
    orders: Array.isArray(result.orders) ? result.orders.map(normalizeOrder) : [],
    hasMore: result.hasMore === true,
  };
}

function normalizeOrderAccount(account = null) {
  if (!account || typeof account !== "object") return null;
  return {
    provider: account.provider || "Shopify",
    linked: account.linked === true,
  };
}

function normalizeOrder(order = {}) {
  return {
    id: order.id || "",
    name: order.name || "",
    createdAt: order.createdAt || "",
    financialStatus: order.financialStatus || "UNKNOWN",
    fulfillmentStatus: order.fulfillmentStatus || "UNKNOWN",
    total: normalizeMoney(order.total),
    pricing: normalizeOrderPricing(order.pricing),
    shipments: Array.isArray(order.shipments) ? order.shipments.map(normalizeShipment).filter((shipment) => shipment.status || shipment.tracking.length) : [],
    unitPrice: normalizeMoney(order.unitPrice),
    itemSummary: order.itemSummary || "",
    hasMoreItems: order.hasMoreItems === true,
    items: Array.isArray(order.items) ? order.items.map((item) => ({
      title: item.title || "",
      variantTitle: item.variantTitle || "",
      quantity: Number(item.quantity || 0),
      imageUrl: normalizeOrderImageUrl(item.imageUrl),
      unitPrice: normalizeMoney(item.unitPrice),
    })) : [],
  };
}

function normalizeOrderPricing(pricing = null) {
  if (!pricing || typeof pricing !== "object") return null;
  return {
    subtotal: normalizeMoney(pricing.subtotal),
    discount: normalizeMoney(pricing.discount),
    shipping: normalizeMoney(pricing.shipping),
    tax: normalizeMoney(pricing.tax),
    total: normalizeMoney(pricing.total),
  };
}

function normalizeShipment(shipment = {}) {
  return {
    status: shipment.status || "UNKNOWN",
    tracking: Array.isArray(shipment.tracking) ? shipment.tracking.map((tracking) => ({
      company: tracking.company || "",
      number: tracking.number || "",
      url: normalizeTrackingUrl(tracking.url),
    })).filter((tracking) => tracking.company || tracking.number) : [],
  };
}

function normalizeTrackingUrl(value = "") {
  const raw = String(value || "").trim();
  if (!raw || raw.length > 2048) return "";
  try {
    const url = new URL(raw);
    return url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function normalizeOrderImageUrl(value = "") {
  const raw = String(value || "").trim();
  if (!raw || raw.length > 2048) return "";
  try {
    const url = new URL(raw);
    return url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function normalizeMoney(money = null) {
  if (!money || typeof money !== "object") return null;
  return { amount: money.amount || "", currencyCode: money.currencyCode || "" };
}
