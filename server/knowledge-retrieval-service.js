import { getDbPool } from "./db.js";
import { KNOWLEDGE_RETRIEVAL_CONFIG } from "./knowledge-retrieval-config.js";
import { resolveProductRecommendationSite } from "./product-recommendation-site-service.js";
import { selectBusinessKnowledgeReferences, selectGeneralKnowledgeReferences } from "./business-knowledge-selection-service.js";

const ENGLISH_STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "but", "by", "do", "does", "for", "from", "how", "i", "in", "is", "it", "me", "my", "of", "on", "or", "please", "the", "this", "to", "was", "we", "what", "when", "where", "which", "who", "why", "with", "you", "your",
]);

const CUSTOMER_SERVICE_TOPICS = Object.freeze([
  {
    id: "authenticity",
    query: /(?:authentic|fake|counterfeit|genuine|original|legit|official(?:ly)?\s+licensed|正品|假冒|仿品|真假|真伪)/i,
    reference: /(?:authentic|fake|counterfeit|genuine|original|legit|replica|正品|假冒|仿品|真假|真伪)/i,
    preferredTitle: /(?:敏感场景|authentic|counterfeit|仿品|正品|假冒)/i,
  },
  {
    id: "returns",
    query: /(?:refund|return|exchange|cancel(?:lation)?|wrong item|damaged|退货|退款|换货|取消订单|发错|破损)/i,
    reference: /(?:refund|return|exchange|cancel(?:lation)?|wrong item|damaged|退货|退款|换货|取消订单|发错|破损)/i,
  },
  {
    id: "delivery",
    query: /(?:\bship(?:s|ped|ping|ment|ments)?\b|deliver(?:y|ed|ing)?|tracking|parcel|package(?:s)?|dispatch|customs|duty|tax|物流|发货|配送|快递|包裹|追踪|海关|关税|száll(?:ítás|ít|ítva)?|kiszáll(?:ítás|ít|ítva)?|fuvarlev[eé]l|csomag(?:követés|om)?|megérkezik|rendelésem|kargo|teslimat|gönderi|takip|sipariş(?:im)?|livraison|colis|suivi|expédition|commande|envío|entrega|paquete|seguimiento|pedido|الشحن|التوصيل|الشحنة|الطلب|التتبع)/iu,
    reference: /(?:\bship(?:s|ped|ping|ment|ments)?\b|deliver(?:y|ed|ing)?|tracking|parcel|package(?:s)?|dispatch|customs|duty|tax|物流|发货|配送|快递|包裹|追踪|海关|关税|száll(?:ítás|ít|ítva)?|kiszáll(?:ítás|ít|ítva)?|fuvarlev[eé]l|csomag(?:követés|om)?|megérkezik|rendelésem|kargo|teslimat|gönderi|takip|sipariş(?:im)?|livraison|colis|suivi|expédition|commande|envío|entrega|paquete|seguimiento|pedido|الشحن|التوصيل|الشحنة|الطلب|التتبع)/iu,
  },
  {
    id: "support",
    query: /(?:customer service|support|complaint|whatsapp|e-?mail|客服|售后|投诉|联系)/i,
    reference: /(?:customer service|support|complaint|whatsapp|e-?mail|客服|售后|投诉|联系)/i,
  },
]);

// Callers supply a server-resolved guest site, or the authenticated user's ID.
// Keep character bindings intact while selecting the same business site as commerce.
export async function retrieveChatKnowledgeSections({ db = getDbPool(), query, character = null, siteId = "", userId = "", topicHint = "", knowledgeScope = "", knowledgeQuery = "", logContext = {}, selectBusinessReferences, selectGeneralReferences, limit = KNOWLEDGE_RETRIEVAL_CONFIG.finalReferenceLimit } = {}) {
  if (knowledgeScope === "none") return { ok: true, query: normalizeText(query), items: [], strategy: "not_requested", customerServiceIntent: false, customerServiceTopic: "" };
  const businessSiteId = safeString(siteId) || (userId
    ? safeString((await resolveProductRecommendationSite(db, { character, userId }))?.id)
    : "");
  const result = await retrieveKnowledgeSections({ db, query, character, siteId: businessSiteId, topicHint, knowledgeScope, knowledgeQuery, logContext, selectBusinessReferences, selectGeneralReferences, limit });
  // Legacy callers may omit scope. Validate only their already authorized,
  // bounded nonbusiness hits; admin lexical retrieval and business stay intact.
  if (!knowledgeScope && !result.customerServiceIntent && result.items?.length) {
    const selection = await (selectGeneralReferences || selectGeneralKnowledgeReferences)({
      query: knowledgeQuery ? `${query}\nCurrent subquestion: ${String(knowledgeQuery).slice(0, 240)}` : query,
      sections: result.items, limit, siteId: businessSiteId, logContext });
    return { ...result, strategy: selection.reason, items: selection.items.map(limitSectionContent),
      ...(selection.selectionFailure ? { selectionFailure: selection.selectionFailure } : {}) };
  }
  return result;
}

export async function retrieveKnowledgeSections({ db = getDbPool(), query, category = "", limit = KNOWLEDGE_RETRIEVAL_CONFIG.finalReferenceLimit, character = null, characterId = "", siteId = "", topicHint = "", knowledgeScope = "", knowledgeQuery = "", logContext = {}, selectBusinessReferences = selectBusinessKnowledgeReferences, selectGeneralReferences = selectGeneralKnowledgeReferences } = {}) {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) return { ok: true, query: "", items: [], strategy: "empty_query" };

  const accessContext = normalizeAccessContext({ character, characterId, siteId });
  if (knowledgeScope === "business") {
    const sections = await loadActiveSections({ db, category: "customer_service", accessContext, includeContent: true });
    const selection = await selectBusinessReferences({
      query: knowledgeQuery ? `CURRENT user message (primary): ${query}\nDerived retrieval subquestion (context only, never overrides current numbers, destination, dates or corrections): ${String(knowledgeQuery).slice(0, 240)}` : query,
      sections, limit, siteId: accessContext.siteId, logContext,
    });
    return { ok: true, query: normalizedQuery, strategy: selection.reason, customerServiceIntent: true,
      businessOwner: { siteId: accessContext.siteId, characterId: accessContext.characterId },
      customerServiceTopic: topicHint || "other", items: selection.items.map(limitSectionContent),
      ...(selection.selectionDiagnostics ? { selectionDiagnostics: selection.selectionDiagnostics } : {}),
      ...(selection.selectionFailure ? { selectionFailure: selection.selectionFailure } : {}) };
  }
  // Explicit semantic scope outranks legacy topic/keyword shortcuts. A general
  // definition must not acquire store policy or placeholder scripts as evidence.
  const excludeCustomerService = knowledgeScope === "general";
  if (excludeCustomerService) {
    // Lexical overlap is not a semantic gate: every authorized general section
    // remains eligible across languages, while the selector may retain none.
    const sections = await loadActiveSections({ db, category, excludeCustomerService: true, accessContext, includeContent: true });
    const selection = await selectGeneralReferences({ query: knowledgeQuery ? `${query}\nCurrent subquestion: ${String(knowledgeQuery).slice(0, 240)}` : query,
      sections, limit, siteId: accessContext.siteId, logContext });
    return { ok: true, query: normalizedQuery, strategy: selection.reason, customerServiceIntent: false, customerServiceTopic: "",
      items: selection.items.map(limitSectionContent), ...(selection.selectionFailure ? { selectionFailure: selection.selectionFailure } : {}) };
  }
  const customerServiceTopic = excludeCustomerService ? null
    : CUSTOMER_SERVICE_TOPICS.find((topic) => topic.id === topicHint) || resolveCustomerServiceTopic(normalizedQuery);
  if (customerServiceTopic && !category) {
    const customerServiceSections = await loadActiveSections({
      db,
      category: "customer_service",
      accessContext,
      includeContent: true,
    });
    const items = selectCustomerServiceSections(customerServiceSections, customerServiceTopic, limit, accessContext);
    return {
      ok: true,
      query: normalizedQuery,
      strategy: items.length ? "customer_service_topic" : "customer_service_no_reference",
      customerServiceIntent: true,
      customerServiceTopic: customerServiceTopic.id,
      items,
    };
  }
  const triggerPool = await loadActiveSections({ db, category, excludeCustomerService, accessContext, includeContent: false });
  const triggeredKnowledgeBaseIds = findTriggeredKnowledgeBaseIds(triggerPool, normalizedQuery);
  if (!triggeredKnowledgeBaseIds.length) {
    return { ok: true, query: normalizedQuery, items: [], strategy: "no_keyword_trigger", customerServiceIntent: false, customerServiceTopic: "" };
  }

  const sections = await loadActiveSections({
    db,
    category,
    excludeCustomerService,
    accessContext,
    knowledgeBaseIds: triggeredKnowledgeBaseIds,
    includeContent: true,
  });
  const firstPass = scoreSections(sections, normalizedQuery, { includeContent: false })
    .filter((item) => item.score >= KNOWLEDGE_RETRIEVAL_CONFIG.minRelevanceScore)
    .slice(0, KNOWLEDGE_RETRIEVAL_CONFIG.firstPassLimit);

  const expandedPool = firstPass.length
    ? sections.filter((section) => firstPass.some((item) => item.knowledgeBaseId === section.knowledgeBaseId))
    : sections;

  const expanded = scoreSections(expandedPool, normalizedQuery, { includeContent: true })
    .filter((item) => item.score >= KNOWLEDGE_RETRIEVAL_CONFIG.minRelevanceScore)
    .slice(0, KNOWLEDGE_RETRIEVAL_CONFIG.expandedSearchLimit);

  const merged = dedupeBySection([...firstPass, ...expanded])
    .sort((left, right) => right.score - left.score || left.order - right.order)
    .slice(0, Math.max(1, Number(limit) || KNOWLEDGE_RETRIEVAL_CONFIG.finalReferenceLimit))
    .map(limitSectionContent);

  return {
    ok: true,
    query: normalizedQuery,
    strategy: firstPass.length ? "directory_then_expanded" : "expanded_all",
    customerServiceIntent: false,
    customerServiceTopic: "",
    items: merged,
  };
}

function resolveCustomerServiceTopic(query = "") {
  return CUSTOMER_SERVICE_TOPICS.find((topic) => topic.query.test(query)) || null;
}

function selectCustomerServiceSections(sections = [], topic = null, limit = KNOWLEDGE_RETRIEVAL_CONFIG.finalReferenceLimit, accessContext = {}) {
  if (!topic) return [];
  const matchedSections = sections
    .map((section) => {
      const referenceText = buildSectionReferenceText(section);
      if (!topic.reference.test(referenceText)) return null;
      const title = normalizeText(section.title);
      return {
        ...section,
        score: 100
          + Math.min(3, Math.floor(section.basePriority / 40))
          + countTopicReferenceMatches(referenceText, topic.reference)
          + (topic.preferredTitle?.test(title) ? 40 : 0),
        reasons: [`customer_service:${topic.id}`],
      };
    })
    .filter(Boolean);
  const preferredSections = selectSiteSpecificDeliverySections(matchedSections, topic, accessContext);
  return preferredSections
    .sort((left, right) => right.score - left.score || left.order - right.order)
    .slice(0, Math.max(1, Number(limit) || KNOWLEDGE_RETRIEVAL_CONFIG.finalReferenceLimit))
    .map(limitSectionContent);
}

function selectSiteSpecificDeliverySections(sections = [], topic = null, accessContext = {}) {
  if (topic?.id !== "delivery" || !safeString(accessContext.siteId)) return sections;
  const siteSpecific = sections.filter((section) => section.scope === "site");
  return siteSpecific.length ? siteSpecific : sections;
}

function countTopicReferenceMatches(text = "", pattern) {
  if (!(pattern instanceof RegExp)) return 0;
  const matches = String(text || "").match(new RegExp(pattern.source, "gi"));
  return Math.min(20, matches?.length || 0);
}

function buildSectionReferenceText(section = {}) {
  return normalizeText([
    section.title,
    section.summary,
    section.content,
    ...(Array.isArray(section.keywords) ? section.keywords : []),
    ...(Array.isArray(section.fuzzyKeywords) ? section.fuzzyKeywords : []),
  ].join(" "));
}

async function loadActiveSections({ db, category, excludeCustomerService = false, accessContext, knowledgeBaseIds = [], includeContent = true } = {}) {
  const params = [];
  let where = "WHERE kb.knowledge_status = 'active' AND ks.section_status = 'active'";
  if (category) {
    where += " AND kb.category = ?";
    params.push(category);
  }
  if (excludeCustomerService) where += " AND kb.category <> 'customer_service'";
  if (knowledgeBaseIds.length) {
    where += ` AND kb.id IN (${knowledgeBaseIds.map(() => "?").join(",")})`;
    params.push(...knowledgeBaseIds);
  }
  const accessWhere = buildAccessWhere(accessContext, params);
  if (accessWhere) where += ` AND ${accessWhere}`;

  const [rows] = await db.execute(
    `SELECT
       kb.id AS knowledge_base_id,
       kb.label AS knowledge_base_label,
       kb.category,
       kb.scope,
       kb.site_id,
       kb.priority,
       kb.keywords_json AS base_keywords_json,
       kb.fuzzy_keywords_json AS base_fuzzy_keywords_json,
       ks.id AS section_id,
       ks.section_key,
       ks.title,
       ks.summary,
       ${includeContent ? "ks.content" : "''"} AS content,
       ks.keywords_json,
       ks.fuzzy_keywords_json,
       ks.display_order
     FROM knowledge_sections ks
     INNER JOIN knowledge_bases kb ON kb.id = ks.knowledge_base_id
     ${where}
     ORDER BY kb.priority DESC, ks.display_order ASC`,
    params
  );

  return rows.map((row) => ({
    id: row.section_id,
    key: row.section_key || "",
    title: row.title || "",
    summary: row.summary || "",
    content: row.content || "",
    knowledgeBaseId: row.knowledge_base_id,
    knowledgeBaseLabel: row.knowledge_base_label || "",
    category: row.category || "",
    scope: row.scope || "",
    siteId: row.site_id || "",
    basePriority: Number(row.priority || 0),
    keywords: [...parseJsonArray(row.base_keywords_json), ...parseJsonArray(row.keywords_json)],
    fuzzyKeywords: [...parseJsonArray(row.base_fuzzy_keywords_json), ...parseJsonArray(row.fuzzy_keywords_json)],
    order: Number(row.display_order || 0),
  }));
}

function buildAccessWhere(accessContext, params) {
  const characterId = safeString(accessContext.characterId);
  const siteId = safeString(accessContext.siteId);
  if (!characterId && !siteId) return "";

  const parts = ["kb.scope = 'global'"];
  if (siteId) {
    parts.push(`(
      kb.scope = 'site'
      AND (
        kb.site_id = ?
        OR EXISTS (
          SELECT 1 FROM knowledge_base_bindings kbb_site
          WHERE kbb_site.knowledge_base_id = kb.id
            AND kbb_site.binding_status = 'active'
            AND kbb_site.target_type = 'site'
            AND kbb_site.target_id = ?
        )
      )
    )`);
    params.push(siteId, siteId);
  }
  if (characterId) {
    parts.push(`(
      kb.scope IN ('targeted', 'role')
      AND EXISTS (
        SELECT 1 FROM knowledge_base_bindings kbb_character
        WHERE kbb_character.knowledge_base_id = kb.id
          AND kbb_character.binding_status = 'active'
          AND kbb_character.target_type = 'character'
          AND kbb_character.target_id = ?
      )
    )`);
    params.push(characterId);
  }
  return `(${parts.join(" OR ")})`;
}

function findTriggeredKnowledgeBaseIds(sections, query) {
  const queryTokens = tokenize(query);
  const ids = new Set();
  for (const section of sections) {
    const triggerText = normalizeText([
      section.knowledgeBaseLabel,
      section.title,
      section.summary,
      section.keywords.join(" "),
      section.fuzzyKeywords.join(" "),
    ].join(" "));
    if (queryTokens.some((token) => containsToken(triggerText, token)
      || section.fuzzyKeywords.some(keyword => fuzzyTokenMatches(keyword, token)))) {
      ids.add(section.knowledgeBaseId);
    }
  }
  return [...ids];
}

function scoreSections(sections, query, { includeContent }) {
  const queryTokens = tokenize(query);
  return sections
    .map((section) => {
      const titleText = normalizeText(`${section.title} ${section.summary} ${section.keywords.join(" ")}`);
      const contentText = includeContent ? normalizeText(section.content) : "";
      let score = 0;
      const reasons = [];

      for (const token of queryTokens) {
        if (containsToken(titleText, token)) {
          score += 4;
          reasons.push(`title:${token}`);
        } else if (section.fuzzyKeywords.some((keyword) => fuzzyTokenMatches(keyword, token))) {
          score += 2;
          reasons.push(`keyword:${token}`);
        } else if (containsToken(contentText, token)) {
          score += 1;
          reasons.push(`content:${token}`);
        }
      }

      if (score > 0) score += Math.min(3, Math.floor(section.basePriority / 40));
      return { ...section, score, reasons: [...new Set(reasons)] };
    })
    .filter((section) => section.score > 0)
    .sort((left, right) => right.score - left.score || left.order - right.order);
}

function dedupeBySection(items) {
  const seen = new Map();
  for (const item of items) {
    const current = seen.get(item.id);
    if (!current || item.score > current.score) seen.set(item.id, item);
  }
  return [...seen.values()];
}

function limitSectionContent(item) {
  const max = KNOWLEDGE_RETRIEVAL_CONFIG.maxCharsPerSection;
  const content = String(item.content || "");
  return {
    id: item.id,
    key: item.key,
    title: item.title,
    summary: item.summary,
    ...(typeof item.evidenceQuote === "string" && item.evidenceQuote.length >= 8 && item.evidenceQuote.length <= max && content.includes(item.evidenceQuote)
      && (content.length <= max || content.slice(0, max).includes(item.evidenceQuote)) ? { evidenceQuote: item.evidenceQuote } : {}),
    content: content.length > max ? `${content.slice(0, max).trim()}...` : content,
    knowledgeBaseId: item.knowledgeBaseId,
    knowledgeBaseLabel: item.knowledgeBaseLabel,
    category: item.category,
    score: item.score,
    reasons: item.reasons,
  };
}

function tokenize(text) {
  const normalized = normalizeText(text);
  const words = (normalized.match(/[\p{L}\p{N}\p{M}]+/gu) || [])
    .filter(token => token.length >= 2 && !/[\u4e00-\u9fa5]/u.test(token) && !ENGLISH_STOP_WORDS.has(token));
  const cjk = normalized.match(/[\u4e00-\u9fa5]{2,}/g) || [];
  const cjkPairs = cjk.flatMap((part) => {
    if (part.length <= 4) return [part];
    const pairs = [];
    for (let index = 0; index < part.length - 1; index += 1) pairs.push(part.slice(index, index + 2));
    return pairs;
  });
  return [...new Set([...words, ...cjk, ...cjkPairs])].slice(0, 40);
}

function containsToken(value, token) {
  if (!token) return false;
  if (/[\u4e00-\u9fa5]/u.test(token)) return value.includes(token);
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^\\p{L}\\p{N}\\p{M}])${escaped}(?=$|[^\\p{L}\\p{N}\\p{M}])`, "u").test(value);
}

function fuzzyTokenMatches(keyword, token) {
  const normalized = normalizeText(keyword);
  if (containsToken(normalized, token) || containsToken(token, normalized)) return true;
  // Explicit fuzzy keywords may match a complete word's prefix (shirt/shirts),
  // never an internal fragment or a two-letter function word.
  return token.length >= 4 && tokenize(normalized).some(word => word.length >= 4
    && (word.startsWith(token) || token.startsWith(word)));
}

function normalizeText(value) {
  return String(value == null ? "" : value)
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeAccessContext({ character = null, characterId = "", siteId = "" } = {}) {
  return {
    characterId: safeString(characterId || character?.id || character?.character_id || character?.characterId),
    siteId: safeString(siteId || character?.site_id || character?.siteId),
  };
}

function safeString(value) {
  return String(value == null ? "" : value).trim();
}

function parseJsonArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean).map(String);
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed.filter(Boolean).map(String) : [];
  } catch {
    return [];
  }
}
