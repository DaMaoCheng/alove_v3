import { createLogo } from "../login/login-logo.js";
import { createThemeToggle } from "../login/theme-toggle.js";
import { createSiteCopy } from "../../i18n/site-copy.js";

export function createAuthPage({ title, subtitle, body, ariaLabel, pageLanguage = "English" }) {
  const copy = createSiteCopy(pageLanguage);
  const page = document.createElement("div");
  page.className = "login";
  page.setAttribute("aria-label", ariaLabel);

  const hero = document.createElement("div");
  hero.className = "login-hero";
  hero.append(createLogo(), createHeroCopy(copy));

  const panel = document.createElement("div");
  panel.className = "login-form-wrap";

  const card = document.createElement("div");
  card.className = "login-card";

  const top = document.createElement("div");
  top.className = "login-top";
  top.append(createThemeToggle());

  const heading = document.createElement("div");
  heading.className = "login-title";
  heading.innerHTML = `
    <h2>${title}</h2>
    <p class="sub">${subtitle}</p>
  `;

  card.append(top, heading, body);
  panel.append(card);
  page.append(hero, panel);

  return page;
}

function createHeroCopy(copy) {
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

  return copyElement;
}
