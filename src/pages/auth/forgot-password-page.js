import { createAuthPage } from "./auth-layout.js";
import { bindAuthLeaveProtection } from "./auth-leave-protection.js";
import { bindConfirmPasswordValidation } from "./confirm-password-validation.js";
import { bindCodeSender, bindPasswordToggle } from "./auth-form-controls.js";
import { clearAuthMessage, setAuthMessage, setSubmitButtonBusy } from "./auth-form-state.js";
import { createSiteCopy } from "../../i18n/site-copy.js";
import { getUserFacingErrorMessage } from "../../utils/user-facing-error.js";

export function createForgotPasswordPage({ onNavigate, onSubmit, onSendCode, pageLanguage = "English" }) {
  const copy = createSiteCopy(pageLanguage);
  const body = document.createElement("div");
  body.innerHTML = `
    <form class="login-form auth-form--compact">
      <label class="field">
        <span>${copy.t("auth.email")}</span>
        <input name="email" type="email" autocomplete="email" placeholder="you@email.com" />
      </label>
      <p class="auth-message" data-auth-message role="alert" aria-live="polite" hidden></p>
      <label class="field">
        <span>${copy.t("auth.verificationCode")}</span>
        <span class="field-inline">
          <input name="code" inputmode="numeric" placeholder="${copy.t("auth.sixDigitCode")}" />
          <button class="code-btn" type="button" data-code-send="forgot_password_email">${copy.t("auth.sendCode")}</button>
        </span>
      </label>
      <label class="field">
        <span>${copy.t("auth.newPassword")}</span>
        <span class="field-inline">
          <input id="forgot-password" name="password" type="password" autocomplete="new-password" placeholder="${copy.t("auth.newPasswordPlaceholder")}" />
          <button class="field-link" type="button" data-password-toggle="forgot-password">${copy.t("auth.show")}</button>
        </span>
      </label>
      <p class="login-terms">${copy.t("auth.passwordPolicy")}</p>
      <label class="field">
        <span>${copy.t("auth.confirmNewPassword")}</span>
        <span class="field-inline">
          <input id="forgot-confirm-password" name="confirmPassword" type="password" autocomplete="new-password" placeholder="${copy.t("auth.confirmPlaceholder")}" />
          <button class="field-link" type="button" data-password-toggle="forgot-confirm-password">${copy.t("auth.show")}</button>
        </span>
      </label>
      <button class="btn btn-primary btn-block" type="submit" data-auth-submit>${copy.t("auth.reset")}</button>
    </form>
    <p class="login-alt"><button type="button" class="text-link" data-nav="login">${copy.t("auth.back")}</button></p>
  `;

  const form = body.querySelector("form");
  const leaveProtection = bindAuthLeaveProtection(body, {
    onNavigate,
    title: copy.t("auth.leaveTitle"),
    message: copy.t("auth.leaveMessage"),
    confirmText: copy.t("auth.leave"),
    cancelText: copy.t("auth.stay"),
  });
  const validatePasswords = bindConfirmPasswordValidation(body, { message: copy.t("auth.passwordMismatch") });
  body.querySelector("[data-nav='login']")?.addEventListener("click", () => leaveProtection.navigate("login"));
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearAuthMessage(form);
    if (!validatePasswords({ flash: true })) {
      return;
    }
    setSubmitButtonBusy(form, true, copy.t("auth.reset"), copy.t("auth.resetting"));
    const data = new FormData(event.currentTarget);
    const result = await onSubmit?.({
      email: String(data.get("email") || "").trim(),
      code: String(data.get("code") || "").trim(),
      password: String(data.get("password") || ""),
      confirmPassword: String(data.get("confirmPassword") || ""),
    });
    if (result?.ok === false) {
      setAuthMessage(form, authError(result.error, copy, "auth.resetFailed"));
      setSubmitButtonBusy(form, false, copy.t("auth.reset"));
      return;
    }
    setAuthMessage(form, copy.t("auth.resetSuccess"), "success");
    leaveProtection.markSubmitted();
    event.currentTarget.reset();
    setSubmitButtonBusy(form, false, copy.t("auth.reset"));
  });
  bindPasswordToggle(body, { copy });
  bindCodeSender(body, onSendCode, {
    onResult: (result) => {
      if (result?.ok === false) {
        setAuthMessage(form, authError(result.error, copy, "auth.codeFailed"));
      }
    },
    copy,
  });

  return createAuthPage({
    title: copy.t("auth.reset"),
    subtitle: copy.t("auth.resetSubtitle"),
    body,
    ariaLabel: copy.t("auth.reset"),
    pageLanguage,
  });
}

function authError(error, copy, fallbackKey) {
  return getUserFacingErrorMessage(error || copy.t(fallbackKey), {
    pageLanguage: copy.language.code,
    fallbackType: "auth",
  });
}
