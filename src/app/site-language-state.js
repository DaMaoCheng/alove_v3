import { normalizeSiteLanguage } from "../../shared/site-language.js";

export function applySiteLanguage(appState, value = "") {
  const language = normalizeSiteLanguage(value);
  appState.site.language = language;
  appState.site.pageLanguage = language.label;
  if (typeof document !== "undefined") document.documentElement.lang = language.uiCode;
  return language;
}

export function applySiteBranding(appState, branding = null) {
  appState.site.branding = branding;
  return applySiteLanguage(appState, branding?.language);
}
