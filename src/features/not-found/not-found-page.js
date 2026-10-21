import { ICONS } from "../../icons/icons.js";
import { createSiteCopy } from "../../i18n/site-copy.js";

export function createNotFoundPage({ onNavigate, pageLanguage = "English" } = {}) {
  const copy = createSiteCopy(pageLanguage);
  const page = document.createElement("div");
  page.className = "page notfound";
  page.innerHTML = `
    <div class="nf-card">
      <div class="nf-code">4<span class="nf-ball">${ICONS.ball}</span>4</div>
      <h2>${copy.t("notFound.title")}</h2>
      <p>${copy.t("notFound.body")}</p>
      <div class="nf-actions">
        <button class="btn btn-primary" type="button" data-nav="discover">${ICONS.compass}<span>${copy.t("notFound.back")}</span></button>
      </div>
    </div>
  `;
  page.querySelector("[data-nav='discover']")?.addEventListener("click", () => onNavigate?.("discover"));
  return page;
}
