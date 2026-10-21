import { API_ENDPOINTS } from "../config/api-config.js";
import { requestJson } from "./http-client.js";

export function getTtmallAccountBinding({ siteSlug = "", signal } = {}) {
  const search = new URLSearchParams({ siteSlug: String(siteSlug || "") });
  return requestJson(`${API_ENDPOINTS.ttmallBinding.status}?${search.toString()}`, { signal });
}

export function requestTtmallAccountCaptcha({ siteSlug = "", purpose = "", signal } = {}) {
  return requestJson(API_ENDPOINTS.ttmallBinding.captcha, { method: "POST", signal, notifyUnauthorized: false, body: { siteSlug, purpose } });
}

export function signInTtmallAccount({ siteSlug = "", email = "", password = "", checkcode = "", captchaSessionId = "", signal } = {}) {
  return requestJson(API_ENDPOINTS.ttmallBinding.login, { method: "POST", signal, notifyUnauthorized: false, body: { siteSlug, email, password, checkcode, captchaSessionId } });
}

export function registerTtmallAccount({ siteSlug = "", email = "", password = "", confirmPassword = "", checkcode = "", captchaSessionId = "", signal } = {}) {
  return requestJson(API_ENDPOINTS.ttmallBinding.register, { method: "POST", signal, notifyUnauthorized: false, body: { siteSlug, email, password, confirmPassword, checkcode, captchaSessionId } });
}

export function removeTtmallAccountBinding({ siteSlug = "", signal } = {}) {
  return requestJson(API_ENDPOINTS.ttmallBinding.status, { method: "DELETE", signal, body: { siteSlug } });
}
