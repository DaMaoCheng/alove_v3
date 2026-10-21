import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const entrySource = readFileSync("server/admin-knowledge-service.js", "utf8");
const querySource = readFileSync("server/admin-knowledge-query-service.js", "utf8");
const writeSource = readFileSync("server/admin-knowledge-write-service.js", "utf8");
const normalizerSource = readFileSync("server/admin-knowledge-normalizers.js", "utf8");
const mapperSource = readFileSync("server/admin-knowledge-mapper.js", "utf8");

assert.match(entrySource, /export \{ listAdminKnowledgeBases, getAdminKnowledgeBase \} from "\.\/admin-knowledge-query-service\.js";/, "entry should re-export read APIs from the query service");
assert.match(entrySource, /export \{[\s\S]*createKnowledgeBaseFromAi,[\s\S]*upsertKnowledgeBaseWithSections,[\s\S]*\} from "\.\/admin-knowledge-write-service\.js";/, "entry should re-export write APIs from the write service");
assert.doesNotMatch(entrySource, /SELECT kb\./, "entry should not keep SQL query bodies");
assert.doesNotMatch(entrySource, /INSERT INTO knowledge_bases/, "entry should not keep write SQL bodies");
assert.doesNotMatch(entrySource, /function normalizeKnowledgeBasePayload/, "entry should not keep payload normalizers");

assert.match(querySource, /SELECT kb\.\*/, "query service should own knowledge base read SQL");
assert.match(querySource, /sections: sections\.map\(mapKnowledgeSectionRow\)/, "query service should map section rows through the mapper module");

assert.match(writeSource, /INSERT INTO knowledge_bases/, "write service should own knowledge base upsert SQL");
assert.match(writeSource, /DELETE FROM knowledge_sections WHERE knowledge_base_id = \?/, "write service should own section replacement workflow");
assert.match(writeSource, /function defaultKnowledgeAiProcessor/, "write service should keep AI draft processing orchestration");

assert.match(normalizerSource, /export function normalizeKnowledgeBasePayload/, "normalizer module should own base payload normalization");
assert.match(normalizerSource, /export function normalizeManualSections/, "normalizer module should own manual section rebuilding");
assert.match(normalizerSource, /export function throwNotFound/, "normalizer module should expose shared not-found errors");

assert.match(mapperSource, /export function mapKnowledgeBaseRow/, "mapper module should own knowledge base row mapping");
assert.match(mapperSource, /export function mapKnowledgeSectionRow/, "mapper module should own knowledge section row mapping");
assert.match(mapperSource, /export function parseJsonArray/, "mapper module should own JSON array parsing for DB rows");

console.log("admin knowledge backend split self-check passed");
