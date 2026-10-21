import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const pageSource = readFileSync("src/features/search/search-page.js", "utf8");
const topbarSource = readFileSync("src/features/search/search-topbar.js", "utf8");
const resultsSource = readFileSync("src/features/search/search-results-renderer.js", "utf8");
const stateSource = readFileSync("src/features/search/search-product-state.js", "utf8");

assert.match(pageSource, /import \{ createSearchProductState \} from "\.\/search-product-state\.js";/, "search page should delegate product search state to a dedicated module");
assert.match(pageSource, /import \{ renderSearchResults \} from "\.\/search-results-renderer\.js";/, "search page should delegate result rendering to a dedicated module");
assert.match(pageSource, /import \{ createSearchTopbar \} from "\.\/search-topbar\.js";/, "search page should delegate topbar creation to a dedicated module");
assert.match(pageSource, /bindProductPanel\(page, \{[\s\S]*clickEventType: "product_search_result_click"/, "search page should keep the existing product detail panel binding contract");
assert.match(pageSource, /if \(String\(query \|\| ""\)\.trim\(\)\) \{[\s\S]*runProductSearch\(\);[\s\S]*\} else \{[\s\S]*renderPage\(\);[\s\S]*\}/, "search page should render immediately for empty queries and debounce product search only for non-empty queries");

assert.match(topbarSource, /document\.body\.classList\.remove\("product-open"\);/, "search topbar interactions should close any open product detail shell before updating the query");
assert.match(resultsSource, /function searchProductSectionHtml/, "search results renderer should own product results section rendering");
assert.match(resultsSource, /function productResultRow/, "search results renderer should own product result row rendering");
assert.match(stateSource, /function scheduleProductSearch\(page, overrides = \{\}\)/, "search product state should own the debounced product API search workflow");
assert.match(stateSource, /window\.setTimeout\(async \(\) => \{/, "search product state should keep asynchronous debounce execution");

console.log("search page split self-check passed");
