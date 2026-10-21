import { listPublishedHomeCarouselItems } from "./home-carousel-service.js";
import { sendJson } from "./http-utils.js";

export async function handleHomeRoute(req, res, { path }) {
  if (req.method === "GET" && path === "/api/home/carousel") {
    const requestUrl = new URL(req.url || "/", "http://localhost");
    sendJson(res, 200, await listPublishedHomeCarouselItems({
      siteSlug: requestUrl.searchParams.get("siteSlug") || "",
    }));
    return true;
  }
  return false;
}
