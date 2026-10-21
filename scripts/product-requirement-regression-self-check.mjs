import assert from "node:assert/strict";
import {
  buildProductSearchIntent,
  buildRecentProductContext,
  filterProductsByIntent,
  resolveProductSearchState,
} from "../server/product-intent-service.js";
import { executeProductSearch } from "../server/product-search-execution-service.js";
import { prepareProductCandidates } from "../server/product-candidate-ranking-service.js";
import { hasHardProductRequirement } from "../server/product-search-decision-service.js";

const completeRequest = "Hi Millie how u doing am good thanks have you got the new England green goalkeeper shirt world cup 2026 2027 top";
const completeIntent = buildProductSearchIntent(completeRequest);

assert.equal(completeIntent.requestedTeam, "England");
assert.equal(completeIntent.requestedProductType, "shirt");
assert.equal(completeIntent.requestedColor, "green");
assert.equal(completeIntent.requestedSeason, "2026/27");
assert.deepEqual(completeIntent.requestedVariants, []);
assert.deepEqual(completeIntent.requestedFeatures, ["goalkeeper"]);
assert.equal(completeIntent.searchState, "ready_to_search");
assert.ok(!completeIntent.requestedKeywords.includes("doing"));
assert.ok(!completeIntent.requestedKeywords.includes("thanks"));
assert.ok(!completeIntent.requestedKeywords.includes("top"));

const recentMessages = [
  { sender_type: "user", text_content: completeRequest },
  {
    sender_type: "character",
    content_type: "product",
    text_content: "Unrelated product card",
    product: {
      name: "Men Retro Fan Version 2010 England Home Soccer Jersey White",
      searchIntent: { requestedTeam: "England", requestedVariant: "home" },
    },
  },
  { sender_type: "user", text_content: "The 3rd goalkeeper shirt green" },
];
const recentRequirement = buildRecentProductContext(recentMessages);
const correctionIntent = buildProductSearchIntent("I said the 3rd goalkeeper shirt", "", {
  recentProductContext: recentRequirement,
});

assert.equal(correctionIntent.requestedTeam, "England");
assert.equal(correctionIntent.requestedColor, "green");
assert.equal(correctionIntent.requestedSeason, "2026/27");
assert.deepEqual(correctionIntent.requestedVariants, ["third"]);
assert.deepEqual(correctionIntent.requestedFeatures, ["goalkeeper"]);
assert.equal(correctionIntent.searchState, "ready_to_search");

const candidates = [
  {
    name: "Men Retro Fan Version 2010 England Home Soccer Jersey White",
    subtitle: "England",
  },
  {
    name: "England Hollywood Keeper Soccer Jersey World Cup 2026 Black",
    subtitle: "England",
  },
  {
    name: "England Third Goalkeeper Soccer Jersey 2026/27 Green",
    subtitle: "England",
  },
];
const exactMatches = filterProductsByIntent(candidates, correctionIntent);
assert.deepEqual(exactMatches.map((product) => product.name), [
  "England Third Goalkeeper Soccer Jersey 2026/27 Green",
]);
assert.equal(resolveProductSearchState(correctionIntent, exactMatches).status, "matched");
assert.equal(resolveProductSearchState(correctionIntent, []).status, "no_match");

const correctedColorIntent = buildProductSearchIntent("not black, green please", "", {
  recentProductContext: correctionIntent,
});
assert.equal(correctedColorIntent.requestedColor, "green");
assert.deepEqual(correctedColorIntent.requestedVariants, ["third"]);
assert.equal(correctedColorIntent.requestedTeam, "England");

const correctedVariantIntent = buildProductSearchIntent("not home, third", "", {
  recentProductContext: {
    requestedTeam: "England",
    requestedProductType: "shirt",
    requestedVariants: ["home"],
  },
});
assert.deepEqual(correctedVariantIntent.requestedVariants, ["third"]);

const unknownCatalogueIntent = buildProductSearchIntent("Ajax green goalkeeper shirt 2026/27");
assert.equal(unknownCatalogueIntent.query, "ajax");
assert.equal(unknownCatalogueIntent.requestedColor, "green");
assert.equal(unknownCatalogueIntent.requestedSeason, "2026/27");
assert.deepEqual(unknownCatalogueIntent.requestedFeatures, ["goalkeeper"]);
assert.equal(unknownCatalogueIntent.searchState, "ready_to_search");

const unknownTeamSwitchIntent = buildProductSearchIntent("Ajax shirt", "", {
  recentProductContext: {
    requestedTeam: "Liverpool",
    requestedColor: "red",
    requestedSeason: "2026/27",
    requestedFeatures: ["goalkeeper"],
  },
});
assert.equal(unknownTeamSwitchIntent.requestedTeam, "");
assert.deepEqual(unknownTeamSwitchIntent.requestedKeywords, ["ajax"]);
assert.equal(unknownTeamSwitchIntent.requestedColor, "");
assert.equal(unknownTeamSwitchIntent.requestedSeason, "");
assert.deepEqual(unknownTeamSwitchIntent.requestedFeatures, []);
assert.equal(unknownTeamSwitchIntent.query, "ajax");

const genericFeatureIntent = buildProductSearchIntent("Show me a green goalkeeper shirt");
assert.equal(genericFeatureIntent.searchState, "ready_to_search");
assert.deepEqual(genericFeatureIntent.requestedFeatures, ["goalkeeper"]);

const vagueIntent = buildProductSearchIntent("Do you have any kits?");
assert.equal(vagueIntent.searchState, "needs_clarification");
assert.equal(resolveProductSearchState(vagueIntent, []).status, "needs_clarification");

const directTeamIntent = buildProductSearchIntent("I need an England shirt");
assert.equal(directTeamIntent.searchState, "ready_to_search");

const unknownTeamContext = buildRecentProductContext([
  { sender_type: "user", text_content: "Ajax" },
  { sender_type: "user", text_content: "green third goalkeeper shirt" },
]);
const unknownTeamFollowup = buildProductSearchIntent("green third goalkeeper shirt", "", {
  recentProductContext: unknownTeamContext,
});
assert.deepEqual(unknownTeamFollowup.requestedKeywords, ["ajax"]);
assert.equal(unknownTeamFollowup.requestedColor, "green");
assert.deepEqual(unknownTeamFollowup.requestedVariants, ["third"]);
assert.deepEqual(unknownTeamFollowup.requestedFeatures, ["goalkeeper"]);

const switchedTeamContext = buildRecentProductContext([
  { sender_type: "user", text_content: "England green goalkeeper shirt 2026/27" },
  { sender_type: "user", text_content: "Show me Manchester United shirts" },
  { sender_type: "user", text_content: "third" },
]);
const switchedTeamFollowup = buildProductSearchIntent("third", "", {
  recentProductContext: switchedTeamContext,
});
assert.equal(switchedTeamFollowup.requestedTeam, "Manchester United");
assert.equal(switchedTeamFollowup.requestedColor, "");
assert.equal(switchedTeamFollowup.requestedSeason, "");
assert.deepEqual(switchedTeamFollowup.requestedFeatures, []);

const fragmentedUnknownSwitchContext = buildRecentProductContext([
  { sender_type: "user", text_content: "Liverpool green goalkeeper shirt 2026/27" },
  {
    sender_type: "character",
    content_type: "product",
    product: {
      name: "Liverpool Green Goalkeeper Shirt 2026/27",
      searchIntent: {
        requestedTeam: "Liverpool",
        requestedColor: "green",
        requestedSeason: "2026/27",
        requestedFeatures: ["goalkeeper"],
      },
    },
  },
  { sender_type: "user", text_content: "Actually Celtic" },
  { sender_type: "character", text_content: "Okay" },
  { sender_type: "user", text_content: "third" },
]);
const fragmentedUnknownSwitchIntent = buildProductSearchIntent("third", "", {
  recentProductContext: fragmentedUnknownSwitchContext,
});
assert.deepEqual(fragmentedUnknownSwitchIntent.requestedKeywords, ["celtic"]);
assert.deepEqual(fragmentedUnknownSwitchIntent.requestedVariants, ["third"]);
assert.equal(fragmentedUnknownSwitchIntent.requestedTeam, "");
assert.equal(fragmentedUnknownSwitchIntent.requestedColor, "");
assert.equal(fragmentedUnknownSwitchIntent.requestedSeason, "");
assert.deepEqual(fragmentedUnknownSwitchIntent.requestedFeatures, []);
assert.equal(fragmentedUnknownSwitchIntent.searchState, "ready_to_search");

const clearedFeatureContext = buildRecentProductContext([
  { sender_type: "user", text_content: "England green goalkeeper shirt 2026/27" },
  { sender_type: "user", text_content: "normal shirt" },
]);
const clearedFeatureIntent = buildProductSearchIntent("normal shirt", "", {
  recentProductContext: clearedFeatureContext,
});
assert.deepEqual(clearedFeatureIntent.requestedFeatures, []);
assert.deepEqual(clearedFeatureIntent.requestedKeywords, []);

const multiwordAnchorIntent = buildProductSearchIntent("Borussia Dortmund black home shirt");
const multiwordAnchorProducts = await executeProductSearch({
  productApiUrl: "https://catalog.example/products",
  query: "Borussia Dortmund black home shirt",
  searchIntent: multiwordAnchorIntent,
  fetchProducts: async () => [
    { id: "bvb", name: "Borussia Dortmund Home Soccer Jersey Black" },
    { id: "bmg", name: "Borussia Mönchengladbach Home Soccer Jersey Black" },
  ],
  includePublicSearchFallback: false,
});
assert.deepEqual(multiwordAnchorProducts.map((product) => product.id), ["bvb"]);

const absentCompleteProducts = await executeProductSearch({
  productApiUrl: "https://catalog.example/products",
  query: completeRequest,
  searchIntent: completeIntent,
  fetchProducts: async () => candidates.slice(0, 2),
  includePublicSearchFallback: false,
});
assert.deepEqual(absentCompleteProducts, [], "complete explicit conditions must not degrade into a wrong product card");

const negatedRequirementIntent = buildProductSearchIntent("not home, black third shirt", "", {
  recentProductContext: {
    requestedTeam: "England",
    requestedVariants: ["home"],
  },
});
assert.deepEqual(negatedRequirementIntent.requestedKeywords, []);
assert.deepEqual(negatedRequirementIntent.requestedVariants, ["third"]);
assert.equal(negatedRequirementIntent.requestedColor, "black");

const selfContainedReplacement = buildProductSearchIntent(
  "Do you have the England black goalkeeper shirt for World Cup 2026?",
  "",
  {
    recentProductContext: {
      query: "England",
      requestedTeam: "England",
      requestedVariant: "third",
      requestedVariants: ["third"],
      requestedProductType: "shirt",
      requestedColor: "green",
      requestedSeason: "2026/27",
      requestedFeatures: ["goalkeeper"],
      customizationRequest: "jersey",
      requestedPrintNumber: "10",
    },
  }
);
assert.equal(selfContainedReplacement.requestedTeam, "England");
assert.equal(selfContainedReplacement.requestedColor, "black");
assert.equal(selfContainedReplacement.requestedSeason, "");
assert.deepEqual(selfContainedReplacement.requestedVariants, []);
assert.deepEqual(selfContainedReplacement.requestedFeatures, ["goalkeeper"]);
assert.equal(selfContainedReplacement.customizationRequest, "");
assert.equal(selfContainedReplacement.requestedPrintNumber, "");

const customizedRecentContext = {
  requestedTeam: "England",
  requestedProductType: "shirt",
  requestedVariants: ["third"],
  requestedColor: "green",
  requestedFeatures: ["goalkeeper"],
  customizationRequest: "jersey",
  requestedPrintNumber: "10",
};
const noPrintingIntent = buildProductSearchIntent("No printing, just a plain shirt", "", {
  recentProductContext: customizedRecentContext,
});
assert.equal(noPrintingIntent.requestedTeam, "England");
assert.equal(noPrintingIntent.customizationRequest, "");
assert.equal(noPrintingIntent.requestedPrintNumber, "");
assert.equal(noPrintingIntent.searchState, "ready_to_search");

const notCustomizedIntent = buildProductSearchIntent("not customized", "", {
  recentProductContext: customizedRecentContext,
});
assert.equal(notCustomizedIntent.requestedTeam, "England");
assert.equal(notCustomizedIntent.customizationRequest, "");
assert.equal(notCustomizedIntent.requestedPrintNumber, "");
assert.equal(notCustomizedIntent.searchState, "ready_to_search");

const withoutNumberIntent = buildProductSearchIntent("without number", "", {
  recentProductContext: customizedRecentContext,
});
assert.equal(withoutNumberIntent.requestedTeam, "England");
assert.equal(withoutNumberIntent.customizationRequest, "jersey");
assert.equal(withoutNumberIntent.requestedPrintNumber, "");
assert.equal(withoutNumberIntent.searchState, "ready_to_search");

const ageAndPrintIntent = buildProductSearchIntent("Manchester United kit for 1 year old with number 10 printed on the back");
assert.equal(ageAndPrintIntent.requestedAgeRange, "1 year");
assert.equal(ageAndPrintIntent.requestedPrintNumber, "10");
assert.equal(ageAndPrintIntent.requestedAudience, "kids");
assert.equal(hasHardProductRequirement(ageAndPrintIntent), true);
const ageAndPrintRanked = prepareProductCandidates([
  {
    id: "other-print",
    name: "PLAYER #14 Manchester United Home Kids Soccer Kit",
    sku: "DCTZ-OTHER",
    sizes: [{ label: "#14", available: true }],
  },
  {
    id: "base",
    name: "Manchester United Home Kids Soccer Kit",
    sku: "DCTZ-BASE",
    sizes: [{ label: "#14", available: true }],
  },
  {
    id: "exact-print",
    name: "HAVARD #10 Manchester United Home Kids Soccer Kit",
    sku: "DCTZ-EXACT",
    sizes: [{ label: "#14", available: true }],
  },
], {
  searchIntent: ageAndPrintIntent,
  limit: 5,
});
assert.deepEqual(ageAndPrintRanked.map((product) => product.id), ["exact-print", "base", "other-print"]);

const quickGenericIntent = buildProductSearchIntent("how was your day", "quick_product");
assert.equal(quickGenericIntent.query, "recommended");
assert.deepEqual(quickGenericIntent.requestedKeywords, []);
assert.equal(hasHardProductRequirement(quickGenericIntent), false);

const genericRecommendationIntent = buildProductSearchIntent("recommend a product");
assert.equal(genericRecommendationIntent.searchState, "ready_to_search");
assert.equal(hasHardProductRequirement(genericRecommendationIntent), false);

console.log("product-requirement-regression-self-check passed");
