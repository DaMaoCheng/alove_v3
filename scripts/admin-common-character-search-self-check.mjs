import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { adminCommonCharactersHtml } from "../src/features/admin-console/admin-console-common-characters-template.js";

const html = adminCommonCharactersHtml({ query: "Dani" });
assert.match(html, /data-common-search/, "common character page should render a searchable input hook");
assert.match(html, /value="Dani"/, "common character search input should preserve the current query");
assert.match(html, /搜索名称 \/ ID \/ 创建者 \/ 分类/, "common character search placeholder should explain searchable fields");

const frontServiceSource = readFileSync("src/services/character-admin-service.js", "utf8");
assert.match(frontServiceSource, /new URLSearchParams\(\)/, "admin character service should build query params");
assert.match(frontServiceSource, /params\.set\("query"/, "admin character service should send query param");
assert.match(frontServiceSource, /params\.set\("type"/, "admin character service should send type param");

const controllerSource = readFileSync("src/features/admin-console/admin-common-characters-controller.js", "utf8");
assert.match(controllerSource, /listAdminCharacters\(\{ query: state\.query, type: "common" \}\)/, "common character controller should request real filtered data");
assert.match(controllerSource, /data-common-search[\s\S]*addEventListener\("input"/, "common character controller should bind the search input");
assert.match(controllerSource, /setTimeout\(\(\) => load\?\.\(\{ keepFocus: true \}\), 300\)/, "common character search should debounce server requests and keep focus");

const routesSource = readFileSync("server/admin-character-routes.js", "utf8");
assert.match(routesSource, /query: requestUrl\.searchParams\.get\("query"\)/, "admin characters route should pass query to service");
assert.match(routesSource, /type: requestUrl\.searchParams\.get\("type"\)/, "admin characters route should pass type to service");

const serverSource = readFileSync("server/character-admin-service.js", "utf8");
assert.match(serverSource, /c\.category_id NOT IN \('creator', 'mascot'\)/, "admin character service should support common type filtering");
assert.match(serverSource, /c\.name LIKE \? OR c\.id LIKE \?/, "admin character service should search character name and id");
assert.match(serverSource, /u\.nickname LIKE \? OR u\.email LIKE \?/, "admin character service should search creator fields");
assert.match(serverSource, /getDbPool\(\)\.execute\([\s\S]*, params\s*\)/, "admin character service should use parameterized query values");

console.log("admin common character search self-check passed");
