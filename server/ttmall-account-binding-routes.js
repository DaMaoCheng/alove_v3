import { requireAuth } from "./auth-service.js";
import { readAuthToken, readJson, sendJson } from "./http-utils.js";
import { assertPublicAppOrigin } from "./request-origin-service.js";
import {
  getTtmallAccountBinding,
  removeTtmallAccountBinding,
  saveTtmallAccountBinding,
} from "./ttmall-account-binding-service.js";
import {
  registerTtmallAccount,
  requestTtmallAccountCaptcha,
  signInTtmallAccount,
} from "./ttmall-account-client-service.js";
import { isEnabledTtmallAccess, resolveTtmallRuntimeAccess } from "./ttmall-runtime-access-service.js";

const ROOT_PATH = "/api/ttmall-account-binding";
const MAX_BINDING_BODY_BYTES = 16 * 1024;

export async function handleTtmallAccountBindingRoute(req, res, { path } = {}) {
  if (!String(path || "").startsWith(ROOT_PATH)) return false;
  const user = await requireAuth(req, readAuthToken);
  if (path === ROOT_PATH && req.method === "GET") {
    const requestUrl = new URL(req.url || ROOT_PATH, "http://localhost");
    sendJson(res, 200, await getTtmallAccountBinding({ userId: user.id, siteSlug: requestUrl.searchParams.get("siteSlug") }));
    return true;
  }
  if (path === ROOT_PATH && req.method === "DELETE") {
    assertPublicAppOrigin(req);
    const body = await readJson(req, MAX_BINDING_BODY_BYTES);
    sendJson(res, 200, await removeTtmallAccountBinding({ userId: user.id, siteSlug: body.siteSlug || body.site_slug }));
    return true;
  }
  if (!req.method || req.method !== "POST") return false;
  assertPublicAppOrigin(req);
  const body = await readJson(req, MAX_BINDING_BODY_BYTES);
  const siteSlug = body.siteSlug || body.site_slug;
  const access = await resolveTtmallRuntimeAccess(siteSlug);
  if (!isEnabledTtmallAccess(access)) {
    sendJson(res, 200, { ok: true, mode: "not_ttmall", requiresBinding: false });
    return true;
  }
  if (path === `${ROOT_PATH}/captcha`) {
    sendJson(res, 200, await requestTtmallAccountCaptcha(access.source, body.purpose, {
      sessionScope: { userId: user.id, siteId: access.site.id },
    }));
    return true;
  }
  if (path === `${ROOT_PATH}/login` || path === `${ROOT_PATH}/register`) {
    const result = path.endsWith("/login")
      ? await signInTtmallAccount(access.source, body, { sessionScope: { userId: user.id, siteId: access.site.id } })
      : await registerTtmallAccount(access.source, body, { sessionScope: { userId: user.id, siteId: access.site.id } });
    sendJson(res, 200, await saveTtmallAccountBinding({
      userId: user.id,
      siteSlug,
      externalUserId: result.externalUserId,
      email: result.email,
      token: result.token,
      providerCode: result.providerCode,
    }));
    return true;
  }
  return false;
}
