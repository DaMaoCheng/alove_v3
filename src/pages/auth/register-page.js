import { createAuthPage } from "./auth-layout.js";
import { bindAuthLeaveProtection } from "./auth-leave-protection.js";
import { bindConfirmPasswordValidation } from "./confirm-password-validation.js";
import { bindCodeSender, bindPasswordToggle } from "./auth-form-controls.js";
import { clearAuthMessage, setAuthMessage, setSubmitButtonBusy } from "./auth-form-state.js";
import { createSiteCopy } from "../../i18n/site-copy.js";
import { getUserFacingErrorMessage } from "../../utils/user-facing-error.js";

export function createRegisterPage({ onNavigate, onSubmit, onGoogleLogin, onSendCode, onCheckEmail, pageLanguage = "English" }) {
  const copy = createSiteCopy(pageLanguage);
  const body = document.createElement("div");
  body.innerHTML = `
    <button class="btn-google" type="button" data-google-login>${googleIcon()}<span>${copy.t("auth.google")}</span></button>
    <div class="or-line"><span>${copy.t("auth.signUpSeparator")}</span></div>
    <form class="login-form">
      <label class="field">
        <span>${copy.t("auth.displayName")}</span>
        <input name="displayName" autocomplete="name" placeholder="${copy.t("auth.displayPlaceholder")}" />
      </label>
      <label class="field">
        <span>${copy.t("auth.email")}</span>
        <input name="email" type="email" autocomplete="email" placeholder="you@email.com" />
      </label>
      <p class="auth-message" data-auth-message data-auth-field-message="email" role="alert" aria-live="polite" hidden></p>
      <label class="field">
        <span>${copy.t("auth.verificationCode")}</span>
        <span class="field-inline">
          <input name="code" inputmode="numeric" placeholder="${copy.t("auth.sixDigitCode")}" />
          <button class="code-btn" type="button" data-code-send="register_email">${copy.t("auth.sendCode")}</button>
        </span>
      </label>
      <p class="auth-message" data-auth-field-message="code" role="alert" aria-live="polite" hidden></p>
      <label class="field">
        <span>${copy.t("auth.password")}</span>
        <span class="field-inline">
          <input id="register-password" name="password" type="password" autocomplete="new-password" placeholder="${copy.t("auth.passwordPlaceholder")}" />
          <button class="field-link" type="button" data-password-toggle="register-password">${copy.t("auth.show")}</button>
        </span>
      </label>
      <p class="auth-message" data-auth-field-message="password" role="alert" aria-live="polite" hidden></p>
      <p class="login-terms">${copy.t("auth.passwordPolicy")}</p>
      <label class="field">
        <span>${copy.t("auth.confirmPassword")}</span>
        <span class="field-inline">
          <input id="register-confirm-password" name="confirmPassword" type="password" autocomplete="new-password" placeholder="${copy.t("auth.confirmPlaceholder")}" />
          <button class="field-link" type="button" data-password-toggle="register-confirm-password">${copy.t("auth.show")}</button>
        </span>
      </label>
      <label class="field">
        <span>${copy.t("auth.inviteCode")}</span>
        <input name="inviteCode" placeholder="${copy.t("auth.invitePlaceholder")}" />
      </label>
      <p class="login-terms">${copy.t("auth.termsPrefix")} <a href="/terms">${copy.t("auth.terms")}</a> / <a href="/privacy">${copy.t("auth.privacy")}</a>.</p>
      <button class="btn btn-primary btn-block" type="submit" data-auth-submit>${copy.t("common.createAccount")}</button>
    </form>
    <p class="login-alt">${copy.t("auth.already")} <button type="button" class="text-link" data-nav="login">${copy.t("common.signIn")}</button></p>
  `;

  body.querySelector("[data-google-login]")?.addEventListener("click", () => onGoogleLogin?.());
  const form = body.querySelector("form");
  const emailInput = body.querySelector("input[name='email']");
  const inviteInput = body.querySelector("input[name='inviteCode']");
  const message = body.querySelector("[data-auth-message]");
  const leaveProtection = bindAuthLeaveProtection(body, {
    onNavigate,
    title: copy.t("auth.leaveTitle"),
    message: copy.t("auth.leaveMessage"),
    confirmText: copy.t("auth.leave"),
    cancelText: copy.t("auth.stay"),
  });
  const validatePasswords = bindConfirmPasswordValidation(body, { message: copy.t("auth.passwordMismatch") });
  prefillInviteCode(inviteInput, copy);
  body.querySelector("[data-nav='login']")?.addEventListener("click", () => leaveProtection.navigate("login"));

  emailInput?.addEventListener("blur", () => {
    validateEmailAvailability({ emailInput, message, onCheckEmail, copy });
  });

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearRegisterMessages(body);
    if (!validatePasswords({ flash: true })) {
      return;
    }
    setSubmitButtonBusy(form, true, copy.t("common.createAccount"), copy.t("auth.creating"));
    const data = new FormData(event.currentTarget);
    const password = String(data.get("password") || "");
    if (!validatePasswordPolicy(body, password, copy)) {
      setSubmitButtonBusy(form, false, copy.t("common.createAccount"));
      return;
    }
    const emailAvailable = await validateEmailAvailability({ emailInput, message, onCheckEmail, copy });
    if (!emailAvailable) {
      setSubmitButtonBusy(form, false, copy.t("common.createAccount"));
      return;
    }

    const result = await onSubmit?.({
      displayName: String(data.get("displayName") || "").trim(),
      email: String(data.get("email") || "").trim(),
      code: String(data.get("code") || "").trim(),
      password,
      confirmPassword: String(data.get("confirmPassword") || ""),
      inviteCode: String(data.get("inviteCode") || "").trim(),
    });
    if (result?.ok === false) {
      setRegisterError(body, authError(result.error, copy, "auth.createFailed"), copy);
      setSubmitButtonBusy(form, false, copy.t("common.createAccount"));
    }
    if (result?.ok) {
      leaveProtection.markSubmitted();
    }
  });
  bindPasswordToggle(body, { copy });
  bindCodeSender(body, onSendCode, {
    beforeSend: () => validateEmailAvailability({ emailInput, message, onCheckEmail, copy }),
    onResult: (result) => {
      if (result?.ok === false) {
        setRegisterError(body, authError(result.error, copy, "auth.codeFailed"), copy);
      }
    },
    copy,
  });

  return createAuthPage({
    title: copy.t("common.createAccount"),
    subtitle: copy.t("auth.join"),
    body,
    ariaLabel: copy.t("common.createAccount"),
    pageLanguage,
  });
}

function clearRegisterMessages(root) {
  root?.querySelectorAll?.("[data-auth-field-message]").forEach((message) => {
    clearAuthMessage({ querySelector: () => message });
  });
  root?.querySelectorAll?.(".is-field-error, .is-field-error-flash").forEach((input) => {
    input.classList.remove("is-field-error", "is-field-error-flash");
  });
}

function validatePasswordPolicy(root, password, copy) {
  const normalizedPassword = String(password || "");
  if (normalizedPassword.length < 8) {
    setFieldMessage(root, "password", copy.t("auth.passwordTooShort"));
    flashField(root, "password");
    return false;
  }
  if (!/[A-Za-z]/.test(normalizedPassword) || !/\d/.test(normalizedPassword)) {
    setFieldMessage(root, "password", copy.t("auth.passwordNeedsMixed"));
    flashField(root, "password");
    return false;
  }
  return true;
}

function setRegisterError(root, message, copy) {
  const target = resolveRegisterErrorField(message);
  setFieldMessage(root, target, message || copy?.t("auth.createFailed") || "Unable to create account.");
  if (target !== "form") flashField(root, target);
}

function resolveRegisterErrorField(message = "") {
  const normalized = String(message || "").toLowerCase();
  if (normalized.includes("password") || normalized.includes("密码")) return "password";
  if (normalized.includes("verification") || normalized.includes("code") || normalized.includes("验证码")) return "code";
  if (normalized.includes("email") || normalized.includes("邮箱") || normalized.includes("邮件")) return "email";
  return "email";
}

function setFieldMessage(root, field, message) {
  const target = root?.querySelector?.(`[data-auth-field-message="${field}"]`)
    || root?.querySelector?.("[data-auth-message]");
  setAuthMessage({ querySelector: () => target }, message);
}

function flashField(root, field) {
  const input = root?.querySelector?.(`input[name="${field}"]`);
  if (!(input instanceof HTMLInputElement)) return;
  input.classList.add("is-field-error");
  input.classList.remove("is-field-error-flash");
  void input.offsetWidth;
  input.classList.add("is-field-error-flash");
}

function prefillInviteCode(input, copy) {
  if (!input) return;
  const params = new URLSearchParams(window.location.search || "");
  const code = String(params.get("invite") || params.get("inviteCode") || "").trim();
  if (!code) return;
  input.value = code;
  input.readOnly = true;
  input.setAttribute("aria-readonly", "true");
  input.classList.add("invite-code-locked");
  input.title = copy.t("auth.inviteFromLink");
}

async function validateEmailAvailability({ emailInput, message, onCheckEmail, copy }) {
  const email = String(emailInput?.value || "").trim();
  clearAuthMessage({ querySelector: () => message });
  if (!email) {
    return true;
  }

  const result = await onCheckEmail?.({ email });
  if (!result || result.available) {
    return true;
  }

  setAuthMessage({ querySelector: () => message }, authError(result.error, copy, "auth.emailRegistered"));
  return false;
}

function authError(error, copy, fallbackKey) {
  return getUserFacingErrorMessage(error || copy.t(fallbackKey), {
    pageLanguage: copy.language.code,
    fallbackType: "auth",
  });
}

function googleIcon() {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M22.5 12.2c0-.8-.07-1.4-.2-2.05H12v3.9h6c-.12 1-.77 2.5-2.2 3.5l-.02.13 3.2 2.45.22.02c2.03-1.87 3.3-4.62 3.3-7.95z"/>
      <path fill="#34A853" d="M12 23c2.9 0 5.34-.96 7.12-2.6l-3.4-2.6c-.9.62-2.13 1.06-3.72 1.06-2.84 0-5.25-1.87-6.1-4.46l-.13.01-3.32 2.55-.04.12C4.17 20.4 7.8 23 12 23z"/>
      <path fill="#FBBC05" d="M5.9 14.4a6.7 6.7 0 01-.37-2.4c0-.84.15-1.65.36-2.4l-.006-.16L2.52 6.85l-.11.05A11 11 0 001 12c0 1.77.42 3.45 1.4 4.95l3.5-2.55z"/>
      <path fill="#EA4335" d="M12 5.14c2.02 0 3.38.87 4.16 1.6l3.04-2.96C17.33 2.05 14.9 1 12 1 7.8 1 4.17 3.6 2.4 7.05l3.5 2.55C6.75 7.01 9.16 5.14 12 5.14z"/>
    </svg>
  `;
}
