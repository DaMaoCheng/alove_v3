import { getDbPool } from "./db.js";
import { normalizeInviteCode, throwUserError } from "./auth-normalizers.js";
import { normalizePublicSiteSlug } from "../shared/site-slug.js";

export async function resolveRegistrationSite(siteSlug, db = getDbPool()) {
  const explicitSlug = String(siteSlug || "").trim();
  const normalizedSlug = normalizePublicSiteSlug(explicitSlug);
  if (explicitSlug && !normalizedSlug) {
    throwUserError("This site is currently unavailable. Please check your sign-up link.");
  }
  const [rows] = await db.execute(
    `SELECT id, name, slug
     FROM sites
     WHERE slug = ? AND site_status = 'active'
     LIMIT 1`,
    [normalizedSlug || "gogoalshop"]
  );
  if (rows[0]) return rows[0];

  if (explicitSlug) {
    throwUserError("This site is currently unavailable. Please check your sign-up link.");
  }

  const [defaultRows] = await db.execute(
    `SELECT id, name, slug
     FROM sites
     WHERE is_default = 1 AND site_status = 'active'
     ORDER BY updated_at DESC
     LIMIT 1`
  );
  if (defaultRows[0]) return defaultRows[0];

  throwUserError("This site is currently unavailable. Please try again later.");
}

export async function resolveReferralInvite(inviteCode, site, db = getDbPool()) {
  const code = normalizeInviteCode(inviteCode);
  if (!code) return null;

  const [rows] = await db.execute(
    `SELECT u.id, u.site_id, s.slug AS site_slug
     FROM users u
     LEFT JOIN sites s ON s.id = u.site_id AND s.site_status = 'active'
     WHERE u.referral_code = ? AND u.account_status = 'active'
     LIMIT 1`,
    [code]
  );
  const inviter = rows[0] || null;
  if (!inviter) throwUserError("Invalid invite code.");
  if (!inviter.site_id) throwUserError("This invite code is not linked to a site. Please ask for a new invite link.");
  if (String(inviter.site_id) !== String(site?.id || "")) {
    throwUserError("This invite code does not belong to the current site. Please check your sign-up link.");
  }
  return { code, inviterId: inviter.id, siteId: inviter.site_id, siteSlug: inviter.site_slug || "" };
}
