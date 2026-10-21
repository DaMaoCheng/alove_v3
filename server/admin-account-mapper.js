import { normalizeAccountType } from "./auth-service.js";
import { parseJsonValue } from "./chat-message-payload-utils.js";
import { normalizeChatAttachmentForClient, toProtectedChatImageUrl } from "./protected-upload-url-service.js";
import { parseExternalSourceContext } from "./external-source-context-service.js";
import { describeUserAgent } from "./device-info-service.js";

export function mapAccountRow(row) {
  return {
    id: row.id,
    username: row.nickname || row.username || row.email || row.id,
    email: row.email || "",
    avatarUrl: row.avatar_url || "",
    role: mapAccountRole(row.account_type),
    accountType: normalizeAccountType(row.account_type),
    siteId: row.site_id || "",
    siteName: row.site_name || "",
    siteSlug: row.site_slug || "",
    status: mapAccountStatus(row.account_status),
    statusNote: row.account_status_note || "",
    createdAt: row.created_at,
    lastActiveAt: row.last_seen_at,
    lastIp: row.last_ip || "",
    lastIpRegion: row.last_ip_region || "",
    lastIpAt: row.last_ip_at || null,
    lastLoginDevice: describeUserAgent(row.last_login_user_agent),
    balance: Number(row.balance || 0),
    rechargeBalance: Number(row.recharge_balance || 0),
    bonusBalance: Number(row.bonus_balance || 0),
    totalRecharge: Number(row.total_recharge || 0),
    totalSpentCredits: Number(row.total_spent_credits || 0),
    totalConversations: Number(row.total_conversations || 0),
    recentConversations: Number(row.recent_conversations || 0),
    activeCharacterCount: Number(row.active_character_count || 0),
    createdCharacterCount: Number(row.created_character_count || 0),
    ...mapAdminSourcePage(row.external_source_context_json),
  };
}

export function mapAdminSourcePage(value) {
  const source = parseExternalSourceContext(value);
  return {
    sourcePageUrl: source?.sourcePageUrl || "",
    sourcePageTitle: source?.sourcePageTitle || "",
    sourcePageType: source?.sourcePageType || "",
    sourceProductId: source?.sourceProductId || "",
    sourceCapturedAt: source?.capturedAt || "",
  };
}

export function mapConversationRow(row) {
  return {
    id: row.id,
    characterId: row.character_id || "",
    character: row.character_name || "未命名角色",
    role: row.role_title || "",
    imageUrl: row.avatar_url || "",
    date: row.last_message_at,
    latestText: row.latest_text || "",
    latestSenderType: row.latest_sender_type || "",
    messageCount: Number(row.message_count || 0),
    userMessageCount: Number(row.user_message_count || 0),
  };
}

export function mapConversationMessageRow(row) {
  const productPayload = parseJsonValue(row.product_payload_json, null);
  const attachment = row.content_type === "attachment"
    ? normalizeChatAttachmentForClient(productPayload)
    : null;
  const isMascotImage = row.content_type === "mascot_greeting_image" || row.content_type === "mascot_library_image";
  return {
    id: row.id,
    sender: row.sender_type === "user" ? "user" : "character",
    senderLabel: row.sender_label || "",
    contentType: row.content_type || "text",
    text: row.text_content || "",
    product: row.content_type === "product" ? normalizeAdminConversationProduct(productPayload) : null,
    feedbackAction: row.content_type === "feedback_action" ? normalizeAdminFeedbackAction(productPayload) : null,
    attachment,
    image: row.content_type === "image_generation"
      ? mapAdminConversationImage(row)
      : isMascotImage
        ? mapAdminMascotGreetingImage(productPayload)
        : null,
    deliveryStatus: row.delivery_status || "",
    sentAt: row.sent_at,
  };
}

function mapAdminMascotGreetingImage(payload) {
  const imageUrl = String(payload?.imageUrl || "").trim();
  const mediaType = String(payload?.mediaType || "").trim().toLowerCase() === "video" ? "video" : "image";
  return {
    id: String(payload?.imageId || "").trim(),
    status: imageUrl.startsWith("/uploads/mascot-greetings/") ? "ready" : "failed",
    imageUrl: imageUrl.startsWith("/uploads/mascot-greetings/") ? imageUrl : "",
    mediaType,
    mimeType: mediaType === "video" ? "video/mp4" : "image/webp",
    errorMessage: "",
  };
}

function normalizeAdminFeedbackAction(payload) {
  const action = payload && typeof payload === "object" ? payload : {};
  return {
    kind: String(action.kind || "feedback").trim() || "feedback",
    label: String(action.label || "Click here").trim() || "Click here",
  };
}

function normalizeAdminConversationProduct(payload) {
  const product = payload && typeof payload === "object" ? payload : {};
  if (!Object.keys(product).length) return null;
  const imageUrls = Array.isArray(product.imageUrls) ? product.imageUrls.filter(Boolean) : [];
  const fallbackImageUrls = [
    product.imageUrl,
    product.image_url,
    product.image,
    product.featuredImage,
    product.featured_image,
    product.thumbnail,
    ...imageUrls,
    ...(Array.isArray(product.images) ? product.images.map(extractImageUrl) : []),
    ...(Array.isArray(product.media) ? product.media.map(extractImageUrl) : []),
  ].filter(Boolean);
  return {
    name: product.name || product.title || "Product",
    subtitle: product.subtitle || product.summary || "",
    imageUrl: fallbackImageUrls[0] || "",
    priceNow: product.priceNow || product.price || "",
    priceWas: product.priceWas || "",
    url: product.url || "",
  };
}

function extractImageUrl(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value !== "object") return "";
  return value.url || value.src || value.imageUrl || value.image_url || value.preview_image?.src || "";
}

function mapAdminConversationImage(row) {
  if (!row.image_asset_id) {
    return {
      status: row.delivery_status || "",
      imageUrl: "",
      errorMessage: "",
    };
  }
  return {
    id: row.image_asset_id,
    status: row.image_status || row.delivery_status || "",
    imageUrl: toProtectedChatImageUrl(row.image_protected_path || row.image_storage_path || ""),
    width: Number(row.image_width || 0),
    height: Number(row.image_height || 0),
    bytes: Number(row.image_bytes || 0),
    mimeType: row.image_mime_type || "",
    errorMessage: row.image_error_message || "",
  };
}

function mapAccountRole(value) {
  if (value === "creator") return "创作者";
  if (value === "admin") return "运营";
  return "普通用户";
}

function mapAccountStatus(value) {
  return value === "active" ? "正常" : "封禁";
}
