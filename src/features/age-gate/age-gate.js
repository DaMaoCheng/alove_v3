import { createSiteCopy } from "../../i18n/site-copy.js";

export const AGE_GATE_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;
const AGE_GATE_AVATARS = ["bs", "cf", "mtt", "pj", "tfk", "tms"];
const AGE_GATE_COOKIE_PREFIX = "aiove_age_verified_";
const EXEMPT_PATH_PREFIXES = ["/admin", "/creator"];

function normalizeSiteSlug(siteSlug) {
  const normalized = String(siteSlug || "default").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
  return normalized || "default";
}

export function getAgeGateCookieName(siteSlug) {
  return `${AGE_GATE_COOKIE_PREFIX}${normalizeSiteSlug(siteSlug)}`;
}

export function shouldRequireAgeGate(pathname = "") {
  const normalizedPath = String(pathname || "/").trim().toLowerCase();
  return !EXEMPT_PATH_PREFIXES.some((prefix) => normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`));
}

export function readAgeGateCookie(cookieString = "", siteSlug) {
  const cookieName = getAgeGateCookieName(siteSlug);
  const token = `${encodeURIComponent(cookieName)}=1`;
  return String(cookieString || "").split(";").some((part) => part.trim() === token);
}

export function setAgeGateCookie(documentRef, siteSlug) {
  const secure = documentRef?.defaultView?.location?.protocol === "https:" ? "; Secure" : "";
  documentRef.cookie = `${encodeURIComponent(getAgeGateCookieName(siteSlug))}=1; Max-Age=${AGE_GATE_MAX_AGE_SECONDS}; Path=/; SameSite=Lax${secure}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getCopy(pageLanguage) {
  const copy = createSiteCopy(pageLanguage || "en");
  return {
    title: copy.t("ageGate.title"),
    body: copy.t("ageGate.body"),
    note: copy.t("ageGate.note"),
    confirm: copy.t("ageGate.confirm"),
    cancel: copy.t("ageGate.cancel"),
  };
}

export function enforceAgeGate({ pageLanguage, siteSlug, documentRef = document, windowRef = window } = {}) {
  if (!documentRef?.body || !shouldRequireAgeGate(windowRef?.location?.pathname)) return Promise.resolve({ skipped: true });
  if (readAgeGateCookie(documentRef.cookie, siteSlug)) return Promise.resolve({ skipped: true });
  if (documentRef.querySelector("[data-age-gate]")) return Promise.resolve({ skipped: true });

  const copy = getCopy(pageLanguage);
  const host = documentRef.createElement("div");
  host.dataset.ageGate = "true";
  host.innerHTML = `
    <div class="age-gate-scrim" aria-hidden="true"></div>
    <section class="age-gate-modal" role="alertdialog" aria-modal="true" aria-labelledby="age-gate-title" aria-describedby="age-gate-body">
      <h2 id="age-gate-title"><span class="age-gate-avatars" aria-hidden="true">${AGE_GATE_AVATARS.map((name, index) => `<img src="/assets/age-gate/${name}.png" alt="" width="256" height="256" class="${index === 0 ? "is-current" : ""}" />`).join("")}</span><span class="age-gate-title-text">${escapeHtml(copy.title).replace("18+", '<span class="age-gate-title-accent">18+</span>')}</span></h2>
      <p id="age-gate-body" class="age-gate-body">${escapeHtml(copy.body)}</p>
      <p class="age-gate-note">${escapeHtml(copy.note)}</p>
      <div class="age-gate-actions">
        <button type="button" class="age-gate-cancel">${escapeHtml(copy.cancel)}</button>
        <button type="button" class="age-gate-confirm">${escapeHtml(copy.confirm)}</button>
      </div>
    </section>
  `;
  documentRef.body.append(host);
  documentRef.body.classList.add("age-gate-open");

  const avatars = [...host.querySelectorAll(".age-gate-avatars img")];
  let avatarIndex = avatars.length ? Math.floor(Math.random() * avatars.length) : 0;
  avatars.forEach((avatar, index) => avatar.classList.toggle("is-current", index === avatarIndex));
  const avatarTimer = avatars.length > 1 && !windowRef.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? windowRef.setInterval(() => {
    avatars[avatarIndex].classList.remove("is-current");
    avatarIndex = (avatarIndex + 1) % avatars.length;
    avatars[avatarIndex].classList.add("is-current");
  }, 3000) : null;

  return new Promise((resolve) => {
    const cleanup = () => {
      if (avatarTimer !== null) windowRef.clearInterval(avatarTimer);
      host.remove();
      documentRef.body.classList.remove("age-gate-open");
    };
    host.querySelector(".age-gate-confirm")?.addEventListener("click", () => {
      setAgeGateCookie(documentRef, siteSlug);
      cleanup();
      resolve({ confirmed: true });
    });
    host.querySelector(".age-gate-cancel")?.addEventListener("click", () => {
      if (avatarTimer !== null) windowRef.clearInterval(avatarTimer);
      if (windowRef?.location?.replace) windowRef.location.replace("about:blank");
      resolve({ cancelled: true });
    });
    host.querySelector(".age-gate-confirm")?.focus();
  });
}
