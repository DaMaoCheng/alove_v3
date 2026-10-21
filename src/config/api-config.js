export const API_ENDPOINTS = Object.freeze({
  site: Object.freeze({
    resolve: "/api/site/resolve",
    branding: "/api/site/branding",
  }),
  auth: Object.freeze({
    login: "/api/auth/login",
    register: "/api/auth/register",
    checkEmail: "/api/auth/email/check",
    sendEmailCode: "/api/auth/email/send-code",
    resetPassword: "/api/auth/forgot-password/reset",
    me: "/api/auth/me",
    logout: "/api/auth/logout",
  }),
  profile: "/api/profile",
  profileOrders: "/api/profile/orders",
  profileOrdersReconcile: "/api/profile/orders/reconcile",
  feedback: "/api/feedback",
  billing: Object.freeze({
    balance: "/api/balance",
    paymentStatus: "/api/payments/status",
  }),
  characters: Object.freeze({
    list: "/api/characters",
    detail: "/api/characters",
    messages: "/api/characters",
    quickReplies: "/api/characters",
    polish: "/api/characters/polish",
    generateAvatar: "/api/characters/generate-avatar",
  }),
  home: Object.freeze({
    carousel: "/api/home/carousel",
  }),
  kitshop: "/api/kitshop",
  products: Object.freeze({
    search: "/api/products/search",
    resolve: "/api/products/resolve",
    checkoutLink: "/api/products/checkout-link",
    ttmallCartSync: "/api/product-cart/ttmall/sync",
    shopifyCartReady: "/api/product-cart/shopify/ready",
    shopifyCartSync: "/api/product-cart/shopify/sync",
    shopifyCartCheckout: "/api/product-cart/shopify/checkout",
  }),
  ttmallBinding: Object.freeze({
    status: "/api/ttmall-account-binding",
    captcha: "/api/ttmall-account-binding/captcha",
    login: "/api/ttmall-account-binding/login",
    register: "/api/ttmall-account-binding/register",
  }),
  ttmallCheckout: Object.freeze({
    state: "/api/ttmall-checkout/state",
    addressRegions: "/api/ttmall-checkout/address-regions",
    options: "/api/ttmall-checkout/options",
    address: "/api/ttmall-checkout/address",
    submit: "/api/ttmall-checkout/submit",
  }),
  chat: Object.freeze({
    contacts: "/api/chat/contacts",
  }),
  upload: Object.freeze({
    avatar: "/api/uploads/avatar",
    avatarModerate: "/api/uploads/avatar/moderate",
    chatAttachment: "/api/uploads/chat",
  }),
  admin: Object.freeze({
    errorLogs: "/api/admin/error-logs",
    feedback: "/api/admin/feedback",
    kitshop: "/api/admin/kitshop",
    kitshopRefresh: "/api/admin/kitshop/refresh",
    productAnalyticsOverview: "/api/admin/analytics/product-overview",
    accounts: "/api/admin/accounts",
    sites: "/api/admin/sites",
    externalEmbeds: "/api/admin/external-embeds",
    geoRegionsSearch: "/api/admin/geo-regions/search",
    knowledgeBases: "/api/admin/knowledge-bases",
    mascot: "/api/admin/mascot",
    characters: "/api/admin/characters",
    carousel: "/api/admin/carousel",
    carouselUpload: "/api/admin/carousel/upload",
    promotionCampaigns: "/api/admin/promotion-campaigns",
    promotionCampaignProducts: "/api/admin/promotion-campaigns/products",
    discountCodes: "/api/admin/discount-codes",
    discountCodeOptions: "/api/admin/discount-codes/options",
    discountCodeShopifySearch: "/api/admin/discount-codes/shopify-search",
  }),
  analytics: Object.freeze({
    productEvents: "/api/analytics/product-events",
  }),
  creator: Object.freeze({
    analytics: "/api/creator/analytics",
  }),
});

export const BILLING_PLANS = Object.freeze([
  Object.freeze({ id: "pack_10", rmbAmount: 10, credits: 100 }),
  Object.freeze({ id: "pack_100", rmbAmount: 25, credits: 260 }),
  Object.freeze({ id: "pack_50", rmbAmount: 50, credits: 520 }),
]);

export function getApiBaseUrl() {
  const runtimeBase = String(window.AIOVE_API_BASE_URL || "").trim();
  if (runtimeBase) return runtimeBase.replace(/\/+$/, "");

  const storedBase = readSameOriginStoredApiBaseUrl();
  if (storedBase) return storedBase.replace(/\/+$/, "");

  return "";
}

function readSameOriginStoredApiBaseUrl() {
  try {
    const storedBase = String(window.localStorage?.getItem("aiove_api_base_url") || "").trim();
    if (!storedBase) return "";
    const storedUrl = new URL(storedBase, window.location.origin);
    if (storedUrl.origin !== window.location.origin) return "";
    return storedBase.replace(/\/+$/, "");
  } catch {
    return "";
  }
}

export function buildApiUrl(path) {
  const baseUrl = getApiBaseUrl();
  const normalizedPath = String(path || "").startsWith("/") ? String(path || "") : `/${path || ""}`;
  return `${baseUrl}${normalizedPath}`;
}
