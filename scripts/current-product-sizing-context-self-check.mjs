import assert from "node:assert/strict";
import dns from "node:dns/promises";
process.env.AIOVE_PROVIDER_LOG_WRITE_ENABLED = "false";
const savedFetch = globalThis.fetch;
const savedLookup = dns.lookup;
dns.lookup = async () => { throw new Error("External DNS disabled for sizing self-check"); };
globalThis.fetch = async () => { throw new Error("External calls disabled for sizing self-check"); };
const { selectProductForMessage } = await import("../server/chat-product-reply-service.js");
const { closeDbPool } = await import("../server/db.js");
const site = { id: "site_test", slug: "test", site_url: "https://shop.invalid", currency: "GBP", product_api_url: "https://shop.invalid/products" };
const chart = { title: "Product size chart", unit: "CM", columns: ["Size", "Chest"], rows: [["M", "100–104"]], secret: "must not escape" };
const product = { id: "p1", productId: "p1", name: "Current shirt", url: "https://shop.invalid/products/current", siteId: site.id, siteSlug: site.slug, sizes: [{ label: "M", available: true }] };
let checks = 0;
const check = (value, label) => { assert.ok(value, label); checks++; };
try {
  const selected = selectProductForMessage({ siteId: site.id, siteSlug: site.slug, products: [{ ...product, sizeChart: chart, sizeChartResolved: true }] });
  check(selected.sizeChart?.rows[0][1] === "100–104" && selected.sizeChartResolved === true && !selected.sizeChart.secret, "safe card mapping preserves verified bounded chart and resolution state");
  const { resolveTrustedCurrentProductSizing, formatTrustedProductSizingFacts } = await import("../server/product-sizing-context-service.js");
  let calls = 0;
  const resolveProduct = async (options) => {
    calls++;
    check(options.strictSite === true && options.exactProduct === true && options.siteSlug === site.slug && options.product.id === product.id, "hydration requires strict current site and exact product mode");
    return { site: { id: site.id, slug: site.slug, siteUrl: site.site_url }, resolvedFromSource: true, sourceItem: { ...product, sizeChart: chart, sizeChartResolved: true }, item: { ...product, sizeChart: { secret: "merged client chart" } } };
  };
  const hydrated = await resolveTrustedCurrentProductSizing({ site, product, resolveProduct });
  check(calls === 1 && hydrated.sizeChart?.rows[0][1] === "100–104" && !hydrated.sizeChart.secret, "one bounded lookup adopts only sanitized sourceItem chart");
  const facts = formatTrustedProductSizingFacts(hydrated);
  check(facts.includes("CM") && facts.includes("Chest") && facts.includes("100–104") && !facts.includes("secret"), "trusted formatter exposes table, explicit units and no arbitrary metadata");
  check(formatTrustedProductSizingFacts({ ...hydrated, sizeChart: { ...chart, unit: "" } }).includes("Do not assume units"), "a source without units cannot invent centimetres or kilograms");
  check(formatTrustedProductSizingFacts({ ...hydrated, sizes: [{ label: "M" }, { label: "L", available: false }] }).includes("M [availability unverified]") && formatTrustedProductSizingFacts({ ...hydrated, sizes: [{ label: "L", available: false }] }).includes("L [not available]"), "labels do not claim stock availability when the source did not confirm it");
  const malformedCard = selectProductForMessage({ siteId: site.id, siteSlug: site.slug, products: [{ ...product, sizeChart: { columns: ["Size"] }, sizeChartResolved: true }] });
  check(!malformedCard.sizeChart && malformedCard.sizeChartResolved === false, "malformed chart cannot become confirmed no-table state at card mapping");
  calls = 0;
  await resolveTrustedCurrentProductSizing({ site, product: { ...product, sizeChart: chart, sizeChartResolved: true }, resolveProduct });
  await resolveTrustedCurrentProductSizing({ site, product: { ...product, sizeChart: null, sizeChartResolved: true }, resolveProduct });
  check(calls === 0, "verified historical chart and confirmed no-table state are reused without refetching");
  for (const result of [
    { resolvedFromSource: false, site: { id: site.id, slug: site.slug }, item: { ...product, sizeChart: chart, sizeChartResolved: true } },
    { resolvedFromSource: true, site: { id: "other", slug: site.slug }, sourceItem: { ...product, sizeChart: chart, sizeChartResolved: true } },
    { resolvedFromSource: true, site: { id: site.id, slug: "other" }, sourceItem: { ...product, sizeChart: chart, sizeChartResolved: true } },
    { resolvedFromSource: true, site: { id: site.id, slug: site.slug }, sourceItem: { ...product, id: "p2", productId: "p2", sizeChart: chart, sizeChartResolved: true } },
    { resolvedFromSource: true, site: { id: site.id, slug: site.slug }, sourceItem: { ...product, id: "", productId: "", url: "https://other.invalid/products/current", sizeChart: chart, sizeChartResolved: true } },
  ]) {
    const rejected = await resolveTrustedCurrentProductSizing({ site, product, resolveProduct: async () => result });
    check(!rejected.sizeChart && rejected.sizeChartResolved === false && rejected.sizes[0].label === "M", "unresolved, cross-site, ID-conflicting or origin-mismatching data cannot hydrate a chart or replace current labels");
  }
  const unavailable = await resolveTrustedCurrentProductSizing({ site, product, resolveProduct: async () => { throw new Error("private credential should never escape"); } });
  check(unavailable.sizeChartResolved === false && !JSON.stringify(unavailable).includes("credential"), "failed lookup stays unknown with no raw error disclosure");
  const noTable = await resolveTrustedCurrentProductSizing({ site, product, resolveProduct: async () => ({ site: { id: site.id, slug: site.slug }, resolvedFromSource: true, sourceItem: { ...product, sizeChart: null, sizeChartResolved: true } }) });
  check(noTable.sizeChart === null && noTable.sizeChartResolved === true, "successful no-table result remains distinct from failure");
  check(formatTrustedProductSizingFacts(noTable).includes("lookup completed without") && formatTrustedProductSizingFacts(unavailable).includes("Do not infer that this product has no chart"), "formatter keeps source-confirmed no-table separate from failure");
  const urlOnly = await resolveTrustedCurrentProductSizing({ site, product: { ...product, id: "", productId: "" }, resolveProduct: async () => ({ site: { id: site.id, slug: site.slug, siteUrl: site.site_url }, resolvedFromSource: true, sourceItem: { ...product, sizeChart: chart, sizeChartResolved: true } }) });
  check(urlOnly.sizeChart?.rows.length === 1, "trusted complete matching product URL supports a historical card without an ID");
  const { resolveProductSizingGuidanceReply } = await import("../server/product-sizing-guidance-service.js");
  check(resolveProductSizingGuidanceReply({ sourceRef: "current-product-sizing-context", sizingProduct: hydrated }, { userText: "What chest range is listed for M?", languageCode: "en" }) === "", "verified chart question is not overwritten by label-only fixed copy");
  check(resolveProductSizingGuidanceReply({ sourceRef: "guest-site-product-sizing-match", sizingProduct: hydrated }, { userText: "Explain the size chart", languageCode: "en" }) === "", "matched chart facts also preserve substantive sizing answers");
  check(resolveProductSizingGuidanceReply({ sourceRef: "current-product-sizing-context", sizingProduct: product, searchIntent: { answerRequired: true } }, { userText: "What is M and how long does delivery take?", languageCode: "en" }) === "", "mixed sizing question cannot be replaced by a fixed label-only reply");
  const { resolveGuestProductRecommendation } = await import("../server/guest-chat-product-service.js");
  const { buildChatProductRecommendationContext } = await import("../server/chat-product-recommendation-service.js");
  const db = { execute: async (sql) => { if (/FROM sites/.test(sql)) return [[site]]; throw new Error("unexpected SQL in isolated sizing check"); } };
  const recentMessages = [{ senderType: "character", contentType: "product", product }];
  const precomputedSearchIntent = { intent: "sizing", answerRequired: true, cardAllowed: false, commerceRoute: "product_question", commerceTopic: "sizing", needsLiveProductData: true };
  for (const isGuest of [true, false]) {
    let hydrations = 0;
    const resolveSizingProduct = async (options) => { hydrations++; check(options.product.id === "p1" && options.site.id === site.id, "both paths share strict current-product sizing hydration"); return hydrated; };
    const options = { userText: "What chest measurement is listed?", recentMessages, precomputedSearchIntent, resolveSizingProduct, classifyCommerce: null };
    const context = isGuest ? (await resolveGuestProductRecommendation(db, { ...options, guest: { site_id: site.id }, searchProducts: async () => { throw new Error("must not search another product"); } })).context
      : await buildChatProductRecommendationContext(db, { ...options, character: { id: "mascot_test", category_id: "mascot", site_id: site.id }, fetchProducts: async () => { throw new Error("must not search another product"); } });
    check(hydrations === 1 && context.sizingProduct.sizeChart.rows[0][1] === "100–104" && context.cardAllowed === false && context.products.length === 0, "guest and member retain hydrated sizing facts without a new card");
  }
  const productB = { ...product, id: "p2", productId: "p2", name: "Newer shirt", url: "https://shop.invalid/products/newer" };
  const twoCards = [{ senderType: "character", contentType: "product", product }, { senderType: "character", contentType: "product", product: productB }];
  for (const isGuest of [true, false]) {
    for (const variant of ["explicit_A", "explicit_sizing_A", "plus_size_A", "missing", "cross_site_card", "cross_site_reference", "unresolved", "latest", "semantic_only"]) {
      const selectedIds = [];
      const messages = variant === "cross_site_card" ? [{ ...twoCards[0], product: { ...product, siteId: "other" } }, twoCards[1]] : twoCards;
      const intent = { ...precomputedSearchIntent,
        ...(variant === "semantic_only" ? { intent: "browse" } : {}),
        ...(["explicit_sizing_A", "plus_size_A"].includes(variant) ? { explicitSizingProductSearch: true, requestedSizes: ["M"] } : {}),
        ...(variant === "plus_size_A" ? { requestedSizeProfile: "plus_size" } : {}),
        ...(variant === "latest" ? {} : { referencedProductId: variant === "missing" ? "missing" : "p1", referencedSiteId: variant === "cross_site_reference" ? "other" : site.id, referencedSiteSlug: site.slug }),
        ...(variant === "unresolved" ? { unresolvedProductReference: true } : {}),
      };
      const options = { userText: "What measurements are on that size chart?", recentMessages: messages, precomputedSearchIntent: intent, classifyCommerce: null,
        resolveSizingProduct: async ({ product: selected }) => { selectedIds.push(selected.id); return { ...selected, sizeChart: chart, sizeChartResolved: true }; } };
      const context = isGuest ? (await resolveGuestProductRecommendation(db, { ...options, guest: { site_id: site.id }, searchProducts: async () => { throw new Error("invalid sizing reference must not search another product"); } })).context
        : await buildChatProductRecommendationContext(db, { ...options, character: { id: "mascot_test", category_id: "mascot", site_id: site.id }, fetchProducts: async () => { throw new Error("invalid sizing reference must not search another product"); } });
      const expected = ["explicit_A", "explicit_sizing_A", "plus_size_A", "semantic_only"].includes(variant) ? "p1" : variant === "latest" ? "p2" : "";
      check((context?.sizingProduct?.id || "") === expected && selectedIds.join() === expected, `${isGuest ? "guest" : "member"} ${variant} uses exact same-site reference or keeps the request unanchored; never falls back to the newer card`);
    }
    let catalogueReads = 0, sizingReads = 0;
    const options = { userText: "Find a shirt in size M", recentMessages: twoCards, classifyCommerce: null,
      precomputedSearchIntent: { ...precomputedSearchIntent, explicitSizingProductSearch: true, requestedSizes: ["M"], requestedSizeProfile: "plus_size", shouldLoadProductContext: true, searchState: "ready_to_search", query: "shirt" },
      resolveSizingProduct: async () => { sizingReads++; throw new Error("unreferenced explicit shopping must not reuse a historical chart"); } };
    if (isGuest) await resolveGuestProductRecommendation(db, { ...options, guest: { site_id: site.id }, searchProducts: async () => { catalogueReads++; return { items: [] }; } });
    else await buildChatProductRecommendationContext(db, { ...options, character: { id: "mascot_test", category_id: "mascot", site_id: site.id }, fetchProducts: async () => { catalogueReads++; return []; } });
    check(catalogueReads === 1 && sizingReads === 0, `${isGuest ? "guest" : "member"} explicit size shopping without an exact reference retains normal catalogue search`);
  }
  const { resolveProductCheckoutProduct } = await import("../server/product-checkout-resolver-service.js");
  const sourceSite = { ...site, product_api_url: "ttmall://api.sizing.test?websiteId=8" };
  const ttProduct = { ...product, id: "123", productId: "123", url: "https://shop.invalid/productdetail/current/123" };
  let detailCalls = 0, catalogueCalls = 0;
  const resolverDeps = {
    resolveSite: async (_slug, options) => { check(options.allowDefault === false, "exact lookup disables default site fallback"); return sourceSite; },
    fetchById: async (_source, id) => { detailCalls++; check(id === "123", "exact TTMall lookup uses the current stable product ID"); return { ...ttProduct, sizeChart: chart, sizeChartResolved: true }; },
    fetchProducts: async () => { catalogueCalls++; throw new Error("exact mode must not search a catalogue"); },
  };
  const exactTT = await resolveProductCheckoutProduct({ siteSlug: site.slug, product: ttProduct, strictSite: true, exactProduct: true }, resolverDeps);
  check(exactTT.resolvedFromSource && detailCalls === 1 && catalogueCalls === 0, "exact TTMall mode reads one product and never recalls name/SKU alternatives");
  detailCalls = 0;
  const conflicts = await resolveProductCheckoutProduct({ siteSlug: site.slug, product: { ...ttProduct, productId: "124", id: "124" }, strictSite: true, exactProduct: true }, resolverDeps);
  check(!conflicts.resolvedFromSource && detailCalls === 0 && conflicts.item.sizeChartResolved === false, "conflicting URL and product ID are rejected before reading a different product");
  const unavailableDetail = await resolveProductCheckoutProduct({ siteSlug: site.slug, product: ttProduct, strictSite: true, exactProduct: true }, { ...resolverDeps, fetchById: async () => null });
  check(!unavailableDetail.resolvedFromSource && catalogueCalls === 0 && unavailableDetail.item.sizeChartResolved === false, "failed exact detail cannot loop into SKU/name fallback or claim no table");
  const generic = await resolveProductCheckoutProduct({ siteSlug: site.slug, product, strictSite: true, exactProduct: true }, { resolveSite: async () => site, fetchProducts: resolverDeps.fetchProducts });
  check(!generic.resolvedFromSource && catalogueCalls === 0, "unsupported generic detail lookup remains unknown without browsing other products");
  const adminSite = { ...site, product_api_url: "shopify-admin://sizing-test.myshopify.com" };
  let adminCalls = 0;
  const exactAdmin = await resolveProductCheckoutProduct({ siteSlug: site.slug, product, strictSite: true, exactProduct: true }, { resolveSite: async () => adminSite, fetchProducts: async (_source, intent, options) => { adminCalls++; check(intent.productHandle === "current" && options.maxProducts === 1, "admin lookup uses one exact handle result"); return [{ ...product, id: "different", productId: "different", sku: product.sku, sizeChart: chart, sizeChartResolved: true }]; } });
  check(adminCalls === 1 && !exactAdmin.resolvedFromSource, "same handle/name/SKU cannot override a conflicting product ID");
  dns.lookup = async (hostname, options = {}) => {
    if (!hostname.endsWith(".sizing.test")) throw new Error("Unmocked DNS request");
    return options.all ? [{ address: "93.184.216.34", family: 4 }] : { address: "93.184.216.34", family: 4 };
  };
  const { fetchTtmallProductById, resetTtmallProductSourceCachesForTests } = await import("../server/product-source-ttmall-service.js");
  for (const mode of ["found", "no_template", "failed", "malformed"]) {
    resetTtmallProductSourceCachesForTests();
    const paths = [];
    globalThis.fetch = async (url) => {
      const endpoint = new URL(url); paths.push(endpoint.pathname);
      if (!endpoint.hostname.endsWith(".sizing.test")) throw new Error("Unmocked outbound request");
      let payload;
      if (endpoint.pathname === "/v1/token/8") payload = { data: `${Buffer.from("{}").toString("base64url")}.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url")}.mock` };
      else if (endpoint.pathname === "/v1/website") payload = { data: { WEBSITE_DOMAIN: "https://shop.sizing.test" } };
      else if (endpoint.pathname === "/v1/product/123") payload = { data: { product_id: 123, title: "Current shirt", price: 10, ...(mode === "no_template" ? {} : { sizechart_template_id: 7 }) } };
      else if (endpoint.pathname === "/v1/sizechart/7") {
        if (mode === "failed") return new Response("{}", { status: 503 });
        payload = { data: mode === "malformed" ? {} : { list: [{ Chest: { M: "100–104" } }] } };
      } else throw new Error("Unexpected product read");
      return new Response(JSON.stringify(payload), { headers: { "Content-Type": "application/json" } });
    };
    const detail = await fetchTtmallProductById(sourceSite.product_api_url, "123", { throwOnError: true });
    check(detail?.sizeChartResolved === ["found", "no_template"].includes(mode) && Boolean(detail.sizeChart) === (mode === "found"), `actual TTMall ${mode} chart state has correct resolution semantics`);
    check(paths.filter((path) => path.startsWith("/v1/sizechart")).length === (mode === "no_template" ? 0 : 1) && !paths.some((path) => path.includes("search")), "actual TTMall exact read has no chart retry or other-product search");
  }
  const publicPaths = [];
  globalThis.fetch = async (url) => {
    const endpoint = new URL(url); publicPaths.push(endpoint.pathname);
    check(endpoint.hostname === "shop.sizing.test" && endpoint.pathname === "/products/current.js", "public Shopify reads only the current product JSON");
    return new Response(JSON.stringify({ id: 123, title: "Current shirt", handle: "current", url: "/products/current", available: true, variants: [{ id: 1001, sku: "NPV123-S", title: "S", price: 1000, available: true }] }), { headers: { "Content-Type": "application/json" } });
  };
  const publicProduct = { ...product, id: "123", productId: "123", url: "https://shop.sizing.test/products/current" };
  const exactPublic = await resolveProductCheckoutProduct({ siteSlug: site.slug, product: publicProduct, strictSite: true, exactProduct: true }, { resolveSite: async () => ({ ...site, site_url: "https://shop.sizing.test", product_api_url: "https://shop.sizing.test" }), fetchProducts: resolverDeps.fetchProducts });
  check(exactPublic.resolvedFromSource && exactPublic.sourceItem.sizeChartResolved && publicPaths.length === 1 && catalogueCalls === 0, "actual public Shopify exact mode skips suggest, other details and customization reads");
  console.log(`Current product sizing context self-check passed (${checks} assertions; DB/source mocked, external calls disabled)`);
} finally { globalThis.fetch = savedFetch; dns.lookup = savedLookup; await closeDbPool(); }
