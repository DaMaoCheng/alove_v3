const USER_AGENT_MAX_LENGTH = 500;

export function normalizeUserAgent(value = "") {
  return String(value || "").trim().slice(0, USER_AGENT_MAX_LENGTH);
}

export function describeUserAgent(value = "") {
  const userAgent = normalizeUserAgent(value);
  if (!userAgent) return "";
  return [detectDeviceType(userAgent), detectOperatingSystem(userAgent), detectBrowser(userAgent)]
    .filter(Boolean)
    .join(" · ");
}

function detectDeviceType(userAgent) {
  if (/iPad|Tablet|PlayBook|Silk/i.test(userAgent)) return "平板";
  if (/Android/i.test(userAgent) && !/Mobile/i.test(userAgent)) return "平板";
  if (/iPhone|iPod|Mobile|Android|Windows Phone/i.test(userAgent)) return "手机";
  return "电脑";
}

function detectOperatingSystem(userAgent) {
  if (/iPhone|iPad|iPod/i.test(userAgent)) return "iOS";
  if (/Android/i.test(userAgent)) return "Android";
  if (/Windows Phone/i.test(userAgent)) return "Windows Phone";
  if (/Windows/i.test(userAgent)) return "Windows";
  if (/Macintosh|Mac OS X/i.test(userAgent)) return "macOS";
  if (/CrOS/i.test(userAgent)) return "ChromeOS";
  if (/Linux/i.test(userAgent)) return "Linux";
  return "其他系统";
}

function detectBrowser(userAgent) {
  if (/EdgA?\//i.test(userAgent)) return "Edge";
  if (/OPR\//i.test(userAgent)) return "Opera";
  if (/CriOS\//i.test(userAgent)) return "Chrome";
  if (/FxiOS\//i.test(userAgent)) return "Firefox";
  if (/Chrome\//i.test(userAgent)) return "Chrome";
  if (/Firefox\//i.test(userAgent)) return "Firefox";
  if (/Safari\//i.test(userAgent)) return "Safari";
  return "其他浏览器";
}
