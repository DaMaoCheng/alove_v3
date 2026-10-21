import assert from "node:assert/strict";
import {
  PRODUCT_TRIGGER_QUICK,
  buildProductSearchIntent,
  buildRecentProductContext,
  extractRequestedSizeProfile,
  findRecentProductMessage,
  filterProductsByIntent,
  filterProductsByRequestedSizes,
  isExplicitProductSizingSearch,
  isCustomerServiceKnowledgeRequest,
  isProductImageCardRequest,
  normalizeProductQueryTeamAlias,
  buildProductCorrectionClarificationReply,
} from "../server/product-intent-service.js";
import { prepareProductCandidates } from "../server/product-candidate-ranking-service.js";
import { normalizeTtmallProduct } from "../server/product-source-ttmall-mapper.js";

const quickIntent = buildProductSearchIntent("anything", PRODUCT_TRIGGER_QUICK);
assert.equal(quickIntent.query, "recommended", "quick product trigger should use recommended query");
assert.equal(quickIntent.shouldLoadProductContext, true, "quick product trigger should always load product context");

const typoIntent = buildProductSearchIntent("Do you have golie kits?");
assert.deepEqual(typoIntent.correctionSuggestion, {
  original: "golie",
  corrected: "goalie",
  correctedText: "goalie kits",
}, "high-confidence catalogue typos should produce a confirmation suggestion");
assert.equal(typoIntent.searchState, "needs_clarification", "a typo suggestion must pause search until confirmation");
assert.equal(buildProductCorrectionClarificationReply(typoIntent), "Did you mean “goalie kits”?", "the correction question must be deterministic");
assert.equal(buildProductCorrectionClarificationReply(typoIntent, { language: "Chinese" }), "你是指“goalie kits”吗？", "correction wording should follow the active character language");
assert.equal(buildProductSearchIntent("Do you have Golie FC kits?").correctionSuggestion, null, "capitalized proper names must not be auto-corrected");
const typoContext = buildRecentProductContext([{ senderType: "user", text: "Do you have golie kits?" }]);
const confirmedTypoIntent = buildProductSearchIntent("yes", "", { recentProductContext: typoContext });
assert.equal(confirmedTypoIntent.correctionSuggestion, null, "confirmation should consume the pending correction");
assert.equal(confirmedTypoIntent.searchState, "ready_to_search", "confirmed correction should enter the normal search flow");
assert.equal(confirmedTypoIntent.query, "goalie", "confirmed correction should search the corrected keyword");

const quickAwayIntent = buildProductSearchIntent("Show me away kits", PRODUCT_TRIGGER_QUICK);
assert.equal(quickAwayIntent.requestedVariant, "away", "quick product trigger should still parse requested variants");
assert.equal(quickAwayIntent.requestedProductType, "shirt", "quick product trigger should still parse requested product type");
assert.equal(quickAwayIntent.query, "away shirt", "quick product trigger should keep meaningful filter terms");

const giftIntent = buildProductSearchIntent("Find a gift shirt", PRODUCT_TRIGGER_QUICK);
assert.equal(giftIntent.requestedProductType, "shirt", "gift quick copy should still detect shirt intent");
assert.equal(giftIntent.query, "shirt", "gift quick copy should not send gift as a narrow product keyword");
assert.equal(giftIntent.shouldLoadProductContext, true, "gift quick copy should force product context");

const popularIntent = buildProductSearchIntent("Show me best sellers", PRODUCT_TRIGGER_QUICK);
assert.equal(popularIntent.intent, "popular", "best seller copy should map to the popular intent");
assert.equal(popularIntent.query, "recommended", "popular generic quick copy should use the broad recommended query");

const budgetSizingIntent = buildProductSearchIntent("Show me an affordable Real Madrid away jersey size M");
assert.equal(budgetSizingIntent.intent, "budget", "price wording should retain the budget ranking intent");
assert.equal(isExplicitProductSizingSearch(budgetSizingIntent), true, "a concrete product plus a size must still use sellable-size filtering when budget wording is present");
const popularSizingIntent = buildProductSearchIntent("Show me a popular Real Madrid away jersey size M");
assert.equal(popularSizingIntent.intent, "popular", "popularity wording should retain the popular ranking intent");
assert.equal(isExplicitProductSizingSearch(popularSizingIntent), true, "a concrete product plus a size must still use sellable-size filtering when popularity wording is present");

const colorIntent = buildProductSearchIntent("Show me black jerseys");
assert.equal(colorIntent.requestedColor, "black", "color requests should be explicitly represented");
assert.equal(colorIntent.query, "black shirt", "color requests should keep color and product type in query");

const directIntent = buildProductSearchIntent("emmm, ac milan do you have?");
assert.equal(directIntent.requestedTeam, "AC Milan", "AC Milan availability question should extract requestedTeam");
assert.equal(directIntent.requestedProductType, "shirt", "team availability question should default to shirt");
assert.equal(directIntent.query, "AC Milan", "team availability question should use the broad canonical-team source query");
assert.equal(directIntent.shouldLoadProductContext, true, "team availability question should load product context");

const spanishTrainingContext = buildRecentProductContext([{ senderType: "user", text: "Hola Valeria las playeras de entreno sin mangas ya no las manejan?" }]);
assert.deepEqual(spanishTrainingContext?.requestedFeatures, ["sleeveless", "training"], "Spanish training and sleeveless criteria should be retained");
const spanishTeamFollowup = buildProductSearchIntent("Fc Barcelona", "", { recentProductContext: spanishTrainingContext });
assert.equal(spanishTeamFollowup.requestedTeam, "Barcelona", "team-only follow-up should resolve the new team");
assert.equal(spanishTeamFollowup.shouldLoadProductContext, true, "team-only follow-up should trigger a merged product search");
assert.equal(spanishTeamFollowup.requestedProductType, "shirt", "team-only follow-up should retain the previous product type");
assert.deepEqual(spanishTeamFollowup.requestedFeatures, ["sleeveless", "training"], "team-only follow-up should retain previous product criteria");

const plusSizeIntent = buildProductSearchIntent("Sporting Clube de Portugal plus size replica jersey");
assert.equal(plusSizeIntent.requestedTeam, "Sporting CP", "common club aliases should normalize to one catalogue team");
assert.equal(plusSizeIntent.requestedSizeProfile, "plus_size", "plus-size wording should be preserved as a generic size profile");
assert.equal(plusSizeIntent.requestedProductType, "shirt", "plus-size jersey wording should retain the shirt product type");
assert.deepEqual(plusSizeIntent.requestedFeatures, ["fan_version"], "replica/fan-fit wording should map to the existing fan-version feature");
assert.equal(plusSizeIntent.query, "Sporting CP", "size profile wording should not pollute the source recall query");
assert.equal(plusSizeIntent.searchState, "ready_to_search", "an anchored plus-size request should be ready to search");
assert.equal(extractRequestedSizeProfile("extended sizes please"), "plus_size", "extended-size synonyms should share the generic profile");
const plusSizeContext = buildRecentProductContext([{ senderType: "user", text: "Sporting Clube de Portugal plus size jersey" }]);
assert.equal(plusSizeContext?.requestedTeam, "Sporting CP", "plus-size team context should survive recent-context loading");
assert.equal(plusSizeContext?.requestedSizeProfile, "plus_size", "plus-size profile should survive recent-context loading");
const plusSizeRanked = prepareProductCandidates([
  { name: "Sporting CP Home Soccer Jersey", sizes: [{ label: "S" }, { label: "XL" }] },
  { name: "Sporting CP Home Soccer Jersey Plus Size", sizes: [{ label: "2XL" }, { label: "3XL" }] },
], { searchIntent: plusSizeIntent, limit: 1 });
assert.equal(plusSizeRanked[0]?.name, "Sporting CP Home Soccer Jersey Plus Size", "plus-size searches should rank verified extended-size products first");

const alNassrIntent = buildProductSearchIntent("Cristiano Ronaldo Trikot Al Nassr");
assert.equal(alNassrIntent.requestedTeam, "Al Nassr", "German shirt wording should resolve Al Nassr");
assert.equal(alNassrIntent.requestedProductType, "shirt", "Trikot should map to the shirt product type");
assert.deepEqual(alNassrIntent.requestedKeywords, ["cristiano", "ronaldo"], "player keywords should remain available alongside a recognized team");
assert.equal(alNassrIntent.shouldLoadProductContext, true, "an explicit German player/team shirt request should load product context");

const barcelonaTypoIntent = buildProductSearchIntent("I'm what's the bacelona shirt");
assert.deepEqual(barcelonaTypoIntent.correctionSuggestion, {
  original: "bacelona",
  corrected: "barcelona",
  correctedText: "barcelona shirt",
}, "high-confidence Barcelona typo should produce a deterministic correction");
assert.equal(barcelonaTypoIntent.searchState, "needs_clarification", "a typo suggestion should ask for confirmation before searching");
const barcelonaTypoContext = buildRecentProductContext([{ senderType: "user", text: "I'm what's the bacelona shirt" }]);
const confirmedBarcelonaIntent = buildProductSearchIntent("ja", "", { recentProductContext: barcelonaTypoContext });
assert.equal(confirmedBarcelonaIntent.correctionSuggestion, null, "ja should consume a pending product correction");
assert.equal(confirmedBarcelonaIntent.query, "barcelona", "confirmed Barcelona correction should search the corrected team keyword");
assert.equal(confirmedBarcelonaIntent.shouldLoadProductContext, true, "confirmed correction should enter the product flow");
assert.equal(buildProductSearchIntent("ja").shouldLoadProductContext, false, "a standalone ja must not trigger product search");

const authenticityIntent = buildProductSearchIntent("the jersey is authentic or fake?");
assert.equal(isCustomerServiceKnowledgeRequest("the jersey is authentic or fake?"), true, "authenticity questions should be recognized as customer-service knowledge requests");
assert.equal(authenticityIntent.customerServiceKnowledgeRequest, true, "customer-service classification should travel with product intent");
assert.equal(authenticityIntent.shouldLoadProductContext, false, "authenticity questions must not be diverted into product search merely because they mention a jersey");
assert.equal(buildProductSearchIntent("Show me a Chelsea replica jersey").shouldLoadProductContext, true, "replica as a product descriptor alone must remain a product request");

const chelseaSeasonIntent = buildProductSearchIntent("Do you know when the 26/27 shirts of Chelsea fc will be available?");
assert.equal(chelseaSeasonIntent.requestedTeam, "Chelsea", "Chelsea season wording should resolve the club");
assert.equal(chelseaSeasonIntent.requestedSeason, "2026/27", "26/27 shorthand should normalize to the current football season");
assert.equal(chelseaSeasonIntent.query, "Chelsea", "season filtering should keep the source query broad enough for Shopify recall");
assert.deepEqual(chelseaSeasonIntent.requestedKeywords, [], "a greeting to the active character must not become a product keyword");
assert.equal(chelseaSeasonIntent.shouldLoadProductContext, true, "Chelsea season availability wording should load product context");
const fourDigitChelseaSeason = buildProductSearchIntent("Chelsea 2026-2027 home shirt");
assert.equal(fourDigitChelseaSeason.requestedSeason, "2026/27", "four-digit season ranges should normalize consistently");
assert.deepEqual(fourDigitChelseaSeason.requestedKeywords, [], "a four-digit season range must not remain as a misleading ranking keyword");
assert.equal(buildProductSearchIntent("Chelsea 27 home shirt").requestedSeason, "2026/27", "a shorthand season end-year should normalize consistently");
for (const shorthand of ["Chelsea 26", "Chelsea 27"]) {
  const intent = buildProductSearchIntent(shorthand);
  assert.equal(intent.requestedProductType, "shirt", `${shorthand} should default to a shirt catalogue request`);
  assert.equal(intent.shouldLoadProductContext, true, `${shorthand} should enter the product flow without a product-specific hard-code`);
}
assert.equal(buildProductSearchIntent("Chelsea Palmer #27 shirt").requestedSeason, "", "a player number must not be misread as a season");
assert.equal(buildProductSearchIntent("I want size 27 Chelsea shirt").requestedSeason, "", "a requested size must not be misread as a season");
const worldCupIntent = buildProductSearchIntent("Spain 2026 World Cup jersey");
assert.equal(worldCupIntent.requestedSeason, "", "a competition year must not be forced into a league-season filter");
assert.equal(worldCupIntent.shouldLoadProductContext, true, "a World Cup jersey request should remain in the product flow");
assert.equal(buildProductSearchIntent("Chelsea 1992/94 retro shirt").requestedSeason, "1992/94", "an explicit historic season pair should remain searchable");

const genericClubSeasonIntent = buildProductSearchIntent("When will the 26/27 shirts of Borussia Dortmund FC be available?");
assert.equal(genericClubSeasonIntent.requestedTeam, "", "an unlisted club must not require a hard-coded team alias");
assert.equal(genericClubSeasonIntent.requestedSeason, "2026/27", "generic club wording should still normalize the requested season");
assert.equal(genericClubSeasonIntent.query, "borussia dortmund", "generic club wording should preserve the meaningful catalogue keywords without chatter or season noise");
assert.equal(genericClubSeasonIntent.shouldLoadProductContext, true, "generic club season wording should still enter the product flow");

const genericPlayerIntent = buildProductSearchIntent("Can I see Chelsea Palmer 26/27 shirt?");
assert.deepEqual(genericPlayerIntent.requestedKeywords, ["palmer"], "a player name should remain a generic ranking keyword instead of requiring a player-specific rule");

const spanishIntent = buildProductSearchIntent("I want the latest Spanish World Cup champion jersey.");
assert.equal(spanishIntent.requestedTeam, "Spain", "Spanish nationality wording should map to the Spain catalog team");
assert.equal(spanishIntent.requestedProductType, "shirt", "Spanish jersey requests should detect shirt intent");
assert.equal(spanishIntent.query, "Spain", "Spanish jersey requests should use the broad canonical-team source query");
assert.equal(spanishIntent.shouldLoadProductContext, true, "Spanish jersey requests should load product context");

const spanishSizeIntent = buildProductSearchIntent("I want the latest Spanish national team World Cup winning jersey.XL size");
assert.equal(spanishSizeIntent.requestedTeam, "Spain", "Spanish national team wording should map to the Spain catalog team");
assert.equal(spanishSizeIntent.query, "Spain", "Spanish size requests should keep a stable Spain source query");

const adultSpainIntent = buildProductSearchIntent("Do you have a men's Spain home jersey in XL?");
assert.equal(adultSpainIntent.requestedAudience, "adult", "men's wording should select the adult audience");
assert.equal(adultSpainIntent.requestedVariant, "home", "adult Spain request should preserve the home variant");
assert.equal(adultSpainIntent.query, "Spain", "adult audience should not pollute the Shopify source query");
assert.equal(adultSpainIntent.shouldLoadProductContext, true, "adult Spain availability request should load product context");

const kidsSpainIntent = buildProductSearchIntent("Show me kids Spain jerseys");
assert.equal(kidsSpainIntent.requestedAudience, "kids", "kids wording should select the kids audience");

const customJerseyIntent = buildProductSearchIntent("I mean customize the jersey I buy");
assert.equal(customJerseyIntent.productCustomizationRequest, true, "a jersey customization question must not be treated as virtual-character creation");

const pendingKidsAgeIntent = buildProductSearchIntent("Do u do kids size 18 to 24 months");
assert.equal(pendingKidsAgeIntent.requestedAudience, "kids", "a pending infant-size request should retain its kids audience");
assert.equal(pendingKidsAgeIntent.requestedAgeRange, "18-24 months", "a pending infant-size request should normalize the requested age range");
const implicitKidsAgeIntent = buildProductSearchIntent("I need a Manchester United kit for 18–24 months with Havard #10 printed on the back.");
assert.equal(implicitKidsAgeIntent.requestedAudience, "kids", "an age range without the word kids should still select the kids catalogue");
assert.equal(implicitKidsAgeIntent.requestedAgeRange, "18-24 months", "an age range should remain independent from a requested print number");
assert.equal(implicitKidsAgeIntent.productCustomizationRequest, true, "printed name-and-number wording should stay a jersey customization request");
for (const ageExpression of ["18-24 months", "18–24 months", "18—24 months", "18 mos to 24 mos"]) {
  assert.equal(
    buildProductSearchIntent(`Do you have kids size ${ageExpression}`).requestedAgeRange,
    "18-24 months",
    `${ageExpression} must remain an exact age-range constraint`,
  );
}
const storedPendingKidsAgeIntent = buildRecentProductContext([{ senderType: "user", text: "Do u do kids size 18 to 24 months" }]);
assert.equal(storedPendingKidsAgeIntent?.requestedAgeRange, "18-24 months", "a teamless pending product request must survive recent-context loading");
const kidsNamesetFollowupIntent = buildProductSearchIntent("Man united do t want player name want number 10 and havard on the back", "", {
  recentProductContext: storedPendingKidsAgeIntent,
});
assert.equal(kidsNamesetFollowupIntent.requestedTeam, "Manchester United", "the follow-up should resolve its supplied team");
assert.equal(kidsNamesetFollowupIntent.requestedAudience, "kids", "a team answer to a pending kids request must retain the kids audience");
assert.equal(kidsNamesetFollowupIntent.requestedAgeRange, "18-24 months", "a team answer to a pending infant-size request must retain the exact age range");
assert.equal(kidsNamesetFollowupIntent.productCustomizationRequest, true, "name-and-number wording should be recognized as jersey customization");
assert.equal(filterProductsByIntent([
  { name: "Authentic Manchester United Home Soccer Jersey 2026/27", sizes: [{ label: "S" }, { label: "M" }] },
  { name: "Kid's Manchester United Home Soccer Jersey 2026/27", sizes: [{ label: "#22 (8 Years)" }] },
], kidsNamesetFollowupIntent).length, 0, "an adult or older-kids item must not be sent for an explicit 18-24-month request");

const kidsTeamOnlyFollowupIntent = buildProductSearchIntent("Manchester United", "", {
  recentProductContext: storedPendingKidsAgeIntent,
});
assert.equal(kidsTeamOnlyFollowupIntent.requestedAgeRange, "18-24 months", "a direct team answer must retain a pending exact age range");
const contextWithCharacterClarification = buildRecentProductContext([
  { senderType: "user", text: "I need a Manchester United kit for 18–24 months with Havard #10 printed on the back." },
  { senderType: "character", text: "Are you after a Manchester United home, away, third or retro style?" },
]);
assert.equal(contextWithCharacterClarification?.requestedAgeRange, "18-24 months", "a character clarification must not overwrite an earlier user's age constraint");
assert.equal(contextWithCharacterClarification?.requestedAudience, "kids", "a character clarification must not erase the inferred kids audience");
const contextAfterVariantAnswer = buildRecentProductContext([
  { senderType: "user", text: "I need a Manchester United kit for 18–24 months with Havard #10 printed on the back." },
  { senderType: "character", text: "Are you after a Manchester United home, away, third or retro style?" },
  { senderType: "user", text: "home" },
]);
assert.equal(contextAfterVariantAnswer?.requestedTeam, "Manchester United", "a short style answer must retain the earlier team");
assert.equal(contextAfterVariantAnswer?.requestedVariant, "home", "a short style answer must provide the requested variant");
assert.equal(contextAfterVariantAnswer?.requestedAgeRange, "18-24 months", "a short style answer must retain the earlier age constraint");
assert.equal(contextAfterVariantAnswer?.customizationRequest, "jersey", "a short style answer must retain the earlier print request");
assert.equal(contextAfterVariantAnswer?.requestedPrintNumber, "10", "a short style answer must retain the requested back number separately from size");
const contextAfterCardsAndReplies = buildRecentProductContext([
  { senderType: "user", text: "I need a Manchester United kit for a 1 year old with number 14 printed on the back." },
  { senderType: "character", contentType: "product", product: { name: "Manchester United Home Soccer Jersey", searchIntent: { requestedTeam: "Manchester United", requestedProductType: "shirt" } } },
  { senderType: "character", text: "Would you like home or away?" },
  { senderType: "character", contentType: "product", product: { name: "Manchester United Home Soccer Jersey", searchIntent: { requestedTeam: "Manchester United", requestedProductType: "shirt" } } },
  { senderType: "character", text: "I can check another option too." },
  { senderType: "user", text: "home" },
]);
assert.equal(contextAfterCardsAndReplies?.requestedTeam, "Manchester United", "product cards and assistant replies must not break a fragmented team request");
assert.equal(contextAfterCardsAndReplies?.requestedAgeRange, "1 year", "a one-year-old constraint must survive product cards and assistant replies");
assert.equal(contextAfterCardsAndReplies?.requestedPrintNumber, "14", "a requested back number must survive product cards and remain separate from age sizing");
assert.equal(contextAfterCardsAndReplies?.requestedVariant, "home", "the newest user style answer must merge into the earlier request");
const exactToddlerSizeMatches = filterProductsByIntent([
  { name: "BRUNO #14 Manchester United Home Soccer Jersey", subtitle: "Manchester United", sku: "DCS001-S", sizes: [{ label: "S", available: true }] },
  { name: "Kids Manchester United Home Soccer Jersey", subtitle: "Manchester United", sku: "DCTZ,CTW001-14", sizes: [{ label: "#14 (1-2 Years)", available: true }] },
  { name: "Kids Manchester United Home Soccer Jersey", subtitle: "Manchester United", sku: "DCTZ,CTW001-16", sizes: [{ label: "#16 (2-3 Years)", available: true }] },
], implicitKidsAgeIntent);
assert.equal(exactToddlerSizeMatches.length, 1, "only a real #14 product variant may satisfy 18–24 months");
assert.equal(exactToddlerSizeMatches[0]?.sizes?.[0]?.label, "#14 (1-2 Years)", "a title number or requested print number must never count as a size match");
const oneYearIntent = buildProductSearchIntent("I need a Manchester United kit for a 1 year old with number 14 printed on the back.");
assert.equal(oneYearIntent.requestedAgeRange, "1 year", "a single child age must remain an age constraint rather than a shirt number");
assert.equal(oneYearIntent.requestedPrintNumber, "14", "an explicit shirt number must be retained separately from the child age");
const nearestToddlerFallback = filterProductsByIntent([
  { name: "Kids Manchester United Home Soccer Jersey", subtitle: "Manchester United", sku: "DCTZ,CTW001-16", sizes: [{ label: "#16 (2-3 Years)", available: true }] },
], oneYearIntent, { allowNearestAgeFallback: true });
assert.equal(nearestToddlerFallback.length, 1, "chat fallback may return the nearest real available kids size when no exact age size exists");
assert.equal(nearestToddlerFallback[0]?.ageSizeFallback?.sizeLabel, "#16", "nearest fallback must use the actual available variant label, not a title number");
assert.equal(nearestToddlerFallback[0]?.ageSizeFallback?.ageReference, "2–3", "nearest fallback must disclose the chart age reference");

const followupIntent = buildProductSearchIntent("the home shirt", "", {
  recentProductContext: { requestedTeam: "AC Milan", requestedProductType: "shirt" },
});
assert.equal(followupIntent.contextSource, "recent_product_context", "short product follow-up should inherit context");
assert.equal(followupIntent.query, "AC Milan", "short product follow-up should use the inherited team source query");

const longPairFollowupIntent = buildProductSearchIntent("I want this season's home and away strips", "", {
  recentProductContext: { requestedTeam: "Liverpool", requestedProductType: "shirt" },
});
assert.equal(longPairFollowupIntent.contextSource, "recent_product_context", "a complete home-and-away follow-up should retain the confirmed team");
assert.deepEqual(longPairFollowupIntent.requestedVariants, ["home", "away"], "home-and-away wording should retain both requested variants");
assert.equal(longPairFollowupIntent.requestedProductType, "shirt", "strips should be treated as shirts");
assert.equal(longPairFollowupIntent.query, "Liverpool", "a home-and-away request should fetch the team set instead of an impossible combined title query");
assert.equal(longPairFollowupIntent.shouldLoadProductContext, true, "a home-and-away follow-up should re-enter the deterministic product flow");

const teamCatalogIntent = buildProductSearchIntent("Why don't you do Liverpool football club?");
assert.equal(teamCatalogIntent.requestedTeam, "Liverpool", "team catalog wording should resolve the requested team");
assert.equal(teamCatalogIntent.requestedProductType, "shirt", "team catalog wording should default to the shirt catalog");
assert.equal(teamCatalogIntent.query, "Liverpool", "team catalog wording should use a stable team source query");

const whiteFollowupIntent = buildProductSearchIntent("White color", "", {
  recentProductContext: { requestedTeam: "England", requestedProductType: "shirt" },
});
assert.equal(whiteFollowupIntent.requestedTeam, "England", "color-only product follow-up should retain the confirmed team");
assert.equal(whiteFollowupIntent.requestedProductType, "shirt", "color-only product follow-up should retain the confirmed product type");
assert.equal(whiteFollowupIntent.requestedColor, "white", "color-only product follow-up should retain the requested color");
assert.equal(whiteFollowupIntent.query, "England", "color-only follow-up should use the inherited team source query before deterministic colour filtering");
assert.equal(whiteFollowupIntent.shouldLoadProductContext, true, "color-only follow-up should re-enter the deterministic product flow");

const storedProduct = {
  name: "England Home Soccer Jersey World Cup 2026 White",
  siteId: "site_fkk",
  imageUrl: "https://example.test/england-white.jpg",
  searchIntent: { query: "England shirt", requestedTeam: "England", requestedProductType: "shirt" },
};
const recentProductMessage = findRecentProductMessage([{ senderType: "character", contentType: "product", product: storedProduct }]);
assert.equal(recentProductMessage?.product?.name, storedProduct.name, "latest product card should remain available for a product-image follow-up");
assert.equal(buildRecentProductContext([{ senderType: "character", contentType: "product", product: storedProduct }])?.requestedTeam, "England", "stored product search intent should be reusable");
assert.equal(isProductImageCardRequest("Send me a picture"), true, "clear product image request should be recognized");
assert.equal(isProductImageCardRequest("Take a selfie"), false, "character photo request must not be treated as a product card request");

const correctionIntent = buildProductSearchIntent("no, i want ac milan home kit bro. no arsenal");
assert.equal(correctionIntent.isCorrection, true, "correction text should be marked");
assert.deepEqual(correctionIntent.excludeTeams, ["Arsenal"], "excluded team should be extracted");

const fixtureIntent = buildProductSearchIntent("does AC Milan have a game tonight?");
assert.equal(fixtureIntent.shouldLoadProductContext, false, "fixture questions should not load product context");

const manCityIntent = buildProductSearchIntent("Do you have the new Man City home shirt?");
assert.equal(manCityIntent.requestedTeam, "Manchester City", "common Manchester City shorthand should resolve to its canonical team before product-source matching");
assert.equal(normalizeProductQueryTeamAlias("Man City home shirt", manCityIntent), "Manchester City home shirt", "title matching should normalize a known team shorthand with the same team aliases as product intent");

const products = [
  { name: "Arsenal Home Football Shirt 2026/27", subtitle: "Arsenal" },
  { name: "AC Milan Home Football Shirt 2026/27", subtitle: "AC Milan" },
  { name: "Manchester United Home Football Shirt 2026/27", subtitle: "Manchester United" },
];
const thirdAwaySource = normalizeTtmallProduct({ product_id: 748019,
  title: "Miniconjunto Real Madrid 2026/27 Tercera Equipación Niño", team_name: "Real Madrid",
  category: "Miniconjunto", year: "2026/27", home_away: "Third Away", is_stock: 1 });
const variantCases = [
  { name: "TTMall compound source", product: thirdAwaySource, away: false, third: true },
  { name: "third-away hyphen", product: { name: "Real Madrid Third-Away Shirt" }, away: false, third: true },
  { name: "3rd away compound", product: { name: "Real Madrid 3rd Away Shirt" }, away: false, third: true },
  { name: "normal second away", product: { name: "Real Madrid Away Shirt" }, away: true, third: false },
  { name: "source independent feature entries", product: { name: "Real Madrid Shirt", features: ["Third", "Away"] }, away: true, third: true },
  { name: "source independent size options", product: { name: "Real Madrid Shirt", sizes: [{ label: "Third" }, { label: "Away" }] }, away: true, third: true },
  { name: "TTMall explicit independent variants", product: normalizeTtmallProduct({ product_id: 748020,
    title: "Real Madrid Shirt 2026/27", team_name: "Real Madrid", home_away: "Third / Away", is_stock: 1 }), away: true, third: true },
  ...["/", "&", "+", ",", "and"].map(separator => ({ name: `source independent ${separator} options`,
    product: { name: `Real Madrid Third ${separator} Away Shirt` }, away: true, third: true })),
];
const variantErrors = [];
for (const test of variantCases) {
  for (const variant of ["away", "third"]) {
    try {
      const intent = { requestedVariants: [variant], query: "recommended" };
      const filtered = filterProductsByIntent([test.product], intent);
      assert.equal(filtered.length > 0, test[variant], `${test.name}: hard ${variant} filter`);
      assert.equal(prepareProductCandidates(filtered, { searchIntent: intent }).length > 0, test[variant], `${test.name}: ${variant} ranking cannot erase a valid source option`);
    } catch (error) { variantErrors.push(error.message); }
  }
}
const homeAwayRows = [{ id: "home", name: "Real Madrid Home Shirt" }, { id: "away", name: "Real Madrid Away Shirt" }, thirdAwaySource];
const homeAwayIntent = { requestedVariants: ["home", "away"], query: "recommended" };
try {
  assert.deepEqual(prepareProductCandidates(filterProductsByIntent(homeAwayRows, homeAwayIntent), { searchIntent: homeAwayIntent }).map(product => product.id), ["home", "away"], "home-plus-away requests retain their independent requested pair without a third-away substitute");
  const multiOptionRow = { id: "multi-options", name: "Real Madrid Shirt", features: ["Home", "Away"] };
  assert.deepEqual(prepareProductCandidates(filterProductsByIntent([multiOptionRow], homeAwayIntent), { searchIntent: homeAwayIntent }).map(product => product.id), ["multi-options"], "one product offering two independent variants must appear only once");
} catch (error) { variantErrors.push(error.message); }
assert.deepEqual(variantErrors, [], "source primary compound variant and independent options must agree through filtering and ranking");
const filtered = filterProductsByIntent(products, correctionIntent);
assert.equal(filtered.length, 1, "filtered products should keep only the requested team");
assert.equal(filtered[0].name, "AC Milan Home Football Shirt 2026/27", "filtered products should select AC Milan");

const colorFiltered = filterProductsByIntent([
  { name: "Barcelona Third Away Football Shirt - UCL", subtitle: "Barcelona" },
  { name: "Real Madrid Black Football Shirt", subtitle: "Real Madrid" },
], colorIntent);
assert.equal(colorFiltered.length, 1, "color filtering should not fall back to unrelated products");
assert.equal(colorFiltered[0].name, "Real Madrid Black Football Shirt", "color filtering should require an exact color cue in product metadata");

const adultOnly = filterProductsByIntent([
  { name: "Spain Champion Edition Home Soccer Jersey Kit", subtitle: "Spain", sizes: [{ label: "8 Years" }] },
  { name: "Spain Home Soccer Jersey FIFA World Cup 2026", subtitle: "Spain" },
], adultSpainIntent);
assert.equal(adultOnly.length, 1, "adult audience filtering should remove kids products");
assert.equal(adultOnly[0].name, "Spain Home Soccer Jersey FIFA World Cup 2026", "adult audience filtering should keep the adult product");

const shirtsOnly = filterProductsByIntent([
  { name: "Liverpool Home Soccer Shorts 2026/27", category: "Football Kit" },
  { name: "Liverpool Home Football Shirt 2026/27", category: "Football Kit" },
], teamCatalogIntent);
assert.equal(shirtsOnly.length, 1, "shirt requests should not be satisfied by shorts merely because the category contains kit");
assert.equal(shirtsOnly[0].name, "Liverpool Home Football Shirt 2026/27", "shirt requests should retain the actual shirt");

const chelseaSeasonOnly = filterProductsByIntent([
  { name: "Men Retro Fan Version 1992/94 Chelsea Away Football Shirt White", subtitle: "Chelsea" },
  { name: "2026/27 Chelsea Home Soccer Jersey Blue", subtitle: "Chelsea" },
  { name: "Chelsea Home Soccer Jersey 2025/26", subtitle: "Chelsea" },
], chelseaSeasonIntent);
assert.deepEqual(
  chelseaSeasonOnly.map((product) => product.name),
  ["2026/27 Chelsea Home Soccer Jersey Blue"],
  "an explicit season request must reject older Chelsea kits instead of falling back to a retro listing"
);

const worldCupOnly = filterProductsByIntent([
  { name: "Spain Home Soccer Jersey FIFA World Cup 2026", subtitle: "Spain" },
  { name: "2026/27 Spain Home Soccer Jersey", subtitle: "Spain" },
], worldCupIntent);
assert.equal(worldCupOnly[0].name, "Spain Home Soccer Jersey FIFA World Cup 2026", "a World Cup year request must keep the matching competition product available");

const historicSeasonOnly = filterProductsByIntent([
  { name: "Men Retro Fan Version 1992/94 Chelsea Away Football Shirt White", subtitle: "Chelsea" },
  { name: "2026/27 Chelsea Home Soccer Jersey Blue", subtitle: "Chelsea" },
], buildProductSearchIntent("Chelsea 1992/94 retro shirt"));
assert.equal(historicSeasonOnly[0].name, "Men Retro Fan Version 1992/94 Chelsea Away Football Shirt White", "historic explicit season pairs should filter deterministically");

const genericKeywordRanking = prepareProductCandidates([
  { name: "2026/27 Chelsea Home Soccer Jersey Blue", subtitle: "Chelsea" },
  { name: "PALMER #10 2026/27 Chelsea Home Soccer Jersey Blue", subtitle: "Chelsea" },
], {
  searchIntent: { ...genericPlayerIntent, preferLatestHome: true },
  limit: 1,
});
assert.equal(genericKeywordRanking[0].name, "PALMER #10 2026/27 Chelsea Home Soccer Jersey Blue", "generic player keywords should rank the matching product above the base shirt");

const genericBaseRanking = prepareProductCandidates([
  { name: "PALMER #10 2026/27 Chelsea Home Soccer Jersey Blue", subtitle: "Chelsea" },
  { name: "2026/27 Chelsea Home Soccer Jersey Blue", subtitle: "Chelsea" },
], {
  searchIntent: { ...chelseaSeasonIntent, preferLatestHome: true },
  limit: 1,
});
assert.equal(genericBaseRanking[0].name, "2026/27 Chelsea Home Soccer Jersey Blue", "a generic team request should prefer the base shirt over a player-print listing");

const genericSearchBaseRanking = prepareProductCandidates([
  { name: "ESTÊVÃO #41 2026/27 Chelsea Home Soccer Jersey Blue", subtitle: "Chelsea", publishedAt: "2026-07-02T00:00:00Z" },
  { name: "2026/27 Chelsea Home Soccer Jersey Blue", subtitle: "Chelsea", publishedAt: "2026-07-01T00:00:00Z" },
], {
  searchIntent: { requestedTeam: "Chelsea", requestedProductType: "shirt" },
  limit: 2,
});
assert.equal(genericSearchBaseRanking[0].name, "2026/27 Chelsea Home Soccer Jersey Blue", "generic search should rank an unprinted shirt ahead of a newer player-print version");

const genericAwaySeasonRanking = prepareProductCandidates([
  { name: "Men Retro Fan Version 2003/05 Manchester United Away Soccer Jersey Black", subtitle: "Manchester United", publishedAt: "2026-07-04T00:00:00Z" },
  { name: "Authentic Manchester United Away Soccer Jersey 2026/27", subtitle: "Manchester United", publishedAt: "2026-05-01T00:00:00Z" },
  { name: "Men Retro Fan Version 2001/02 Manchester United Away Soccer Jersey White", subtitle: "Manchester United", publishedAt: "2026-07-03T00:00:00Z" },
  { name: "Men Retro Fan Version 08/09 Manchester United Away Soccer Jersey White", subtitle: "Manchester United", publishedAt: "2026-07-02T00:00:00Z" },
], {
  searchIntent: { requestedTeam: "Manchester United", requestedProductType: "shirt", requestedVariant: "away", requestedVariants: ["away"] },
  limit: 4,
});
assert.deepEqual(
  genericAwaySeasonRanking.map((product) => product.name),
  [
    "Authentic Manchester United Away Soccer Jersey 2026/27",
    "Men Retro Fan Version 08/09 Manchester United Away Soccer Jersey White",
    "Men Retro Fan Version 2003/05 Manchester United Away Soccer Jersey Black",
    "Men Retro Fan Version 2001/02 Manchester United Away Soccer Jersey White",
  ],
  "generic team shirt searches should order catalogue seasons from newest to oldest instead of using upload time"
);

const genericDescriptionBaseRanking = prepareProductCandidates([
  { name: "AUTHENTIC PALMER #10 2026/27 Chelsea Home Soccer Jersey Blue", subtitle: "Chelsea", publishedAt: "2026-07-02T00:00:00Z" },
  { name: "2026/27 Chelsea Home Soccer Jersey Blue", subtitle: "Chelsea", publishedAt: "2026-07-01T00:00:00Z" },
], {
  searchIntent: { requestedTeam: "Chelsea", requestedProductType: "shirt", requestedKeywords: ["authentic"] },
  limit: 2,
});
assert.equal(genericDescriptionBaseRanking[0].name, "2026/27 Chelsea Home Soccer Jersey Blue", "ordinary product-description keywords must not make a player-print shirt outrank the base shirt");

const kidsOnly = filterProductsByIntent([
  { name: "Kids Spain Champion Edition Home Soccer Jersey Kit", subtitle: "Spain" },
  { name: "Spain Home Soccer Jersey FIFA World Cup 2026", subtitle: "Spain" },
], kidsSpainIntent);
assert.equal(kidsOnly.length, 1, "kids audience filtering should remove adult products");
assert.match(kidsOnly[0].name, /Kids/i, "kids audience filtering should keep the kids product");

const adultPreferred = prepareProductCandidates([
  { name: "Kids Spain Champion Edition Away Soccer Jersey Kit", publishedAt: "2026-07-24" },
  { name: "Spain Home Soccer Jersey FIFA World Cup 2026", publishedAt: "2026-07-20" },
], {
  searchIntent: spanishIntent,
  limit: 1,
});
assert.equal(adultPreferred[0].name, "Spain Home Soccer Jersey FIFA World Cup 2026", "unspecified audience should prefer adult products over newer kids products");

const latestHomePreferred = prepareProductCandidates([
  { name: "Liverpool Goalkeeper Soccer Jersey 2026/27", publishedAt: "2026-07-25" },
  { name: "Liverpool Home Soccer Jersey 2025/26", publishedAt: "2026-07-24" },
  { name: "Liverpool Home Soccer Jersey 2026/27", publishedAt: "2026-07-20" },
  { name: "Liverpool Away Soccer Jersey 2026/27", publishedAt: "2026-07-20" },
], {
  searchIntent: { ...teamCatalogIntent, preferLatestHome: true },
  limit: 2,
});
assert.equal(latestHomePreferred[0].name, "Liverpool Home Soccer Jersey 2026/27", "generic team shirt requests should prefer the latest home shirt over a newer-published goalkeeper listing");

const requestedHomeAway = prepareProductCandidates([
  { name: "Liverpool Goalkeeper Soccer Jersey 2026/27" },
  { name: "Liverpool Away Soccer Jersey 2026/27" },
  { name: "Liverpool Home Soccer Jersey 2026/27" },
], {
  searchIntent: { ...longPairFollowupIntent, preferLatestHome: true },
  limit: 2,
});
assert.deepEqual(requestedHomeAway.map((product) => product.name), [
  "Liverpool Home Soccer Jersey 2026/27",
  "Liverpool Away Soccer Jersey 2026/27",
], "a home-and-away follow-up should return the latest requested pair in the user’s stated order");

const nonShirtStillUsesPublishedAt = prepareProductCandidates([
  { name: "Liverpool Training Jacket 2027", publishedAt: "2025-01-01" },
  { name: "Liverpool Training Jacket", publishedAt: "2026-07-01" },
], {
  searchIntent: { requestedTeam: "Liverpool", requestedProductType: "top", preferLatestHome: true },
  limit: 1,
});
assert.equal(nonShirtStillUsesPublishedAt[0].name, "Liverpool Training Jacket", "title season preference must not change non-shirt chat product ordering");

// The parser and catalogue must use the same garment evidence across languages.
const localizedShirtIntent = { requestedTeam: "Sporting", requestedProductType: "shirt" };
const localizedCatalogue = [
  { id: "hu-shirt", name: "Sporting CP Hazai Mez 2026/27", subtitle: "Sporting CP", sizes: [{ label: "M", available: true }] },
  { id: "de-shirt", name: "Sporting CP Heim Trikot 2026/27" },
  { id: "nl-shirt", name: "Sporting CP Voetbalshirt 2026/27" },
  { id: "hu-other", name: "Arsenal Hazai Mez 2026/27" },
  { id: "hu-shorts", name: "Sporting CP Nadrág 2026/27" },
  { id: "hu-socks", name: "Sporting CP Zokni 2026/27" },
];
assert.deepEqual(filterProductsByIntent(localizedCatalogue, localizedShirtIntent).map(p => p.id), ["hu-shirt", "de-shirt", "nl-shirt"], "localized catalogue garment labels must match canonical shirt while other teams and garments remain excluded");
for (const word of ["mez", "trikot", "voetbalshirt"]) {
  assert.equal(buildProductSearchIntent(`Show me Sporting CP ${word}`).requestedProductType, "shirt", "request parsing and catalogue garment evidence must share the same vocabulary");
  assert.deepEqual(buildProductSearchIntent(`Show me Sporting CP ${word}`).requestedKeywords, [], "a recognized garment must not remain an untranslated hard name keyword");
}
assert.deepEqual(filterProductsByRequestedSizes(filterProductsByIntent(localizedCatalogue, localizedShirtIntent), ["XL"]), [], "localized garment recognition must retain size filtering");
assert.deepEqual(filterProductsByIntent([{ name: "Sporting CP Shorts", subtitle: "Football kits" }], localizedShirtIntent), [], "generic kit metadata must not override an explicit non-shirt garment");
assert.deepEqual(filterProductsByIntent(localizedCatalogue, { ...localizedShirtIntent, requestedSeason: "2024/25" }), [], "localized type evidence never overrides a season constraint");
assert.deepEqual(filterProductsByIntent(localizedCatalogue, { ...localizedShirtIntent, requestedEdition: "player" }), [], "unknown edition evidence never becomes verified because a garment matches");
assert.deepEqual(filterProductsByIntent(localizedCatalogue, { ...localizedShirtIntent, requestedFeatures: ["long_sleeve"] }), [], "unknown sleeve evidence must still block an exact match");
for (const name of ["Sporting CP Nadrág", "Sporting CP Rövidnadrág", "Sporting CP Zokni", "Sporting CP Kabát"]) {
  assert.deepEqual(filterProductsByIntent([{ name, subtitle: "Football kits" }], localizedShirtIntent), [], "localized non-shirt garments cannot pass through generic kit metadata");
}

console.log("product intent service self-check passed");
