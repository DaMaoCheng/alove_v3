import { ICONS } from "../../icons/icons.js";
import {
  getTtmallAccountBinding,
  registerTtmallAccount,
  removeTtmallAccountBinding,
  requestTtmallAccountCaptcha,
  signInTtmallAccount,
} from "../../services/ttmall-account-binding-service.js";
import { getSiteBranding } from "../../services/site-branding-service.js";
import { bindSiteBrandImage } from "../shared-ui/site-branding.js";

const PANEL_STATES = new WeakMap();
const CAPTCHA_RETRY_DELAYS_MS = Object.freeze([1500, 5000, 15000, 60000, 180000]);
const TRANSITION_MS = 300;

export function ttmallAccountBindingHtml() {
  return `<aside class="product-cart-panel ttmall-account-binding-panel" data-ttmall-account-binding data-ttmall-binding-state="closed" role="dialog" aria-modal="true" aria-hidden="true" aria-labelledby="ttmallAccountBindingTitle">
    <div class="pp-head product-cart-head">
      <h2 id="ttmallAccountBindingTitle" class="login-card-title ttmall-binding-brand" data-ttmall-binding-brand>
        <span class="ttmall-binding-brand-logo" aria-hidden="true">
          <img data-ttmall-binding-brand-image hidden />
          <span data-ttmall-binding-brand-fallback>${ICONS.globe}</span>
        </span>
        <span data-ttmall-binding-brand-name>TTMall</span>
      </h2>
      <button class="pp-close product-cart-close" type="button" data-ttmall-binding-close aria-label="Close">${ICONS.close}</button>
    </div>
    <div class="pp-scroll ttmall-binding-scroll">
      <div data-ttmall-binding-content></div>
    </div>
  </aside>`;
}

export function bindTtmallAccountBindingPanel(root, { language = "", onBound } = {}) {
  const panel = root?.querySelector?.("[data-ttmall-account-binding]");
  if (!panel || PANEL_STATES.has(panel)) return;
  const state = { siteSlug: "", branding: null, mode: "login", result: null, loading: false, email: "", captchaSessionId: "", captchaRetryAttempt: 0, captchaRetryTimer: null, language, onBound };
  PANEL_STATES.set(panel, state);
  panel.addEventListener("click", (event) => void handlePanelClick(panel, event));
  panel.addEventListener("submit", (event) => void handlePanelSubmit(panel, event));
  panel.addEventListener("input", (event) => handlePanelInput(panel, event));
  panel.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeTtmallAccountBindingPanel(root);
  });
}

export async function ensureTtmallAccountBinding(root, { siteSlug = "", language = "", onBound } = {}) {
  const panel = root?.querySelector?.("[data-ttmall-account-binding]");
  if (!panel) return { mode: "not_ttmall", requiresBinding: false };
  const state = PANEL_STATES.get(panel);
  if (!state) return { mode: "not_ttmall", requiresBinding: false };
  const nextSiteSlug = String(siteSlug || "").trim();
  if (state.siteSlug !== nextSiteSlug) state.email = "";
  state.siteSlug = nextSiteSlug;
  state.language = language;
  state.onBound = typeof onBound === "function" ? onBound : null;
  state.loading = true;
  state.result = null;
  let shouldLoadCaptcha = false;
  renderPanel(panel);
  try {
    const [result, branding] = await Promise.all([
      getTtmallAccountBinding({ siteSlug: state.siteSlug }),
      getSiteBranding(state.siteSlug).catch(() => null),
    ]);
    state.branding = branding;
    state.result = result;
    if (result?.mode !== "ttmall" || result?.requiresBinding === false) {
      state.onBound = null;
      return result;
    }
    if (result?.binding?.status === "pending_auth" && !state.email) {
      state.email = String(result.binding.prefillEmail || "");
    }
    state.mode = "login";
    renderPanel(panel);
    openTtmallAccountBindingPanel(root);
    shouldLoadCaptcha = true;
    return result;
  } catch (error) {
    state.result = { mode: "ttmall", requiresBinding: true, error: userMessage(error) };
    renderPanel(panel);
    openTtmallAccountBindingPanel(root);
    return state.result;
  } finally {
    state.loading = false;
    renderPanel(panel);
    if (shouldLoadCaptcha) void refreshCaptcha(panel);
  }
}

export function openTtmallAccountBindingPanel(root) {
  const panel = root?.querySelector?.("[data-ttmall-account-binding]");
  if (!panel || panel.dataset.ttmallBindingState === "open") return;
  panel.dataset.ttmallBindingState = "opening";
  panel.setAttribute("aria-hidden", "false");
  void panel.offsetWidth;
  window.requestAnimationFrame(() => { panel.dataset.ttmallBindingState = "open"; });
  window.setTimeout(() => panel.querySelector("input")?.focus(), 120);
}

export function closeTtmallAccountBindingPanel(root) {
  const panel = root?.querySelector?.("[data-ttmall-account-binding]");
  if (!panel || panel.dataset.ttmallBindingState === "closed" || panel.dataset.ttmallBindingState === "closing") return;
  const state = PANEL_STATES.get(panel);
  clearSensitiveFields(panel);
  panel.dataset.ttmallBindingState = "closing";
  const finish = () => {
    if (panel.dataset.ttmallBindingState !== "closing") return;
    panel.dataset.ttmallBindingState = "closed";
    panel.setAttribute("aria-hidden", "true");
  };
  panel.addEventListener("transitionend", finish, { once: true });
  window.setTimeout(finish, TRANSITION_MS + 80);
  if (state) {
    state.loading = false;
    state.captchaSessionId = "";
    clearCaptchaRetry(state);
    state.onBound = null;
  }
}

async function handlePanelClick(panel, event) {
  const root = panel.closest(".chat-wrap, .page, .call-product-overlay") || panel.parentElement;
  if (event.target.closest("[data-ttmall-binding-close]")) {
    closeTtmallAccountBindingPanel(root);
    return;
  }
  const tab = event.target.closest("[data-ttmall-binding-tab]");
  if (tab) {
    const state = PANEL_STATES.get(panel);
    state.mode = tab.dataset.ttmallBindingTab === "register" ? "register" : "login";
    state.result = { mode: "ttmall", requiresBinding: true };
    state.captchaSessionId = "";
    renderPanel(panel);
    void refreshCaptcha(panel);
    return;
  }
  if (event.target.closest("[data-ttmall-binding-refresh-captcha]")) {
    await refreshCaptcha(panel);
    return;
  }
  if (event.target.closest("[data-ttmall-binding-unlink]")) {
    await unlinkAccount(panel);
  }
}

function handlePanelInput(panel, event) {
  const input = event.target.closest?.("input");
  if (!input?.closest("[data-ttmall-binding-form]")) return;
  const state = PANEL_STATES.get(panel);
  const errorField = state?.result?.errorField || "";
  if (!state?.result?.error || !shouldClearBindingError(errorField, bindingFieldForInput(input.name))) return;
  state.result = { ...state.result, error: "", errorField: "" };
  panel.querySelector(".ttmall-binding-form-error")?.remove();
  panel.querySelectorAll(".field-error").forEach((message) => message.remove());
  panel.querySelectorAll(".is-field-error, .is-field-error-flash").forEach((field) => {
    field.classList.remove("is-field-error", "is-field-error-flash");
    field.removeAttribute("aria-invalid");
    field.removeAttribute("aria-describedby");
  });
}

async function handlePanelSubmit(panel, event) {
  const form = event.target.closest("[data-ttmall-binding-form]");
  if (!form) return;
  event.preventDefault();
  const state = PANEL_STATES.get(panel);
  if (!state || state.loading) return;
  const values = new FormData(form);
  state.email = String(values.get("ttmallEmail") || "").trim();
  state.loading = true;
  state.result = { mode: "ttmall", requiresBinding: true };
  renderPanel(panel);
  try {
    const input = {
      siteSlug: state.siteSlug,
      email: values.get("ttmallEmail"),
      password: values.get("ttmallPassword"),
      checkcode: values.get("checkcode"),
      captchaSessionId: state.captchaSessionId,
    };
    const result = state.mode === "register"
      ? await registerTtmallAccount({ ...input, confirmPassword: values.get("confirmPassword") })
      : await signInTtmallAccount(input);
    state.result = result;
    if (result?.binding?.status === "active") {
      const onBound = state.onBound;
      state.onBound = null;
      clearSensitiveFields(panel);
      if (typeof onBound === "function") {
        const root = panel.closest(".chat-wrap, .page, .call-product-overlay") || panel.parentElement;
        closeTtmallAccountBindingPanel(root);
        await onBound(result);
      }
    }
  } catch (error) {
    const code = String(error?.payload?.code || error?.code || "").toUpperCase();
    state.result = {
      mode: "ttmall",
      requiresBinding: true,
      error: userMessage(error),
      errorField: resolveBindingErrorField(code),
    };
    if (code === "TTMALL_EMAIL_EXISTS") state.mode = "login";
  } finally {
    state.loading = false;
    renderPanel(panel);
    if (state.result?.requiresBinding !== false) void refreshCaptcha(panel);
  }
}

async function refreshCaptcha(panel) {
  const state = PANEL_STATES.get(panel);
  if (!state?.siteSlug || state.loading) return;
  cancelCaptchaRetry(state);
  const target = panel.querySelector("[data-ttmall-binding-captcha]");
  if (!target) return;
  target.textContent = "Loading verification image…";
  try {
    const result = await requestTtmallAccountCaptcha({ siteSlug: state.siteSlug, purpose: state.mode });
    state.captchaSessionId = String(result?.captchaSessionId || "");
    state.captchaRetryAttempt = 0;
    const checkcodeInput = panel.querySelector('input[name="checkcode"]');
    if (checkcodeInput) checkcodeInput.value = "";
    target.innerHTML = result?.captcha ? `<img src="${escapeAttribute(result.captcha)}" alt="Verification image" />` : "Enter the verification code shown by TTMall.";
  } catch {
    state.captchaSessionId = "";
    target.textContent = "Verification image is unavailable. Retrying automatically…";
    scheduleCaptchaRetry(panel, state);
  }
}

function scheduleCaptchaRetry(panel, state) {
  const delay = CAPTCHA_RETRY_DELAYS_MS[state.captchaRetryAttempt];
  if (!delay || state.captchaRetryTimer || panel.dataset.ttmallBindingState === "closed") return;
  state.captchaRetryAttempt += 1;
  state.captchaRetryTimer = window.setTimeout(() => {
    state.captchaRetryTimer = null;
    void refreshCaptcha(panel);
  }, delay);
}

function clearCaptchaRetry(state) {
  cancelCaptchaRetry(state);
  if (state) {
    state.captchaRetryAttempt = 0;
  }
}

function cancelCaptchaRetry(state) {
  if (state?.captchaRetryTimer) window.clearTimeout(state.captchaRetryTimer);
  if (state) state.captchaRetryTimer = null;
}

async function unlinkAccount(panel) {
  const state = PANEL_STATES.get(panel);
  if (!state?.siteSlug || state.loading) return;
  state.loading = true;
  renderPanel(panel);
  try {
    state.result = await removeTtmallAccountBinding({ siteSlug: state.siteSlug });
  } catch (error) {
    state.result = { mode: "ttmall", requiresBinding: true, error: userMessage(error) };
  } finally {
    state.loading = false;
    renderPanel(panel);
  }
}

function renderPanel(panel) {
  const state = PANEL_STATES.get(panel);
  const content = panel.querySelector("[data-ttmall-binding-content]");
  if (!state || !content) return;
  renderPanelBranding(panel, state);
  const result = state.result || {};
  if (state.loading && !result.mode) {
    content.innerHTML = `<p class="ttmall-binding-note">Checking TTMall account status…</p>`;
    return;
  }
  if (result.mode === "not_ttmall") {
    content.innerHTML = `<p class="ttmall-binding-note">This cart does not need a TTMall account.</p>`;
    return;
  }
  if (result.requiresBinding === false && result.binding?.status === "active") {
    content.innerHTML = `<section class="ttmall-binding-summary"><b>TTMall account linked</b><p>${escapeHtml(result.binding.email || "")}</p><button type="button" data-ttmall-binding-unlink ${state.loading ? "disabled" : ""}>Unlink account</button></section>`;
    return;
  }
  const isRegister = state.mode === "register";
  const isPendingAuth = result.binding?.status === "pending_auth";
  const formError = result.error && !result.errorField
    ? `<p class="auth-message ttmall-binding-form-error" role="alert">${escapeHtml(result.error)}</p>`
    : "";
  content.innerHTML = `<div class="ttmall-binding-tabs" role="tablist" aria-label="TTMall account action">
      <button class="btn ${!isRegister ? "btn-primary" : "btn-ghost"}" type="button" data-ttmall-binding-tab="login" aria-selected="${!isRegister}">Sign in</button>
      <button class="btn ${isRegister ? "btn-primary" : "btn-ghost"}" type="button" data-ttmall-binding-tab="register" aria-selected="${isRegister}">Create account</button>
    </div>
    ${formError}
    <form data-ttmall-binding-form class="ttmall-binding-form" autocomplete="off">
      <label class="field"><span>Email</span><input name="ttmallEmail" type="email" class="${bindingInputErrorClass(result, "email")}" value="${escapeAttribute(state.email)}" autocomplete="off" data-lpignore="true" data-1p-ignore="true" data-bwignore="true"${bindingInputErrorA11y(result, "email")} required maxlength="254" /></label>
      ${bindingFieldErrorHtml(result, "email")}
      <label class="field"><span>Password</span><input name="ttmallPassword" type="password" class="${bindingInputErrorClass(result, "password")}" autocomplete="off" data-lpignore="true" data-1p-ignore="true" data-bwignore="true"${bindingInputErrorA11y(result, "password")} required maxlength="128" /></label>
      ${bindingFieldErrorHtml(result, "password")}
      ${isRegister ? `<label class="field"><span>Confirm password</span><input name="confirmPassword" type="password" class="${bindingInputErrorClass(result, "confirmPassword")}" autocomplete="off" data-lpignore="true" data-1p-ignore="true" data-bwignore="true"${bindingInputErrorA11y(result, "confirmPassword")} required maxlength="128" /></label>${bindingFieldErrorHtml(result, "confirmPassword")}` : ""}
      <div class="ttmall-binding-captcha-row"><label class="field"><span>Verification code</span><input name="checkcode" type="text" class="${bindingInputErrorClass(result, "checkcode")}"${bindingInputErrorA11y(result, "checkcode")} required maxlength="64" /></label><div class="ttmall-binding-captcha" data-ttmall-binding-captcha>Loading verification image…</div><button type="button" data-ttmall-binding-refresh-captcha aria-label="Refresh verification image">↻</button></div>
      ${bindingFieldErrorHtml(result, "checkcode")}
      <p class="ttmall-binding-security-note">${isPendingAuth
        ? "Continue linking this email to TTMall. For a new TTMall account, you may choose the same password as AIOVE; it is used only for this request and is never stored or shared."
        : "Enter your TTMall password only for this secure linking request. AIOVE never stores or reuses it."}</p>
      <button class="btn btn-primary btn-block ttmall-binding-submit" type="submit" ${state.loading ? "disabled" : ""}>${state.loading ? "Please wait…" : (isRegister ? "Create and link TTMall account" : "Link TTMall account")}</button>
    </form>`;
}

function renderPanelBranding(panel, state) {
  const name = panel.querySelector("[data-ttmall-binding-brand-name]");
  const image = panel.querySelector("[data-ttmall-binding-brand-image]");
  const fallback = panel.querySelector("[data-ttmall-binding-brand-fallback]");
  if (!name || !image || !fallback) return;
  const branding = state?.branding || {};
  name.textContent = String(branding.name || state?.siteSlug || "TTMall").trim() || "TTMall";
  bindSiteBrandImage(image, fallback, {
    logoUrl: branding.logoUrl || "",
    siteUrl: branding.siteUrl || "",
  });
}

function clearSensitiveFields(panel) {
  panel.querySelectorAll('input[type="password"], input[name="checkcode"]').forEach((input) => { input.value = ""; });
}

function userMessage(error) {
  return String(error?.message || error?.error || "TTMall could not complete this request. Please try again.");
}

function resolveBindingErrorField(code = "") {
  switch (String(code || "").toUpperCase()) {
    case "TTMALL_EMAIL_EXISTS":
      return "email";
    case "TTMALL_PASSWORD_LENGTH_INVALID":
    case "TTMALL_PASSWORD_FORMAT_INVALID":
    case "TTMALL_ACCOUNT_AUTH_FAILED":
      return "password";
    case "TTMALL_PASSWORD_CONFIRMATION_INVALID":
      return "confirmPassword";
    case "TTMALL_CAPTCHA_INVALID":
    case "TTMALL_CAPTCHA_SESSION_INVALID":
      return "checkcode";
    default:
      return "";
  }
}

function bindingFieldForInput(name = "") {
  return ({
    ttmallEmail: "email",
    ttmallPassword: "password",
    confirmPassword: "confirmPassword",
    checkcode: "checkcode",
  })[name] || "";
}

function shouldClearBindingError(errorField, changedField) {
  if (!errorField) return Boolean(changedField);
  return errorField === changedField || (errorField === "confirmPassword" && changedField === "password");
}

function bindingInputErrorClass(result, field) {
  return result?.errorField === field ? "is-field-error is-field-error-flash" : "";
}

function bindingInputErrorA11y(result, field) {
  return result?.errorField === field
    ? ` aria-invalid="true" aria-describedby="ttmall-binding-${field}-error"`
    : "";
}

function bindingFieldErrorHtml(result, field) {
  return result?.errorField === field
    ? `<p class="field-error" id="ttmall-binding-${field}-error" role="alert">${escapeHtml(result.error)}</p>`
    : "";
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

function escapeAttribute(value = "") {
  return escapeHtml(value);
}
