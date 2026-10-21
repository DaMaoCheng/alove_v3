import { createLogo } from "./login-logo.js";
import { createThemeToggle } from "./theme-toggle.js";
import { bindPasswordToggle } from "../auth/auth-form-controls.js";
import { clearAuthMessage, setAuthMessage, setSubmitButtonBusy } from "../auth/auth-form-state.js";
import { bindSiteBrandImage } from "../../features/shared-ui/site-branding.js";
import { createSiteCopy } from "../../i18n/site-copy.js";
import { getUserFacingErrorMessage } from "../../utils/user-facing-error.js";

export function createLoginPage({ onNavigate, onSubmit, onGoogleLogin, onSiteLogin, siteBranding = null, pageLanguage = "English" }) {
  const copy = createSiteCopy(pageLanguage);
  const page = document.createElement("div");
  page.className = "login";
  page.setAttribute("aria-label", copy.t("auth.signIn"));

  const hero = createHeroPanel(copy);
  const formPanel = createFormPanel({ onNavigate, onSubmit, onGoogleLogin, onSiteLogin, siteBranding, copy });

  page.append(hero, formPanel);
  return page;
}

function createHeroPanel(copy) {
  const hero = document.createElement("div");
  hero.className = "login-hero";
  hero.append(createLogo());

  const copyElement = document.createElement("div");
  copyElement.className = "login-hero-copy";
  copyElement.innerHTML = `
    <span class="eyebrow">${copy.t("auth.heroEyebrow")}</span>
    <h1>${copy.t("auth.heroTitle")}</h1>
    <p>${copy.t("auth.heroBody")}</p>
    <div class="login-hero-tags" aria-label="${copy.t("auth.heroTags")}">
      <span>${copy.t("auth.legends")}</span>
      <span>${copy.t("auth.drops")}</span>
      <span>${copy.t("auth.always")}</span>
    </div>
  `;

  hero.append(copyElement);
  return hero;
}

function createFormPanel({ onNavigate, onSubmit, onGoogleLogin, onSiteLogin, siteBranding, copy }) {
  const panel = document.createElement("div");
  panel.className = "login-form-wrap";

  const card = document.createElement("div");
  card.className = "login-card";

  const top = document.createElement("div");
  top.className = "login-top";
  top.append(createThemeToggle());

  const title = document.createElement("div");
  title.className = "login-title";
  title.innerHTML = `
    <h2>${copy.t("auth.welcome")}</h2>
    <p class="sub">${copy.t("auth.rejoin")}</p>
  `;

  const googleButton = document.createElement("button");
  googleButton.className = "btn-google";
  googleButton.type = "button";
  googleButton.innerHTML = `${googleIcon()}<span>${copy.t("auth.google")}</span>`;
  googleButton.addEventListener("click", () => onGoogleLogin?.());

  const siteLoginButton = createSiteLoginButton(siteBranding, onSiteLogin, copy);

  const separator = document.createElement("div");
  separator.className = "or-line";
  separator.innerHTML = `<span>${copy.t("auth.emailSeparator")}</span>`;

  const form = document.createElement("form");
  form.className = "login-form";
  form.innerHTML = `
    <label class="field">
      <span>${copy.t("auth.email")}</span>
      <input name="username" type="email" autocomplete="username" placeholder="you@email.com" />
    </label>
    <label class="field">
      <span>${copy.t("auth.password")}</span>
      <span class="field-inline">
        <input id="login-password" name="password" type="password" autocomplete="current-password" placeholder="••••••••" />
        <button class="field-link" type="button" data-password-toggle="login-password">${copy.t("auth.show")}</button>
      </span>
    </label>
    <p class="auth-message" data-auth-message role="alert" aria-live="polite" hidden></p>
    <div class="login-options">
      <label class="login-check">
        <input name="rememberMe" type="checkbox" checked />
        <span>${copy.t("auth.remember")}</span>
      </label>
      <button class="text-link" type="button" data-nav="forgot-password">${copy.t("auth.forgot")}</button>
    </div>
    <button class="btn btn-primary btn-block" type="submit" data-auth-submit>${copy.t("auth.enter")}</button>
  `;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearAuthMessage(form);
    setSubmitButtonBusy(form, true, copy.t("auth.enter"), copy.t("auth.signingIn"));
    const data = new FormData(form);
    const result = await onSubmit?.({
      username: String(data.get("username") || "").trim(),
      password: String(data.get("password") || ""),
      rememberMe: data.get("rememberMe") === "on",
    });
    if (result?.ok === false) {
      setAuthMessage(form, getUserFacingErrorMessage(result.error || copy.t("auth.failed"), {
        pageLanguage: copy.language.code,
        fallbackType: "auth",
      }));
      setSubmitButtonBusy(form, false, copy.t("auth.enter"));
    }
  });
  bindPasswordToggle(form, { copy });
  form.querySelector("[data-nav='forgot-password']")?.addEventListener("click", () => {
    onNavigate?.("forgot-password");
  });

  const footer = document.createElement("p");
  footer.className = "login-alt";
  footer.innerHTML = `${copy.t("auth.newHere")} <button type="button" class="text-link" data-nav="register">${copy.t("auth.createAccount")}</button>`;
  footer.querySelector("[data-nav='register']")?.addEventListener("click", () => {
    onNavigate?.("register");
  });

  card.append(top, title, googleButton);
  if (siteLoginButton) card.append(siteLoginButton);
  card.append(separator, form, footer);
  panel.append(card);
  return panel;
}

function createSiteLoginButton(siteBranding, onSiteLogin, copy) {
  if (!siteBranding?.hasProductAccessToken || !siteBranding?.shopifyLoginEnabled || !siteBranding?.slug || !siteBranding?.name) return null;
  const isAvailable = typeof onSiteLogin === "function";
  const button = document.createElement("button");
  button.className = "btn-site-auth";
  button.type = "button";
  button.disabled = !isAvailable;
  if (!isAvailable) button.title = copy.t("auth.shopifyPending");
  button.innerHTML = `
    <span class="site-auth-logo"><img alt="" hidden /><span aria-hidden="true">${siteInitial(siteBranding.name)}</span></span>
    <span class="site-auth-copy">${escapeText(copy.t("auth.continueWith", { name: siteBranding.name }))}</span>
    <span class="site-auth-provider" aria-label="Shopify"><img src="/assets/brand/shopify-wordmark-white.svg" alt="" /></span>`;
  bindSiteBrandImage(button.querySelector("img"), button.querySelector(".site-auth-logo > span"), {
    logoUrl: siteBranding.logoUrl,
    siteUrl: siteBranding.siteUrl,
  });
  if (isAvailable) button.addEventListener("click", () => onSiteLogin(siteBranding));
  return button;
}

function siteInitial(value = "") {
  return escapeText(String(value || "").trim().charAt(0).toUpperCase() || "S");
}

function escapeText(value = "") {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
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
