import { getDbPool } from "./db.js";
import { getLocalParts, normalizeTimeZone, zonedLocalTimeToDate } from "./proactive-delivery-policy.js";

const RANGE_DAYS = Object.freeze({ "7d": 7, "30d": 30, "90d": 90 });
const CREATOR_CATEGORY = "creator";

export async function getCreatorAnalytics(user, { range = "30d", now = new Date(), db = getDbPool() } = {}) {
  const normalizedRange = normalizeCreatorAnalyticsRange(range);
  const period = buildAnalyticsPeriod({ days: RANGE_DAYS[normalizedRange], now });
  const context = await resolveCreatorContext(db, user);
  const timeZone = normalizeTimeZone(context?.timeZone || "UTC");
  const buckets = buildNaturalDayBuckets(period.startAt, period.endAt, timeZone);

  if (!context) {
    return emptyCreatorAnalyticsResponse({ range: normalizedRange, period, buckets });
  }

  const scope = {
    ownerUid: user.id,
    characterId: context.characterId,
    siteId: context.siteId,
    siteSlug: context.siteSlug,
  };
  const [messagePeriods, audience, eventPeriods, trendMessages, trendEvents, topProducts] = await Promise.all([
    queryMessagePeriodSummary(db, scope, period),
    queryAudienceSummary(db, scope, period),
    queryEventPeriodSummary(db, scope, period),
    queryMessageTrend(db, scope, buckets),
    queryEventTrend(db, scope, buckets),
    queryTopProducts(db, scope, period),
  ]);

  const currentMessages = messagePeriods.current;
  const previousMessages = messagePeriods.previous;
  const currentEvents = eventPeriods.current;
  const previousEvents = eventPeriods.previous;
  const currentVisitRate = percentage(currentEvents.storeVisits, currentEvents.productTriggers);
  const previousVisitRate = percentage(previousEvents.storeVisits, previousEvents.productTriggers);

  return {
    ok: true,
    range: normalizedRange,
    period: serializePeriod(period),
    character: {
      id: context.characterId,
      name: context.characterName,
      avatarUrl: context.characterAvatarUrl,
    },
    summary: {
      conversations: currentMessages.conversations,
      productTriggers: currentEvents.productTriggers,
      storeVisits: currentEvents.storeVisits,
      visitRate: currentVisitRate,
    },
    comparison: {
      conversations: buildMetricComparison(currentMessages.conversations, previousMessages.conversations),
      productTriggers: buildMetricComparison(currentEvents.productTriggers, previousEvents.productTriggers),
      storeVisits: buildMetricComparison(currentEvents.storeVisits, previousEvents.storeVisits),
      visitRate: buildMetricComparison(currentVisitRate, previousVisitRate),
    },
    trend: mergeTrendBuckets(buckets, trendMessages, trendEvents),
    audience: {
      uniqueChatters: audience.uniqueChatters,
      newChatters: audience.newChatters,
      returningChatters: audience.returningChatters,
      returnRate: percentage(audience.returningChatters, audience.uniqueChatters),
      averageMessages: ratio(currentMessages.userMessages, currentMessages.conversations),
    },
    topProducts,
  };
}

export function normalizeCreatorAnalyticsRange(value = "30d") {
  const normalized = String(value || "").trim().toLowerCase();
  return RANGE_DAYS[normalized] ? normalized : "30d";
}

export function isValidCreatorAnalyticsRange(value) {
  return Boolean(RANGE_DAYS[String(value || "").trim().toLowerCase()]);
}

export function buildAnalyticsPeriod({ days, now = new Date() }) {
  const endAt = new Date(now);
  if (!Number.isFinite(endAt.getTime())) throw new Error("Invalid analytics end time");
  const durationMs = Math.max(1, Number(days || 1)) * 24 * 60 * 60 * 1000;
  const startAt = new Date(endAt.getTime() - durationMs);
  const previousStartAt = new Date(startAt.getTime() - durationMs);
  return { previousStartAt, startAt, endAt };
}

export function buildNaturalDayBuckets(startAt, endAt, timeZone = "UTC") {
  const normalizedTimeZone = normalizeTimeZone(timeZone);
  const buckets = [];
  let cursor = new Date(startAt);
  let index = 0;
  while (cursor < endAt && index < 100) {
    const local = getLocalParts(cursor, normalizedTimeZone);
    const nextLocalDate = addUtcCalendarDays(local, 1);
    const nextMidnight = zonedLocalTimeToDate({ ...nextLocalDate, hour: "00", minute: "00", second: "00" }, normalizedTimeZone);
    const bucketEnd = nextMidnight > cursor && nextMidnight < endAt ? nextMidnight : new Date(endAt);
    buckets.push({
      index,
      date: `${local.year}-${local.month}-${local.day}`,
      label: formatBucketLabel(local),
      startAt: new Date(cursor),
      endAt: new Date(bucketEnd),
    });
    cursor = bucketEnd;
    index += 1;
  }
  return buckets;
}

function addUtcCalendarDays(parts, days) {
  const date = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day) + days));
  return {
    year: String(date.getUTCFullYear()),
    month: String(date.getUTCMonth() + 1).padStart(2, "0"),
    day: String(date.getUTCDate()).padStart(2, "0"),
  };
}

function formatBucketLabel(parts) {
  return `${Number(parts.month)}/${Number(parts.day)}`;
}

async function resolveCreatorContext(db, user = {}) {
  if (String(user.account_type || user.accountType || "").toLowerCase() !== CREATOR_CATEGORY) return null;
  const [rows] = await db.execute(
    `SELECT c.id AS character_id, c.name AS character_name, c.avatar_url AS character_avatar_url,
            c.site_id, s.slug AS site_slug, s.time_zone
     FROM ai_characters c
     JOIN sites s ON s.id = c.site_id AND s.site_status = 'active'
     WHERE c.owner_uid = ?
       AND c.category_id = ?
       AND c.character_status <> 'archived'
       AND c.site_id = ?
     ORDER BY c.updated_at DESC, c.id ASC
     LIMIT 1`,
    [user.id, CREATOR_CATEGORY, user.site_id || ""]
  );
  const row = rows[0];
  if (!row) return null;
  return {
    characterId: row.character_id || "",
    characterName: row.character_name || "",
    characterAvatarUrl: row.character_avatar_url || "",
    siteId: row.site_id || "",
    siteSlug: row.site_slug || "",
    timeZone: row.time_zone || "UTC",
  };
}

async function queryMessagePeriodSummary(db, scope, period) {
  const [rows] = await db.execute(
    `SELECT
       CASE WHEN m.sent_at >= ? THEN 'current' ELSE 'previous' END AS period_key,
       COUNT(DISTINCT s.id) AS conversations,
       COUNT(*) AS user_messages
     FROM chat_messages m
     JOIN chat_sessions s ON s.id = m.session_id AND s.internal_uid IS NOT NULL
     JOIN ai_characters c ON c.id = s.character_id
     WHERE c.id = ?
       AND c.owner_uid = ?
       AND c.category_id = ?
       AND c.character_status <> 'archived'
       AND c.site_id = ?
       AND m.sender_type = 'user'
       AND m.delivery_status = 'sent'
       AND m.sent_at >= ?
       AND m.sent_at < ?
     GROUP BY period_key`,
    [period.startAt, scope.characterId, scope.ownerUid, CREATOR_CATEGORY, scope.siteId, period.previousStartAt, period.endAt]
  );
  return periodRows(rows, (row) => ({
    conversations: Number(row.conversations || 0),
    userMessages: Number(row.user_messages || 0),
  }), { conversations: 0, userMessages: 0 });
}

async function queryAudienceSummary(db, scope, period) {
  const [rows] = await db.execute(
    `SELECT
       COUNT(*) AS unique_chatters,
       SUM(first_message_at >= ?) AS new_chatters,
       SUM(first_message_at < ?) AS returning_chatters
     FROM (
       SELECT s.internal_uid,
              MIN(m.sent_at) AS first_message_at,
              MAX(m.sent_at >= ? AND m.sent_at < ?) AS active_in_period
       FROM chat_messages m
       JOIN chat_sessions s ON s.id = m.session_id AND s.internal_uid IS NOT NULL
       JOIN ai_characters c ON c.id = s.character_id
       WHERE c.id = ?
         AND c.owner_uid = ?
         AND c.category_id = ?
         AND c.character_status <> 'archived'
         AND c.site_id = ?
         AND m.sender_type = 'user'
         AND m.delivery_status = 'sent'
         AND m.sent_at < ?
       GROUP BY s.internal_uid
       HAVING active_in_period = 1
     ) audience_users`,
    [period.startAt, period.startAt, period.startAt, period.endAt, scope.characterId, scope.ownerUid, CREATOR_CATEGORY, scope.siteId, period.endAt]
  );
  const row = rows[0] || {};
  return {
    uniqueChatters: Number(row.unique_chatters || 0),
    newChatters: Number(row.new_chatters || 0),
    returningChatters: Number(row.returning_chatters || 0),
  };
}

async function queryEventPeriodSummary(db, scope, period) {
  const [rows] = await db.execute(
    `SELECT
       CASE WHEN e.created_at >= ? THEN 'current' ELSE 'previous' END AS period_key,
       SUM(e.event_type = 'product_bubble_triggered') AS product_triggers,
       SUM(e.event_type = 'product_detail_cta_click') AS store_visits
     ${trustedEventFromClause()}
     WHERE ${trustedEventWhereClause()}
       AND e.created_at >= ?
       AND e.created_at < ?
     GROUP BY period_key`,
    [
      period.startAt,
      scope.characterId,
      scope.ownerUid,
      CREATOR_CATEGORY,
      scope.siteId,
      scope.siteId,
      scope.siteSlug,
      scope.siteSlug,
      period.previousStartAt,
      period.endAt,
    ]
  );
  return periodRows(rows, mapEventCounts, { productTriggers: 0, storeVisits: 0 });
}

async function queryMessageTrend(db, scope, buckets) {
  if (!buckets.length) return [];
  const expressions = buckets.map((bucket) =>
    `COUNT(DISTINCT CASE WHEN m.sent_at >= ? AND m.sent_at < ? THEN s.id END) AS bucket_${bucket.index}`
  ).join(",\n            ");
  const [rows] = await db.execute(
    `SELECT ${expressions}
     FROM ai_characters c
     JOIN chat_sessions s ON s.character_id = c.id AND s.internal_uid IS NOT NULL
     JOIN chat_messages m ON m.session_id = s.id
     WHERE c.id = ?
       AND c.owner_uid = ?
       AND c.category_id = ?
       AND c.character_status <> 'archived'
       AND c.site_id = ?
       AND m.sender_type = 'user'
       AND m.delivery_status = 'sent'
       AND m.sent_at >= ?
       AND m.sent_at < ?`,
    [
      ...buckets.flatMap((bucket) => [bucket.startAt, bucket.endAt]),
      scope.characterId,
      scope.ownerUid,
      CREATOR_CATEGORY,
      scope.siteId,
      buckets[0].startAt,
      buckets.at(-1).endAt,
    ]
  );
  const row = rows[0] || {};
  return buckets.map((bucket) => ({ index: bucket.index, conversations: Number(row[`bucket_${bucket.index}`] || 0) }));
}

async function queryEventTrend(db, scope, buckets) {
  if (!buckets.length) return [];
  const expressions = buckets.flatMap((bucket) => [
    `SUM(CASE WHEN e.created_at >= ? AND e.created_at < ? AND e.event_type = 'product_bubble_triggered' THEN 1 ELSE 0 END) AS triggers_${bucket.index}`,
    `SUM(CASE WHEN e.created_at >= ? AND e.created_at < ? AND e.event_type = 'product_detail_cta_click' THEN 1 ELSE 0 END) AS visits_${bucket.index}`,
  ]).join(",\n            ");
  const [rows] = await db.execute(
    `SELECT ${expressions}
     ${trustedEventFromClause()}
     WHERE ${trustedEventWhereClause()}
       AND e.created_at >= ?
       AND e.created_at < ?`,
    [
      ...buckets.flatMap((bucket) => [bucket.startAt, bucket.endAt, bucket.startAt, bucket.endAt]),
      scope.characterId,
      scope.ownerUid,
      CREATOR_CATEGORY,
      scope.siteId,
      scope.siteId,
      scope.siteSlug,
      scope.siteSlug,
      buckets[0].startAt,
      buckets.at(-1).endAt,
    ]
  );
  const row = rows[0] || {};
  return buckets.map((bucket) => ({
    index: bucket.index,
    productTriggers: Number(row[`triggers_${bucket.index}`] || 0),
    storeVisits: Number(row[`visits_${bucket.index}`] || 0),
  }));
}

async function queryTopProducts(db, scope, period) {
  const [rows] = await db.execute(
    `SELECT
       COALESCE(
         NULLIF(JSON_UNQUOTE(JSON_EXTRACT(m.product_payload_json, '$.id')), ''),
         NULLIF(JSON_UNQUOTE(JSON_EXTRACT(m.product_payload_json, '$.productId')), ''),
         NULLIF(JSON_UNQUOTE(JSON_EXTRACT(m.product_payload_json, '$.url')), ''),
         NULLIF(JSON_UNQUOTE(JSON_EXTRACT(m.product_payload_json, '$.name')), '')
       ) AS product_key,
       MAX(COALESCE(
         NULLIF(JSON_UNQUOTE(JSON_EXTRACT(m.product_payload_json, '$.name')), ''),
         NULLIF(JSON_UNQUOTE(JSON_EXTRACT(m.product_payload_json, '$.title')), ''),
         NULLIF(m.text_content, '')
       )) AS product_name,
       MAX(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(m.product_payload_json, '$.imageUrl')), '')) AS image_url,
       SUM(e.event_type = 'product_bubble_triggered') AS product_triggers,
       SUM(e.event_type = 'product_detail_cta_click') AS store_visits
     ${trustedEventFromClause()}
     WHERE ${trustedEventWhereClause()}
       AND e.created_at >= ?
       AND e.created_at < ?
     GROUP BY product_key
     HAVING product_key IS NOT NULL AND product_key <> '' AND product_triggers > 0
     ORDER BY product_triggers DESC, store_visits DESC, product_key ASC
     LIMIT 5`,
    [
      scope.characterId,
      scope.ownerUid,
      CREATOR_CATEGORY,
      scope.siteId,
      scope.siteId,
      scope.siteSlug,
      scope.siteSlug,
      period.startAt,
      period.endAt,
    ]
  );
  return rows.map((row) => {
    const productTriggers = Number(row.product_triggers || 0);
    const storeVisits = Number(row.store_visits || 0);
    return {
      productKey: row.product_key || "",
      name: row.product_name || "Product",
      imageUrl: row.image_url || "",
      productTriggers,
      storeVisits,
      visitRate: percentage(storeVisits, productTriggers),
    };
  });
}

function trustedEventFromClause() {
  return `FROM product_analytics_events e
          JOIN chat_messages m ON m.id = e.message_id AND m.content_type = 'product' AND m.delivery_status = 'sent'
          JOIN chat_sessions s ON s.id = m.session_id AND s.internal_uid IS NOT NULL AND e.user_id = s.internal_uid
          JOIN ai_characters c ON c.id = s.character_id
          JOIN sites site ON site.id = c.site_id`;
}

function trustedEventWhereClause() {
  return `e.event_type IN ('product_bubble_triggered', 'product_detail_cta_click')
          AND c.id = ?
          AND c.owner_uid = ?
          AND c.category_id = ?
          AND c.character_status <> 'archived'
          AND c.site_id = ?
          AND ${trustedProductSiteClause()}`;
}

function trustedProductSiteClause() {
  return `(
    (NULLIF(JSON_UNQUOTE(JSON_EXTRACT(m.product_payload_json, '$.siteId')), '') = ?
      AND (NULLIF(JSON_UNQUOTE(JSON_EXTRACT(m.product_payload_json, '$.siteSlug')), '') IS NULL
        OR NULLIF(JSON_UNQUOTE(JSON_EXTRACT(m.product_payload_json, '$.siteSlug')), '') = ?))
    OR
    (NULLIF(JSON_UNQUOTE(JSON_EXTRACT(m.product_payload_json, '$.siteId')), '') IS NULL
      AND NULLIF(JSON_UNQUOTE(JSON_EXTRACT(m.product_payload_json, '$.siteSlug')), '') = ?)
  )`;
}

function mergeTrendBuckets(buckets, messageRows, eventRows) {
  const messages = new Map(messageRows.map((row) => [row.index, row]));
  const events = new Map(eventRows.map((row) => [row.index, row]));
  return buckets.map((bucket) => ({
    date: bucket.date,
    label: bucket.label,
    conversations: messages.get(bucket.index)?.conversations || 0,
    productTriggers: events.get(bucket.index)?.productTriggers || 0,
    storeVisits: events.get(bucket.index)?.storeVisits || 0,
  }));
}

function periodRows(rows, mapper, empty) {
  const result = { current: { ...empty }, previous: { ...empty } };
  for (const row of rows) {
    if (row.period_key === "current" || row.period_key === "previous") result[row.period_key] = mapper(row);
  }
  return result;
}

function mapEventCounts(row = {}) {
  return {
    productTriggers: Number(row.product_triggers || 0),
    storeVisits: Number(row.store_visits || 0),
  };
}

function percentage(numerator, denominator) {
  const safeDenominator = Number(denominator || 0);
  return safeDenominator > 0 ? Number(numerator || 0) / safeDenominator * 100 : null;
}

function ratio(numerator, denominator) {
  const safeDenominator = Number(denominator || 0);
  return safeDenominator > 0 ? Number(numerator || 0) / safeDenominator : null;
}

export function buildMetricComparison(current, previous) {
  if (current == null || previous == null) return { direction: "neutral", percent: null };
  const currentValue = Number(current);
  const previousValue = Number(previous);
  if (!Number.isFinite(currentValue) || !Number.isFinite(previousValue) || previousValue === 0) {
    return { direction: "neutral", percent: null };
  }
  const percent = (currentValue - previousValue) / Math.abs(previousValue) * 100;
  return {
    direction: percent > 0 ? "up" : percent < 0 ? "down" : "neutral",
    percent: Math.abs(percent),
  };
}

function serializePeriod(period) {
  return {
    previousStartAt: period.previousStartAt.toISOString(),
    startAt: period.startAt.toISOString(),
    endAt: period.endAt.toISOString(),
  };
}

function emptyCreatorAnalyticsResponse({ range, period, buckets }) {
  const emptyComparison = { direction: "neutral", percent: null };
  return {
    ok: true,
    range,
    period: serializePeriod(period),
    character: null,
    summary: { conversations: 0, productTriggers: 0, storeVisits: 0, visitRate: null },
    comparison: {
      conversations: emptyComparison,
      productTriggers: emptyComparison,
      storeVisits: emptyComparison,
      visitRate: emptyComparison,
    },
    trend: buckets.map((bucket) => ({
      date: bucket.date,
      label: bucket.label,
      conversations: 0,
      productTriggers: 0,
      storeVisits: 0,
    })),
    audience: { uniqueChatters: 0, newChatters: 0, returningChatters: 0, returnRate: null, averageMessages: null },
    topProducts: [],
  };
}
