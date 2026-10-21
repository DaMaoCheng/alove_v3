import assert from "node:assert/strict";
import { createServer } from "node:http";
import { buildMascotProductContext } from "../server/mascot-product-context-service.js";

process.env.NODE_ENV = "test";
process.env.AIOVE_ALLOW_LOCAL_PRODUCT_SOURCE_SELF_CHECK = "true";

const seenRequests = [];

const productServer = createServer((req, res) => {
  const requestUrl = new URL(req.url, "http://127.0.0.1");
  seenRequests.push(requestUrl);
  res.setHeader("Content-Type", "application/json");

  if (requestUrl.pathname === "/products") {
    res.end(JSON.stringify({
      products: [
        { title: "Arsenal Home Football Shirt 2026/27", type: "Arsenal", price: "23.00", url: "/arsenal-home" },
        { title: "AC Milan Home Football Shirt 2026/27", type: "AC Milan", price: "25.00", url: "/ac-milan-home" },
        { title: "Manchester United Home Football Shirt 2026/27", type: "Manchester United", price: "23.00", url: "/man-utd-home" },
      ],
    }));
    return;
  }

  res.statusCode = 404;
  res.end(JSON.stringify({ error: "not found" }));
});

await new Promise((resolve) => productServer.listen(0, "127.0.0.1", resolve));
const baseUrl = `http://127.0.0.1:${productServer.address().port}`;

try {
  const db = createFakeDb(baseUrl);
  const character = { id: "fan", category_id: "creator", site_id: "site_test" };
  const userId = "user_admin";

  const directContext = await buildMascotProductContext(db, {
    character,
    userId,
    userText: "emmm, ac milan do you have?",
  });
  assert.equal(directContext.searchIntent.requestedTeam, "AC Milan", "AC Milan availability question should extract a team");
  assert.match(directContext.searchIntent.query, /ac milan/i, "direct AC Milan question should search AC Milan");
  assert.equal(directContext.products[0].name, "AC Milan Home Football Shirt 2026/27", "direct AC Milan question should not pick Arsenal first");

  const followupContext = await buildMascotProductContext(db, {
    character,
    userId,
    userText: "the home shirt",
    recentMessages: [
      { senderType: "user", text: "emmm, ac milan do you have?" },
      { senderType: "character", text: "Which AC Milan shirt are you after?" },
    ],
  });
  assert.equal(followupContext.searchIntent.contextSource, "recent_product_context", "short product follow-up should inherit recent product context");
  assert.equal(followupContext.searchIntent.query, "AC Milan", "short home shirt follow-up should preserve AC Milan while keeping the Shopify source query broad");
  assert.equal(followupContext.products[0].name, "AC Milan Home Football Shirt 2026/27", "short follow-up should not fall back to Arsenal");

  const correctionContext = await buildMascotProductContext(db, {
    character,
    userId,
    userText: "no, i want ac milan home kit bro. no arsenal",
    recentMessages: [
      { senderType: "character", text: "Arsenal Home Football Shirt 2026/27" },
    ],
  });
  assert.equal(correctionContext.searchIntent.isCorrection, true, "explicit no/i want correction should be marked");
  assert.deepEqual(correctionContext.searchIntent.excludeTeams, ["Arsenal"], "no Arsenal should exclude Arsenal");
  assert.equal(correctionContext.products[0].name, "AC Milan Home Football Shirt 2026/27", "correction should reselect AC Milan");
  assert.ok(!correctionContext.products.some((product) => /arsenal/i.test(product.name)), "excluded teams should not remain in products");

  const nonProductContext = await buildMascotProductContext(db, {
    character,
    userId,
    userText: "does AC Milan have a game tonight?",
  });
  assert.equal(nonProductContext, null, "fixture questions should not trigger product search");

  console.log("product context AC Milan regression self-check passed");
} finally {
  await new Promise((resolve) => productServer.close(resolve));
}

function createFakeDb(baseUrl) {
  return {
    async execute(sql, values = []) {
      if (sql.includes("WHERE s.id = ?")) {
        return [[{ id: values[0], name: "Test Store", slug: "test-store", currency: "GBP", product_api_url: `${baseUrl}/products` }]];
      }
      if (sql.includes("FROM users u")) return [[]];
      if (sql.includes("FROM sites") && sql.includes("is_default = 1")) return [[]];
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}
