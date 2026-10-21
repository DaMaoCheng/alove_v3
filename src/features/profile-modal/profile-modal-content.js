import { ICONS } from "../../icons/icons.js";
import { resolveUserDisplayName, userAvatarHtml } from "../shared-ui/user-avatar.js";
import { createSiteCopy } from "../../i18n/site-copy.js";

const PROFILE_TABS = [["profile", ICONS.user, "profile.profile"], ["invite", ICONS.ticket, "profile.invite"], ["orders", ICONS.wallet, "profile.orders"]];

// Temporarily hide the Creator Workspace entry while keeping the workspace page
// and route available for later reuse.
const SHOW_CREATOR_WORKSPACE_ENTRY = false;

export function profileModalHtml(tab = "profile", user = {}, profileState = {}, pageLanguage = "English") {
  const activeTab = normalizeProfileTab(tab);
  const copy = createSiteCopy(pageLanguage);
  return `
    <div class="pm-scrim"></div>
    <div class="pm-modal" role="dialog">
      <button class="pm-close" type="button" aria-label="${copy.t("profile.close")}">${ICONS.close}</button>
      <div class="pm-tabs">
        ${PROFILE_TABS.map(([key, icon, label]) => `<button class="pm-tab ${activeTab === key ? "active" : ""}" type="button" data-profile-tab="${key}">${icon}<span>${copy.t(label)}</span></button>`).join("")}
      </div>
      <div class="pm-body">${profileModalBodyHtml(activeTab, user, profileState, pageLanguage)}</div>
    </div>
  `;
}

export function profileModalBodyHtml(tab = "profile", user = {}, profileState = {}, pageLanguage = "English") {
  const activeTab = normalizeProfileTab(tab);
  const profile = resolveProfileData(user, profileState.data);
  const copy = createSiteCopy(pageLanguage);
  return `
    ${profileStatusHtml(profileState, copy)}
    <div class="pm-panel" data-profile-panel="profile" ${activeTab === "profile" ? "" : "hidden"}>${profileBodyHtmlDefault(profile, profileState, copy)}</div>
    <div class="pm-panel" data-profile-panel="invite" ${activeTab === "invite" ? "" : "hidden"}>${inviteBodyHtml(profile, copy)}</div>
    <div class="pm-panel" data-profile-panel="orders" ${activeTab === "orders" ? "" : "hidden"}>${ordersBodyHtml(profile, profileState.orders, copy)}</div>
  `;
}

function normalizeProfileTab(tab = "profile") {
  return tab === "invite" || tab === "orders" ? tab : "profile";
}

function resolveProfileData(user = {}, profile = null) {
  const merged = {
    ...user,
    ...(profile || {}),
  };
  return {
    ...merged,
    displayName: merged.displayName || resolveUserDisplayName(merged),
    stats: {
      chats: Number(merged.stats?.chats || 0),
      legends: Number(merged.stats?.legends || 0),
      kitsUnlocked: Number(merged.stats?.kitsUnlocked || 0),
    },
    invite: {
      code: merged.invite?.code || "",
      friendsJoined: Number(merged.invite?.friendsJoined || 0),
      earnedCredits: Number(merged.invite?.earnedCredits || 0),
    },
    siteSlug: merged.siteSlug || "gogoalshop",
  };
}

function profileStatusHtml(profileState = {}, copy) {
  if (profileState.error) return `<div class="pm-alert error">${escapeHtml(profileState.error)}</div>`;
  if (profileState.saveMessage) return `<div class="pm-alert success">${escapeHtml(profileState.saveMessage)}</div>`;
  if (profileState.loading) return `<div class="pm-alert">${copy.t("profile.loading")}</div>`;
  return "";
}

function inviteBodyHtml(profile, copy) {
  const invite = profile.invite || {};
  const code = escapeHtml(invite.code || "AIOVE-0000");
  const inviteLink = buildInviteLink(profile.siteSlug, invite.code);
  return `
    <div class="pm-lead">${copy.t("profile.inviteTitle")}</div>
    <p class="pm-note">${copy.t("profile.inviteBody")}</p>
    <div class="invite-code" id="inviteCode">
      <div class="ivc-label">${copy.t("profile.yourCode")}</div>
      <div class="ivc-row"><span class="ivc-val">${code}</span><button class="ivc-copy" type="button" data-copy-invite-code data-invite-code="${escapeAttr(invite.code || "")}">${ICONS.copy} ${copy.t("profile.copyCode")}</button></div>
      <span class="ivc-done">${copy.t("profile.copied")}</span>
    </div>
    <div class="invite-stats">
      <div class="iv-stat"><div class="v">${formatNumber(invite.friendsJoined)}</div><div class="k">${copy.t("profile.friends")}</div></div>
      <div class="iv-stat"><div class="v">${formatNumber(invite.earnedCredits)}</div><div class="k">${copy.t("profile.credits")}</div></div>
    </div>
    <div class="invite-share">
      <button class="share-btn" type="button" data-copy-invite-link data-invite-link="${escapeAttr(inviteLink)}">${ICONS.copy} ${copy.t("profile.copyLink")}</button>
      <button class="share-btn ghost is-disabled" type="button" disabled aria-disabled="true">${copy.t("profile.emailInvite")}</button>
    </div>
  `;
}

function ordersBodyHtml(profile = {}, ordersState = {}, copy) {
  const data = ordersState?.data;
  const account = data?.account;
  if (ordersState?.detailLoading || ordersState?.detail || ordersState?.detailError) {
    return orderDetailBodyHtml(ordersState, copy);
  }
  return `
    ${account ? `<section class="pm-order-account" aria-label="${copy.t("profile.boundAccount")}">
      <span class="pm-order-account-icon">${ICONS.wallet}</span>
      <div class="pm-order-account-copy">
        <div class="pm-order-label">${copy.t("profile.boundAccount")}</div>
        <div class="pm-order-account-name">${escapeHtml(account.provider || "Shopify")} · ${escapeHtml(profile.email || "")}</div>
      </div>
      <span class="pm-order-linked ${account.linked ? "" : "is-pending"}">${copy.t(account.linked ? "profile.orderLinked" : "profile.orderNotLinked")}</span>
    </section>` : ""}
    <div class="pm-orders-heading">
      <div>${copy.t("profile.orderHistory")}</div>
    </div>
    ${ordersListHtml(data, ordersState, copy)}
  `;
}

function ordersListHtml(data, ordersState, copy) {
  if (ordersState?.loading) return `<div class="pm-order-empty">${copy.t("profile.ordersLoading")}</div>`;
  if (ordersState?.error) return `<div class="pm-order-empty is-error">${escapeHtml(ordersState.error)}</div>`;
  if (data?.provider === "unavailable") return `<div class="pm-order-empty">${copy.t("profile.ordersUnavailable")}</div>`;
  if (data?.account && !data.account.linked) return `<div class="pm-order-empty">${copy.t("profile.ordersNotLinked")}</div>`;
  const orders = Array.isArray(data?.orders) ? data.orders : [];
  if (!orders.length) return `<div class="pm-order-empty">${copy.t("profile.ordersEmpty")}</div>`;
  return `<div class="pm-order-list">${orders.map((order) => orderCardHtml(order, copy)).join("")}</div>${data.hasMore ? `<div class="pm-order-limit-note">${copy.t("profile.ordersLimit")}</div>` : ""}`;
}

function orderCardHtml(order = {}, copy) {
  const status = orderStatus(order.financialStatus);
  const productTitle = orderProductTitle(order, copy);
  const productImage = orderProductImage(order);
  const remainingCount = Math.max(0, (Array.isArray(order.items) ? order.items.length : 0) - 1);
  const remainingLabel = remainingCount ? `+${remainingCount}${order.hasMoreItems ? "+" : ""}` : "";
  return `
    <div class="pm-order-card" role="button" tabindex="0" data-profile-order-id="${escapeAttr(order.id)}">
      <div class="pm-order-media" aria-hidden="true">
        ${productImage ? `<img src="${escapeAttr(productImage)}" alt="" />` : `<span class="pm-order-media-fallback">${ICONS.wallet}</span>`}
        ${remainingLabel ? `<span class="pm-order-more">${remainingLabel}</span>` : ""}
      </div>
      <div class="pm-order-copy">
        <div class="pm-order-item">${escapeHtml(productTitle)}</div>
        <div class="pm-order-date-row">
          <span class="pm-order-date">${escapeHtml(formatOrderListDate(order.createdAt, copy))}</span>
          ${order.name ? `<span class="pm-order-reference-divider" aria-hidden="true">·</span><span class="pm-order-reference">${escapeHtml(order.name)}</span>${orderCopyButtonHtml(order.name, copy)}` : ""}
        </div>
      </div>
      <div class="pm-order-side"><span class="pm-order-status ${status.className}">${copy.t(status.copyKey)}</span><strong>${escapeHtml(formatMoney(order.total))}</strong></div>
    </div>
  `;
}

function orderProductTitle(order = {}, copy) {
  const productNames = Array.isArray(order.items)
    ? order.items.map((item) => String(item?.title || "").trim()).filter(Boolean)
    : [];
  if (productNames.length) return productNames.join(" · ");
  return order.itemSummary || copy.t("profile.orderItemsUnavailable");
}

function orderProductImage(order = {}) {
  const firstItem = Array.isArray(order.items) ? order.items.find((item) => String(item?.imageUrl || "").trim()) : null;
  return firstItem?.imageUrl || "";
}

function orderDetailBodyHtml(ordersState = {}, copy) {
  if (ordersState.detailLoading) return `<div class="pm-order-empty">${copy.t("profile.orderDetailLoading")}</div>`;
  if (ordersState.detailError) return `
    <button class="pm-order-back" type="button" data-profile-orders-back>&larr; ${copy.t("profile.ordersBack")}</button>
    <div class="pm-order-empty is-error">${escapeHtml(ordersState.detailError)}</div>
  `;
  const order = ordersState.detail || {};
  const status = orderStatus(order.financialStatus);
  return `
    <button class="pm-order-back" type="button" data-profile-orders-back>&larr; ${copy.t("profile.ordersBack")}</button>
    <div class="pm-order-detail-header">
      <div class="pm-order-detail-identity">
        <div class="pm-order-detail-number-row"><div class="pm-order-detail-number">${escapeHtml(order.name || copy.t("profile.order"))}</div>${order.name ? orderCopyButtonHtml(order.name, copy) : ""}</div>
        <div class="pm-order-detail-created">${copy.t("profile.orderCreated")} · ${escapeHtml(formatOrderDateTime(order.createdAt, copy))}</div>
      </div>
      <span class="pm-order-status ${status.className}">${copy.t(status.copyKey)}</span>
    </div>
    ${orderFulfillmentHtml(order, copy)}
    ${orderPricingHtml(order, copy)}
    <div class="pm-order-detail-lines">
      ${(Array.isArray(order.items) ? order.items : []).map((item) => orderDetailLineHtml(item)).join("")}
    </div>
    ${order.hasMoreItems ? `<div class="pm-order-limit-note">${copy.t("profile.orderItemsLimit")}</div>` : ""}
  `;
}

function orderCopyButtonHtml(orderNumber = "", copy) {
  const value = String(orderNumber || "").trim();
  if (!value) return "";
  return `<button class="pm-order-copy-button" type="button" data-copy-order-number data-order-number="${escapeAttr(value)}" aria-label="${copy.t("profile.copyOrderNumber")}" data-copy-label="${copy.t("profile.copyOrderNumber")}" data-copied-label="${copy.t("profile.orderNumberCopied")}"><span class="pm-order-copy-icon pm-order-copy-default">${ICONS.copy}</span><span class="pm-order-copy-icon pm-order-copy-done">${ICONS.check}</span></button>`;
}

function orderDetailLineHtml(item = {}) {
  const title = String(item.title || "").trim();
  const variant = String(item.variantTitle || "").trim();
  const quantity = formatNumber(item.quantity);
  const imageUrl = String(item.imageUrl || "").trim();
  return `
    <div class="pm-order-detail-line">
      <div class="pm-order-detail-media" aria-hidden="true">
        ${imageUrl ? `<img src="${escapeAttr(imageUrl)}" alt="" />` : `<span>${ICONS.wallet}</span>`}
      </div>
      <div class="pm-order-detail-copy">
        <strong>${escapeHtml(title)}</strong>
        <span>${escapeHtml([variant, `× ${quantity}`].filter(Boolean).join(" · "))}</span>
      </div>
      ${item.unitPrice ? `<strong class="pm-order-detail-price">${escapeHtml(formatMoney(item.unitPrice))}</strong>` : ""}
    </div>
  `;
}

function orderFulfillmentHtml(order = {}, copy) {
  const shipments = Array.isArray(order.shipments) ? order.shipments : [];
  return `
    <section class="pm-order-fulfillment" aria-label="${copy.t("profile.orderShippingInfo")}">
      <div class="pm-order-section-label">${copy.t("profile.orderShippingInfo")}</div>
      ${shipments.length ? shipments.map((shipment) => orderShipmentHtml(shipment, copy)).join("") : `<div class="pm-order-shipment-empty">${copy.t("profile.orderShippingEmpty")}</div>`}
    </section>
  `;
}

function orderShipmentHtml(shipment = {}, copy) {
  const tracking = Array.isArray(shipment.tracking) ? shipment.tracking : [];
  return `
    <div class="pm-order-shipment">
      <span class="pm-order-shipment-status">${escapeHtml(formatShipmentStatus(shipment.status, copy))}</span>
      ${tracking.length ? `<div class="pm-order-tracking-list">${tracking.map((entry) => orderTrackingHtml(entry)).join("")}</div>` : `<span class="pm-order-shipment-empty">${copy.t("profile.orderShippingEmpty")}</span>`}
    </div>
  `;
}

function orderTrackingHtml(tracking = {}) {
  const label = [tracking.company, tracking.number].map((part) => String(part || "").trim()).filter(Boolean).join(" · ");
  if (!label) return "";
  const url = safeTrackingUrl(tracking.url);
  return url
    ? `<a class="pm-order-tracking" href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`
    : `<span class="pm-order-tracking">${escapeHtml(label)}</span>`;
}

function safeTrackingUrl(value = "") {
  const raw = String(value || "").trim();
  if (!raw || raw.length > 2048) return "";
  try {
    const url = new URL(raw);
    return url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function orderPricingHtml(order = {}, copy) {
  const pricing = order.pricing || {};
  const rows = [
    ["profile.orderSubtotal", pricing.subtotal],
    ["profile.orderDiscount", pricing.discount, true],
    ["profile.orderShipping", pricing.shipping],
    ["profile.orderTax", pricing.tax],
  ];
  return `
    <dl class="pm-order-pricing">
      ${rows.map(([label, money, isDiscount]) => `<div class="pm-order-pricing-row"><dt>${copy.t(label)}</dt><dd>${escapeHtml(formatMoney(money, copy, { negative: isDiscount }))}</dd></div>`).join("")}
      <div class="pm-order-pricing-row pm-order-pricing-total"><dt>${copy.t("profile.orderCurrentTotal")}</dt><dd>${escapeHtml(formatMoney(pricing.total || order.total, copy))}</dd></div>
    </dl>
  `;
}

function orderStatus(value = "") {
  const status = String(value || "").trim().toUpperCase();
  if (["PAID", "PARTIALLY_PAID"].includes(status)) return { className: "paid", copyKey: "profile.orderPaid" };
  if (["PENDING", "AUTHORIZED"].includes(status)) return { className: "processing", copyKey: "profile.orderPending" };
  if (["REFUNDED", "PARTIALLY_REFUNDED"].includes(status)) return { className: "refunded", copyKey: "profile.orderRefunded" };
  if (status === "VOIDED") return { className: "voided", copyKey: "profile.orderVoided" };
  return { className: "processing", copyKey: "profile.orderProcessing" };
}

function formatOrderDate(value = "", copy) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return copy.t("profile.orderDateUnavailable");
  const language = copy.t("profile.dateLocale");
  return new Intl.DateTimeFormat(language, { dateStyle: "medium" }).format(date);
}

function formatOrderListDate(value = "", copy) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return copy.t("profile.orderDateUnavailable");
  return new Intl.DateTimeFormat(copy.t("profile.dateLocale"), { month: "short", day: "numeric" }).format(date);
}

function formatOrderDateTime(value = "", copy) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return copy.t("profile.orderDateUnavailable");
  return new Intl.DateTimeFormat(copy.t("profile.dateLocale"), { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function formatShipmentStatus(value = "", copy) {
  const status = String(value || "").trim().toUpperCase();
  if (["SUCCESS", "FULFILLED"].includes(status)) return copy.t("profile.orderFulfilled");
  if (status === "IN_TRANSIT") return copy.t("profile.orderInTransit");
  if (status === "OUT_FOR_DELIVERY") return copy.t("profile.orderOutForDelivery");
  if (status === "DELIVERED") return copy.t("profile.orderDelivered");
  return copy.t("profile.orderShippingPending");
}

function formatMoney(money = null, copy = null, { negative = false } = {}) {
  const amount = Number(money?.amount);
  const currency = String(money?.currencyCode || "").trim().toUpperCase();
  if (!Number.isFinite(amount) || !currency) return "—";
  try {
    const formatted = new Intl.NumberFormat(copy?.t?.("profile.dateLocale") || undefined, { style: "currency", currency }).format(amount);
    return negative && amount > 0 ? `−${formatted}` : formatted;
  } catch {
    const formatted = `${amount.toFixed(2)} ${currency}`;
    return negative && amount > 0 ? `−${formatted}` : formatted;
  }
}

function profileBodyHtmlDefault(profile = {}, profileState = {}, copy) {
  const displayName = escapeHtml(profile.displayName || resolveUserDisplayName(profile));
  const email = escapeHtml(profile.email || "");
  const favoriteClub = escapeHtml(profile.favoriteClub || "");
  const stats = profile.stats || {};
  const canSeeCreator = profile.accountType === "creator" || profile.accountType === "admin";
  const canSeeAdmin = profile.accountType === "admin";
  const disabled = profileState.loading || profileState.saving ? "disabled" : "";
  const saveLabel = profileState.saving ? copy.t("profile.saving") : copy.t("profile.save");

  return `
    <div class="pm-avatar-row">
      <div class="pm-avatar">${userAvatarHtml({ user: profile, className: "pm-avatar-media" })}<span class="pm-cam">${ICONS.cam}</span></div>
      <div><div class="pm-name">${displayName}</div><div class="pm-sub">${copy.t("profile.signedEmail")}</div></div>
    </div>
    <div class="pm-field"><label>${copy.t("profile.displayName")}</label><input data-profile-nickname value="${displayName}" ${disabled} /></div>
    <div class="pm-field"><label>${copy.t("profile.email")}</label><input value="${email}" readonly /></div>
    <div class="pm-field"><label>${copy.t("profile.club")}</label><input data-profile-favorite-club value="${favoriteClub}" ${disabled} /></div>
    <div class="pm-stats">
      <div class="pm-stat"><div class="v">${formatNumber(stats.chats)}</div><div class="k">${copy.t("profile.chats")}</div></div>
      <div class="pm-stat"><div class="v">${formatNumber(stats.legends)}</div><div class="k">${copy.t("profile.legends")}</div></div>
      <div class="pm-stat"><div class="v">${formatNumber(stats.kitsUnlocked)}</div><div class="k">${copy.t("profile.kits")}</div></div>
    </div>
    <button class="btn btn-primary btn-block" type="button" data-profile-save ${disabled}>${saveLabel}</button>
    ${SHOW_CREATOR_WORKSPACE_ENTRY && canSeeCreator ? `<button class="pm-admin-link" type="button" data-profile-nav="creator">${ICONS.spark} Open creator workspace</button>` : ""}
    ${canSeeAdmin ? `<button class="pm-admin-link" type="button" data-profile-nav="admin">${ICONS.compass} ${copy.t("profile.admin")}</button>` : ""}
    <button class="pm-admin-link pm-logout-link" type="button" data-profile-logout>${copy.t("profile.logout")}</button>
  `;
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[char]);
}

function escapeAttr(value = "") {
  return escapeHtml(value);
}

function buildInviteLink(siteSlug = "gogoalshop", code = "") {
  const slug = String(siteSlug || "gogoalshop").trim() || "gogoalshop";
  const inviteCode = String(code || "").trim();
  const path = `/${encodeURIComponent(slug)}/register`;
  const fullPath = inviteCode ? `${path}?invite=${encodeURIComponent(inviteCode)}` : path;
  return `${getInviteOrigin()}${fullPath}`;
}

function getInviteOrigin() {
  if (typeof window === "undefined" || !window.location?.origin) return "";
  return window.location.origin;
}

function formatNumber(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return "0";
  return numeric.toLocaleString("en-US");
}
