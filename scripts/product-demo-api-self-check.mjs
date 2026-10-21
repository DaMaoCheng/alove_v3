import assert from "node:assert/strict";
import { handleApiRoute } from "../server/routes.js";

const req = {
  method: "GET",
  url: "/api/demo/products?q=recommended&intent=quick_product&limit=5",
  headers: { host: "127.0.0.1:4173" },
};
const res = createFakeResponse();

const handled = await handleApiRoute(req, res);
assert.equal(handled, true, "demo product API should be handled by API router");
assert.equal(res.statusCode, 200, "demo product API should return 200");

const payload = JSON.parse(res.body);
assert.ok(Array.isArray(payload.products), "demo product API should return products array");
assert.ok(payload.products[0]?.title, "demo product API should return a product title");
assert.ok(payload.products[0]?.image_url, "demo product API should return image_url for product card");
assert.ok(payload.products[0]?.url, "demo product API should return product url");
assert.ok(payload.products[0]?.priceNow, "demo product API should return a direct product card price");
assert.ok(payload.products[0]?.buttonText, "demo product API should return a direct product card button label");

console.log("product demo API self-check passed");

function createFakeResponse() {
  return {
    statusCode: 0,
    headers: {},
    body: "",
    writeHead(statusCode, headers = {}) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    end(body = "") {
      this.body = String(body || "");
    },
  };
}
