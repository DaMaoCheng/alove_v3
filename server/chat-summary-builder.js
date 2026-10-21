import { SUMMARY_PERIOD_TYPES } from "./chat-memory-taxonomy.js";

export function buildDailySummary(messages) {
  const userMessages = messages.filter((message) => message.senderType === "user");
  const allText = messages.map((message) => message.text).join("\n");
  const userText = userMessages.map((message) => message.text).join("\n");
  const json = {
    mainTopics: matchTopics(allText),
    keyEvents: extractKeyEvents(userText),
    footballPreferences: extractFootballPreferences(userText),
    emotionSignals: extractEmotionSignals(userText),
    interactionNotes: extractInteractionNotes(userText),
    followUpTopics: extractFollowUpTopics(allText),
  };
  return {
    json,
    text: buildDailySummaryText(json, messages.length),
  };
}

export function buildRollingSummary({ periodType, messages, dailySummaries }) {
  const userMessages = messages.filter((message) => message.senderType === "user");
  const allText = messages.map((message) => message.text).join("\n");
  const userText = userMessages.map((message) => message.text).join("\n");
  const mainTopics = rankTopicCounts(collectDailyTopicCounts(dailySummaries), allText);
  const json = {
    mainTopics,
    repeatedTopics: mainTopics,
    keyEvents: extractKeyEvents(userText),
    stablePreferences: extractStablePreferences(userText, dailySummaries),
    emotionTrends: extractEmotionTrendSignals(userText, dailySummaries),
    interactionTrends: extractInteractionTrendNotes(userText, dailySummaries),
    followUpTopics: extractFollowUpTopics(allText),
    activeDays: dailySummaries.length,
  };

  return {
    json,
    text: buildRollingSummaryText({
      periodType,
      summary: json,
      messageCount: messages.length,
      dailyCount: dailySummaries.length,
    }),
  };
}

function buildDailySummaryText(summary, messageCount) {
  const lines = [
    `今日共记录 ${messageCount} 条相关对话。`,
    summary.mainTopics.length ? `主要话题：${summary.mainTopics.join("、")}` : "",
    summary.keyEvents.length ? `关键事件：${summary.keyEvents.join("；")}` : "",
    summary.footballPreferences.length ? `足球偏好：${summary.footballPreferences.join("；")}` : "",
    summary.emotionSignals.length ? `情绪线索：${summary.emotionSignals.join("；")}` : "",
    summary.interactionNotes.length ? `互动偏好：${summary.interactionNotes.join("；")}` : "",
    summary.followUpTopics.length ? `可延续话题：${summary.followUpTopics.join("、")}` : "",
  ].filter(Boolean);
  return lines.join("\n");
}

function buildRollingSummaryText({ periodType, summary, messageCount, dailyCount }) {
  const periodLabel = periodType === SUMMARY_PERIOD_TYPES.WEEK ? "本周" : "本月";
  const lines = [
    `${periodLabel}共整理 ${messageCount} 条相关对话，覆盖 ${dailyCount} 个活跃日。`,
    summary.mainTopics.length ? `持续话题：${summary.mainTopics.join("、")}` : "",
    summary.keyEvents.length ? `关键事件：${summary.keyEvents.join("；")}` : "",
    summary.stablePreferences.length ? `稳定偏好：${summary.stablePreferences.join("；")}` : "",
    summary.emotionTrends.length ? `情绪趋势：${summary.emotionTrends.join("；")}` : "",
    summary.interactionTrends.length ? `互动偏好：${summary.interactionTrends.join("；")}` : "",
    summary.followUpTopics.length ? `可继续延伸：${summary.followUpTopics.join("、")}` : "",
  ].filter(Boolean);
  return lines.join("\n");
}

function matchTopics(text) {
  const topics = [];
  if (/阿森纳|Arsenal|枪手/i.test(text)) topics.push("阿森纳");
  if (/萨卡|Saka/i.test(text)) topics.push("萨卡");
  if (/英超|Premier League|EPL/i.test(text)) topics.push("英超");
  if (/裁判|VAR|点球|红牌|越位|referee|penalty|offside/i.test(text)) topics.push("裁判争议");
  if (/转会|签约|transfer|signing/i.test(text)) topics.push("转会");
  if (/战术|阵型|压迫|tactic|formation|press/i.test(text)) topics.push("战术");
  return [...new Set(topics)].slice(0, 8);
}

function extractKeyEvents(text) {
  return collectRuleValues(text, [
    { value: "用户提到裁判争议", pattern: /裁判|VAR|点球|红牌|越位|referee|penalty|offside/i },
    { value: "用户提到转会相关话题", pattern: /转会|签约|transfer|signing/i },
    { value: "用户提到比赛结果或走势", pattern: /赢了|输了|进球|丢球|比分|win|lost|goal|score/i },
  ], 4);
}

function extractFootballPreferences(text) {
  return collectRuleValues(text, [
    { value: "支持或关注阿森纳", pattern: /支持阿森纳|喜欢阿森纳|Arsenal/i },
    { value: "喜欢或关注萨卡", pattern: /喜欢萨卡|萨卡|Saka/i },
    { value: "常看英超", pattern: /主要看英超|常看英超|Premier League|EPL/i },
  ], 4);
}

function extractEmotionSignals(text) {
  return collectRuleValues(text, [
    { value: "对裁判争议容易烦躁", pattern: /裁判.*(烦|气|离谱)|referee.*(annoy|mad|absurd)/i },
    { value: "对比赛结果有强情绪反应", pattern: /输了.*(难受|烦|失望)|赢了.*(爽|激动|开心)/i },
  ], 4);
}

function extractInteractionNotes(text) {
  return collectRuleValues(text, [
    { value: "偏好短回复", pattern: /别长篇|短一点|少说点|keep it short/i },
    { value: "偏好专业分析", pattern: /专业点|分析深一点|讲战术|tactical analysis/i },
    { value: "偏好热血氛围", pattern: /热血点|燃一点|hype/i },
  ], 4);
}

function extractFollowUpTopics(text) {
  const topics = matchTopics(text);
  return topics.length ? topics : [];
}

function extractStablePreferences(text, dailySummaries = []) {
  const values = new Set(extractFootballPreferences(text));
  for (const item of dailySummaries) {
    for (const value of item.footballPreferences) {
      values.add(value);
    }
  }
  return [...values].slice(0, 6);
}

function extractEmotionTrendSignals(text, dailySummaries = []) {
  const values = new Set(extractEmotionSignals(text));
  for (const item of dailySummaries) {
    for (const value of item.emotionSignals) {
      values.add(value);
    }
  }
  return [...values].slice(0, 6);
}

function extractInteractionTrendNotes(text, dailySummaries = []) {
  const values = new Set(extractInteractionNotes(text));
  for (const item of dailySummaries) {
    for (const value of item.interactionNotes) {
      values.add(value);
    }
  }
  return [...values].slice(0, 6);
}

function collectRuleValues(text, rules, limit) {
  return rules
    .filter((rule) => rule.pattern.test(text))
    .map((rule) => rule.value)
    .filter(Boolean)
    .slice(0, limit);
}

function rankTopicCounts(seedCounts = new Map(), text = "") {
  const counts = new Map(seedCounts);
  for (const topic of matchTopics(text)) {
    counts.set(topic, Number(counts.get(topic) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([topic]) => topic)
    .slice(0, 8);
}

function collectDailyTopicCounts(dailySummaries = []) {
  const counts = new Map();
  for (const item of dailySummaries) {
    for (const topic of item.mainTopics) {
      counts.set(topic, Number(counts.get(topic) || 0) + 1);
    }
  }
  return counts;
}
