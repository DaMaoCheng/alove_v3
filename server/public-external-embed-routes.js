import { createExternalEmbedHandoff, getPublicExternalEmbed } from "./external-embed-service.js";
import { readJson } from "./http-utils.js";
import { securityHeaders } from "./security-response-utils.js";

export async function handlePublicExternalEmbedRoute(req, res, { path, requestUrl }) {
  if (path === "/api/embed/handoff" && req.method === "OPTIONS") {
    sendEmbedPreflight(res, String(req.headers.origin || "").trim());
    return true;
  }
  if (path === "/api/embed/handoff" && req.method === "POST") {
    const origin = String(req.headers.origin || "").trim();
    const body = await readJson(req, 16 * 1024) || {};
    const handoff = await createExternalEmbedHandoff({
      publicId: body.embed || body.publicId,
      requestOrigin: origin,
      sourceUrl: body.sourceUrl || body.source_url,
      sourceTitle: body.sourceTitle || body.source_title,
    });
    if (!handoff) {
      sendEmbedJson(res, 404, { ok: false, error: "Handoff unavailable." });
      return true;
    }
    sendEmbedJson(res, 200, { ok: true, handoff: handoff.token }, origin);
    return true;
  }
  if (req.method !== "GET" || path !== "/api/embed/config") return false;
  const origin = String(req.headers.origin || "").trim();
  const widget = await getPublicExternalEmbed(requestUrl.searchParams.get("embed") || "", origin);
  if (!widget) {
    sendEmbedJson(res, 404, { ok: false, error: "Widget not found." });
    return true;
  }
  sendEmbedJson(res, 200, { ok: true, widget }, origin);
  return true;
}

function sendEmbedPreflight(res, origin = "") {
  res.writeHead(204, {
    ...securityHeaders(),
    ...(origin ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {}),
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Accept, Content-Type",
    "Access-Control-Max-Age": "600",
  });
  res.end();
}

function sendEmbedJson(res, statusCode, payload, origin = "") {
  res.writeHead(statusCode, {
    ...securityHeaders(),
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...(origin ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {}),
  });
  res.end(JSON.stringify(payload));
}
