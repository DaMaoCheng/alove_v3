import { getDbPool } from "./db.js";
import { getOptionalRequestUser } from "./request-user-service.js";
import { assertPublicAppOrigin } from "./request-origin-service.js";
import { GUEST_COOKIE_NAME, requireGuest } from "./guest-session-service.js";
import { readCookie, readJson, sendJson } from "./http-utils.js";
import { resolveRequestAccess } from "./access-location-service.js";
import { createUserFeedback } from "./feedback-service.js";

export async function handleFeedbackRoute(req, res, { path }) {
  if (req.method === "POST" && path === "/api/feedback") {
    const body = await readJson(req, 16 * 1024);
    const user = await getOptionalRequestUser(req);
    if (!user) assertPublicAppOrigin(req);
    const guest = user ? null : await getOptionalGuestFeedbackPrincipal(req);
    const principal = user || await resolveGuestFeedbackPrincipal(req, body.contactEmail, guest);
    const access = resolveRequestAccess(req);
    sendJson(res, 200, await createUserFeedback(principal, body, access));
    return true;
  }

  return false;
}

async function getOptionalGuestFeedbackPrincipal(req) {
  const token = readCookie(req, GUEST_COOKIE_NAME);
  if (!token) return null;
  try {
    return await requireGuest(token);
  } catch (error) {
    if (Number(error?.statusCode || 0) === 401) return null;
    throw error;
  }
}

async function resolveGuestFeedbackPrincipal(req, contactEmail, guest = null) {
  const email = String(contactEmail || "").trim().toLowerCase();
  const site = guest?.site_id ? guest : await resolveFeedbackSiteFromReferer(req);
  return {
    id: "",
    guest_session_id: String(guest?.id || "").trim(),
    email,
    account_type: "guest",
    site_id: String(site?.site_id || site?.id || "").trim(),
    site_slug: String(site?.site_slug || site?.slug || "").trim(),
  };
}

async function resolveFeedbackSiteFromReferer(req) {
  const referer = String(req.headers.referer || "").trim();
  let slug = "";
  try {
    const path = new URL(referer).pathname;
    slug = path.split("/").filter(Boolean)[0] || "";
  } catch {
    return null;
  }
  if (!/^[a-z0-9][a-z0-9-]{0,95}$/i.test(slug)) return null;
  const [rows] = await getDbPool().execute(
    "SELECT id, slug FROM sites WHERE slug = ? AND site_status = 'active' LIMIT 1",
    [slug.toLowerCase()]
  );
  return rows[0] || null;
}
