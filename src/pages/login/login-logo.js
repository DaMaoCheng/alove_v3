import { createSiteCopy } from "../../i18n/site-copy.js";

export function createLogo() {
  const copy = createSiteCopy(globalThis.document?.documentElement?.lang || "English");
  const logo = document.createElement("a");
  logo.className = "logo";
  logo.href = "/";
  logo.setAttribute("aria-label", copy.t("common.home"));
  logo.innerHTML = `
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="13" fill="none" stroke="currentColor" stroke-width="2"></circle>
      <path class="logo-mark-core" d="M16 9l5.5 4-2.1 6.5h-6.8L10.5 13 16 9z" fill="currentColor"></path>
    </svg>
    <span class="word">AI<b>OVE</b></span>
  `;

  return logo;
}
