export function resolveSiteBrandLogoCandidates({ logoUrl = "", siteUrl = "", productUrl = "" } = {}) {
  return uniqueUrls([
    normalizeHttpUrl(logoUrl),
    faviconUrlFor(siteUrl),
    faviconUrlFor(productUrl),
  ]);
}

export function bindSiteBrandImage(image, fallback, options = {}) {
  if (!image) return;
  const candidates = resolveSiteBrandLogoCandidates(options);
  let index = 0;
  const showFallback = () => {
    image.hidden = true;
    image.removeAttribute("src");
    if (fallback) fallback.hidden = false;
  };
  const loadNext = () => {
    const nextUrl = candidates[index++];
    if (!nextUrl) {
      showFallback();
      return;
    }
    image.hidden = true;
    if (fallback) fallback.hidden = false;
    image.src = nextUrl;
  };
  image.onload = () => {
    image.hidden = false;
    if (fallback) fallback.hidden = true;
  };
  image.onerror = loadNext;
  loadNext();
}

export function faviconUrlFor(value = "") {
  const url = normalizeHttpUrl(value);
  if (!url) return "";
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return host ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64` : "";
  } catch {
    return "";
  }
}

function normalizeHttpUrl(value = "") {
  const text = String(value || "").trim();
  if (!text) return "";
  try {
    const url = new URL(text);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : "";
  } catch {
    return "";
  }
}

function uniqueUrls(values = []) {
  return [...new Set(values.filter(Boolean))];
}
