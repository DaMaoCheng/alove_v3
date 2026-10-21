import { createAdminAccount, getAdminAccountConversation, listAdminAccountConversations, listAdminAccounts, resetAdminAccountPassword, updateAdminAccountProfile, updateAdminAccountSite, updateAdminAccountStatus } from "./admin-account-service.js";
import { getAdminGuestConversation, getAdminGuestConversationDetail, listAdminGuestConversations, listAdminGuestSessions } from "./admin-guest-session-service.js";
import { readJson, sendJson } from "./http-utils.js";
import { createPublicError } from "./public-error-utils.js";
import { ADMIN_SCOPES, requireAdmin } from "./route-utils.js";

export async function handleAdminAccountRoute(req, res, { path, requestUrl }) {
  if (req.method === "GET" && path === "/api/admin/accounts/guests") {
    await requireAdmin(req);
    sendJson(res, 200, await listAdminGuestSessions({
      page: requestUrl.searchParams.get("page"),
      limit: requestUrl.searchParams.get("limit"),
      query: requestUrl.searchParams.get("query"),
      status: requestUrl.searchParams.get("status"),
      site: requestUrl.searchParams.get("site"),
      dateRange: requestUrl.searchParams.get("dateRange"),
      startDate: requestUrl.searchParams.get("startDate"),
      endDate: requestUrl.searchParams.get("endDate"),
    }));
    return true;
  }
  const guestConversationMatch = path.match(/^\/api\/admin\/accounts\/guests\/([^/]+)\/conversation$/);
  if (req.method === "GET" && guestConversationMatch) {
    await requireAdmin(req);
    sendJson(res, 200, await getAdminGuestConversation(decodePathSegment(guestConversationMatch[1])));
    return true;
  }
  const guestConversationDetailMatch = path.match(/^\/api\/admin\/accounts\/guests\/([^/]+)\/conversations\/([^/]+)$/);
  if (req.method === "GET" && guestConversationDetailMatch) {
    await requireAdmin(req);
    sendJson(res, 200, await getAdminGuestConversationDetail(
      decodePathSegment(guestConversationDetailMatch[1]),
      decodePathSegment(guestConversationDetailMatch[2])
    ));
    return true;
  }
  const guestConversationsMatch = path.match(/^\/api\/admin\/accounts\/guests\/([^/]+)\/conversations$/);
  if (req.method === "GET" && guestConversationsMatch) {
    await requireAdmin(req);
    sendJson(res, 200, await listAdminGuestConversations(decodePathSegment(guestConversationsMatch[1]), {
      query: requestUrl.searchParams.get("query"),
    }));
    return true;
  }
  if (req.method === "GET" && path === "/api/admin/accounts") {
    await requireAdmin(req);
    sendJson(res, 200, await listAdminAccounts({
      page: requestUrl.searchParams.get("page"),
      limit: requestUrl.searchParams.get("limit"),
      query: requestUrl.searchParams.get("query"),
      type: requestUrl.searchParams.get("type"),
      site: requestUrl.searchParams.get("site"),
      dateRange: requestUrl.searchParams.get("dateRange"),
      startDate: requestUrl.searchParams.get("startDate"),
      endDate: requestUrl.searchParams.get("endDate"),
    }));
    return true;
  }
  if (req.method === "POST" && path === "/api/admin/accounts") {
    await requireAdmin(req, ADMIN_SCOPES.ACCOUNTS_WRITE);
    sendJson(res, 201, await createAdminAccount(await readJson(req)));
    return true;
  }
  if (req.method === "PATCH" && path === "/api/admin/accounts/site") {
    await requireAdmin(req, ADMIN_SCOPES.ACCOUNTS_WRITE);
    const body = await readJson(req);
    sendJson(res, 200, await updateAdminAccountSite(body.accountIds || body.ids || [], body.siteId || body.site_id || ""));
    return true;
  }
  const accountConversationDetailMatch = path.match(/^\/api\/admin\/accounts\/([^/]+)\/conversations\/([^/]+)$/);
  if (req.method === "GET" && accountConversationDetailMatch) {
    await requireAdmin(req);
    sendJson(res, 200, await getAdminAccountConversation(
      decodeURIComponent(accountConversationDetailMatch[1]),
      decodeURIComponent(accountConversationDetailMatch[2])
    ));
    return true;
  }
  const accountStatusMatch = path.match(/^\/api\/admin\/accounts\/([^/]+)\/status$/);
  if (req.method === "PATCH" && accountStatusMatch) {
    const user = await requireAdmin(req, ADMIN_SCOPES.ACCOUNTS_WRITE);
    sendJson(res, 200, await updateAdminAccountStatus(
      decodeURIComponent(accountStatusMatch[1]),
      await readJson(req),
      user
    ));
    return true;
  }
  const accountProfileMatch = path.match(/^\/api\/admin\/accounts\/([^/]+)\/profile$/);
  if (req.method === "PATCH" && accountProfileMatch) {
    const user = await requireAdmin(req, ADMIN_SCOPES.ACCOUNTS_WRITE);
    sendJson(res, 200, await updateAdminAccountProfile(
      decodeURIComponent(accountProfileMatch[1]),
      await readJson(req),
      user
    ));
    return true;
  }
  const accountPasswordMatch = path.match(/^\/api\/admin\/accounts\/([^/]+)\/password$/);
  if (req.method === "PATCH" && accountPasswordMatch) {
    const user = await requireAdmin(req, ADMIN_SCOPES.ACCOUNTS_WRITE);
    sendJson(res, 200, await resetAdminAccountPassword(
      decodeURIComponent(accountPasswordMatch[1]),
      await readJson(req),
      user
    ));
    return true;
  }
  const accountConversationsMatch = path.match(/^\/api\/admin\/accounts\/([^/]+)\/conversations$/);
  if (req.method === "GET" && accountConversationsMatch) {
    await requireAdmin(req);
    sendJson(res, 200, await listAdminAccountConversations(decodeURIComponent(accountConversationsMatch[1]), {
      query: requestUrl.searchParams.get("query"),
    }));
    return true;
  }
  return false;
}

function decodePathSegment(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    throw createPublicError("请求路径无效", 400);
  }
}
