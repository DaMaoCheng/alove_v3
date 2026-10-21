const ANALYTICS_NAMESPACE = "aiove";

export function trackEvent(name, payload = {}) {
  const event = {
    namespace: ANALYTICS_NAMESPACE,
    name,
    payload,
    timestamp: new Date().toISOString(),
  };

  window.dispatchEvent(new CustomEvent("aiove:analytics", { detail: event }));

  if (window.localStorage?.getItem("aiove_debug_analytics") === "1") {
    console.info("[analytics]", event);
  }
}
