import { API_ENDPOINTS } from "../config/api-config.js";
import { requestJson } from "./http-client.js";

export function login(payload) {
  return requestJson(API_ENDPOINTS.auth.login, {
    method: "POST",
    // A bad credential is an expected login-form result, not an expired authenticated session.
    notifyUnauthorized: false,
    body: {
      username: payload.username,
      password: payload.password,
      remember: payload.rememberMe !== false,
      siteSlug: payload.siteSlug || "",
      locale: "cn",
    },
  });
}

export function register(payload) {
  return requestJson(API_ENDPOINTS.auth.register, {
    method: "POST",
    body: {
      email: payload.email || "",
      nickname: payload.displayName || "",
      verificationCode: payload.code || "",
      password: payload.password || "",
      confirmPassword: payload.confirmPassword || "",
      inviteCode: payload.inviteCode || "",
      siteSlug: payload.siteSlug || "",
      locale: "cn",
    },
  });
}

export function checkEmailAvailability({ email }) {
  return requestJson(API_ENDPOINTS.auth.checkEmail, {
    method: "POST",
    body: {
      email,
      locale: "cn",
    },
  });
}

export function sendRegisterCode({ email }) {
  return requestJson(API_ENDPOINTS.auth.sendEmailCode, {
    method: "POST",
    body: {
      email,
      scene: "register",
      locale: "cn",
    },
  });
}

export function sendForgotPasswordCode({ email }) {
  return requestJson(API_ENDPOINTS.auth.sendEmailCode, {
    method: "POST",
    body: {
      email,
      scene: "forgot_password",
      locale: "cn",
    },
  });
}

export function getCurrentUser() {
  return requestJson(API_ENDPOINTS.auth.me, { notifyUnauthorized: false });
}

export function logout() {
  return requestJson(API_ENDPOINTS.auth.logout, {
    method: "POST",
  });
}

export function resetPassword(payload) {
  return requestJson(API_ENDPOINTS.auth.resetPassword, {
    method: "POST",
    body: {
      email: payload.email || "",
      verificationCode: payload.code || "",
      password: payload.password || "",
      confirmPassword: payload.confirmPassword || "",
      locale: "cn",
    },
  });
}
