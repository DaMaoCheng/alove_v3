import { ProxyAgent, setGlobalDispatcher } from "undici";
import { SERVER_CONFIG } from "./config.js";

export function configureNetworkProxy() {
  const proxyUrl = SERVER_CONFIG.network.proxyUrl;
  if (!proxyUrl) return;

  setGlobalDispatcher(new ProxyAgent(proxyUrl));
  console.info(`[aiove] outbound fetch proxy enabled: ${redactProxyUrl(proxyUrl)}`);
}

function redactProxyUrl(value) {
  try {
    const url = new URL(value);
    if (url.username || url.password) {
      url.username = "***";
      url.password = "***";
    }
    return url.toString();
  } catch {
    return "<configured>";
  }
}
