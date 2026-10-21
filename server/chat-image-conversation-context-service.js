const IMAGE_MESSAGE_TYPES = new Set([
  "attachment",
  "image_generation",
  "mascot_greeting_image",
  "mascot_library_image",
]);

// Evidence for resolving an elliptical request, never permission to send an image.
// Welcome images and product/user pictures cannot establish a character-photo turn.
export function resolveCharacterImageFollowupContext(context = null) {
  const recent = Array.isArray(context?.recentConversation) ? context.recentConversation.slice(-6) : [];
  let followup = null;
  const priorRequestTexts = [];
  for (let index = recent.length - 1; index >= 0; index -= 1) {
    const image = recent[index];
    if (!IMAGE_MESSAGE_TYPES.has(image?.kind) && image?.kind !== "product") continue;
    if (image.role !== "assistant" || !["image_generation", "mascot_library_image"].includes(image.kind)) break;
    const request = recent.slice(0, index).reverse().find((item) => item.role === "user");
    const requestText = String(request?.text || "").slice(0, 600).trim();
    if (!requestText) break;
    if (!followup) followup = { imageKind: image.kind, requestText };
    else if (requestText !== followup.requestText && !priorRequestTexts.includes(requestText)) priorRequestTexts.push(requestText);
  }
  return followup && { ...followup, ...(priorRequestTexts.length ? { priorRequestTexts } : {}) };
}

export async function resolveRecentImageConversationContext(db, {
  sessionId = "",
  beforeDisplayOrder = 0,
  limit = 20,
} = {}) {
  const normalizedSessionId = String(sessionId || "").trim();
  const safeOrder = Number(beforeDisplayOrder || 0);
  if (!normalizedSessionId || !safeOrder) return emptyContext();

  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 50));
  const [rows] = await db.execute(
    `SELECT sender_type, content_type, text_content, product_payload_json
       FROM chat_messages
      WHERE session_id = ?
        AND display_order < ?
      ORDER BY display_order DESC, sent_at DESC
      LIMIT ${safeLimit}`,
    [normalizedSessionId, safeOrder]
  );

  let hasRecentImage = false;
  let hasRecentUserImage = false;
  let hasRecentProductImage = false;
  let hasRecentCharacterImage = false;
  let recentImageCount = 0;
  let latestImageKind = "";

  for (const row of rows) {
    const contentType = String(row?.content_type || "").trim().toLowerCase();
    const payload = parseJson(row?.product_payload_json);
    const payloadHasImage = Boolean(resolveImageUrl(payload));
    const isImageMessage = IMAGE_MESSAGE_TYPES.has(contentType) || (contentType === "product" && payloadHasImage);
    if (!isImageMessage) continue;
    if (!latestImageKind) latestImageKind = contentType === "product" ? "product" : contentType === "attachment" ? "user_upload" : "character";
    hasRecentImage = true;
    recentImageCount += 1;
    if (contentType === "attachment" && String(row?.sender_type || "").toLowerCase() === "user") {
      hasRecentUserImage = true;
    }
    if (contentType === "product" && payloadHasImage) hasRecentProductImage = true;
    if (contentType === "image_generation" || contentType === "mascot_greeting_image" || contentType === "mascot_library_image") {
      hasRecentCharacterImage = true;
    }
  }

  return {
    hasRecentImage,
    hasRecentUserImage,
    hasRecentProductImage,
    hasRecentCharacterImage,
    recentImageCount,
    latestImageKind,
    recentConversation: rows.slice(0, 6).reverse().map((row) => ({
      role: row.sender_type === "user" ? "user" : "assistant",
      kind: String(row.content_type || ""),
      text: String(row.content_type === "product" ? parseJson(row.product_payload_json)?.name || row.text_content || "" : row.text_content || "").slice(0, 600),
    })),
  };
}

function emptyContext() {
  return {
    hasRecentImage: false,
    hasRecentUserImage: false,
    hasRecentProductImage: false,
    hasRecentCharacterImage: false,
    recentImageCount: 0,
  };
}

function parseJson(value) {
  if (!value) return null;
  if (typeof value === "object") return value;
  try { return JSON.parse(String(value)); } catch { return null; }
}

function resolveImageUrl(value) {
  if (!value || typeof value !== "object") return "";
  const imageList = Array.isArray(value.imageUrls) ? value.imageUrls : Array.isArray(value.image_urls) ? value.image_urls : [];
  const firstImage = imageList
    .map((item) => typeof item === "string" ? item : item?.url || item?.src || item?.imageUrl || item?.image_url || "")
    .find((item) => String(item || "").trim());
  const candidates = [
    value.imageUrl,
    value.image_url,
    value.previewImageUrl,
    value.preview_image_url,
    value.featuredImageUrl,
    value.featured_image_url,
    typeof value.image === "string" ? value.image : value.image?.url,
    value.featured_image?.url,
    typeof value.featured_image === "string" ? value.featured_image : "",
    value.src,
    firstImage,
  ];
  return String(candidates.find((item) => String(item || "").trim()) || "").trim();
}
