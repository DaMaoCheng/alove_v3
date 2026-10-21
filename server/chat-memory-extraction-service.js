import {
  MEMORY_SCOPES,
  MEMORY_SOURCE_KINDS,
  MEMORY_TYPES,
} from "./chat-memory-taxonomy.js";
import { createUserMemoryRecord } from "./chat-memory-service.js";
import { shouldSkipMemoryExtraction } from "./chat-memory-noise-service.js";

const CLUB_ALIASES = Object.freeze([
  ["Arsenal", "阿森纳", "枪手"],
  ["Manchester United", "曼联", "Man United", "Man Utd"],
  ["Manchester City", "曼城", "Man City"],
  ["Liverpool", "利物浦"],
  ["Chelsea", "切尔西"],
  ["Tottenham Hotspur", "热刺", "Tottenham", "Spurs"],
  ["Real Madrid", "皇马", "皇家马德里"],
  ["Barcelona", "巴萨", "巴塞罗那"],
  ["Bayern Munich", "拜仁", "拜仁慕尼黑"],
  ["Paris Saint-Germain", "巴黎", "巴黎圣日耳曼", "PSG"],
  ["Inter Milan", "国米", "国际米兰"],
  ["AC Milan", "米兰", "AC米兰"],
  ["Juventus", "尤文", "尤文图斯"],
  ["Dortmund", "多特", "多特蒙德"],
  ["Newcastle United", "纽卡", "纽卡斯尔"],
  ["England", "英格兰"],
  ["Argentina", "阿根廷"],
  ["Brazil", "巴西"],
  ["France", "法国"],
  ["Germany", "德国"],
  ["Spain", "西班牙"],
]);

const LEAGUE_ALIASES = Object.freeze([
  ["Premier League", "英超", "Premier League", "EPL"],
  ["La Liga", "西甲", "LaLiga"],
  ["Serie A", "意甲"],
  ["Bundesliga", "德甲"],
  ["Ligue 1", "法甲"],
  ["Champions League", "欧冠", "UCL"],
  ["Europa League", "欧联"],
  ["World Cup", "世界杯"],
  ["European Championship", "欧洲杯", "Euro"],
  ["Copa America", "美洲杯"],
]);

const PLAYER_ALIASES = Object.freeze([
  ["Messi", "梅西", "Lionel Messi"],
  ["Cristiano Ronaldo", "C罗", "Ronaldo", "Cristiano"],
  ["Mbappe", "姆巴佩", "Kylian Mbappe"],
  ["Haaland", "哈兰德", "Erling Haaland"],
  ["Bellingham", "贝林厄姆", "Jude Bellingham"],
  ["Saka", "萨卡", "Bukayo Saka"],
  ["Odegaard", "厄德高", "Martin Odegaard"],
  ["Son Heung-min", "孙兴慜", "Son"],
  ["Salah", "萨拉赫", "Mohamed Salah"],
  ["De Bruyne", "德布劳内", "Kevin De Bruyne"],
  ["Vinicius", "维尼修斯", "Vinicius Jr"],
  ["Neymar", "内马尔"],
]);

const WATCHING_HABIT_RULES = Object.freeze([
  { value: "熬夜看球", patterns: [/熬夜看球|半夜看球|凌晨看球|stay up.*match|watch.*late/i] },
  { value: "喜欢看直播", patterns: [/看直播|追直播|live match|watch live/i] },
  { value: "喜欢看集锦", patterns: [/看集锦|只看集锦|highlights/i] },
  { value: "喜欢赛前预测", patterns: [/赛前预测|预测比分|猜比分|predict.*score|prediction/i] },
  { value: "喜欢赛后复盘", patterns: [/赛后复盘|复盘比赛|post[- ]?match|match review/i] },
  { value: "关注转会", patterns: [/关注转会|看转会|转会新闻|transfer news|transfer window/i] },
]);

const INTERACTION_PREFERENCE_RULES = Object.freeze([
  { value: "喜欢短句回复", patterns: [/别长篇|少说点|短一点|简单点|short replies|keep it short/i] },
  { value: "喜欢专业分析", patterns: [/专业点|分析深一点|讲战术|多分析|tactical analysis|go deeper/i] },
  { value: "喜欢热血氛围", patterns: [/热血点|燃一点|嗨一点|激情点|more hype|hype me/i] },
  { value: "喜欢嘴毒吐槽", patterns: [/嘴毒|毒舌|吐槽狠点|roast|be savage/i] },
  { value: "喜欢朋友式聊天", patterns: [/像朋友|别像客服|自然点|like a friend|casual/i] },
]);

const EMOTION_TRIGGER_RULES = Object.freeze([
  { value: "裁判争议容易触发情绪", patterns: [/裁判.*(气|烦|离谱|受不了)|var.*(气|烦|离谱)|referee.*(mad|annoy|absurd)/i] },
  { value: "主队输球容易低落", patterns: [/主队输.*(难受|烦|受不了)|输了.*(难受|失望|心态)|when.*team.*lost/i] },
  { value: "德比战容易激动", patterns: [/德比.*(激动|紧张|上头)|derby.*(hype|nervous|intense)/i] },
  { value: "转会传闻容易焦虑", patterns: [/转会.*(焦虑|烦|急)|transfer.*(anxious|nervous|stress)/i] },
]);

const SOFT_INTEREST_PATTERNS = Object.freeze([
  /球衣|队服|训练服|周边|主场|客场|第三客场|印号|印字|想买|准备买|想入|想要|推荐|好看|喜欢/i,
  /\b(kit|kits|shirt|shirts|jersey|jerseys|training top|merch|home|away|third|nameset|buy|get|want|like|love|clean|recommend)\b/i,
]);

export async function extractAndStoreUserMemories(db, {
  message,
  session,
  userId,
  characterId,
} = {}) {
  if (String(message?.senderType || "").trim() !== "user") return [];
  if (String(message?.contentType || "text").trim() !== "text") return [];

  const text = String(message?.text || "").trim();
  if (!text) return [];
  if (shouldSkipMemoryExtraction(text)) return [];

  const memories = extractFootballUserMemories(text, { characterId });
  const stored = [];
  for (const memory of memories) {
    const memoryId = await createUserMemoryRecord(db, {
      userId,
      characterId: memory.characterScoped ? characterId : "",
      scope: memory.characterScoped ? MEMORY_SCOPES.CHARACTER_PRIVATE : MEMORY_SCOPES.GLOBAL,
      memoryType: memory.memoryType,
      title: memory.title,
      content: memory.content,
      summary: memory.summary,
      confidenceScore: memory.confidenceScore,
      importanceScore: memory.importanceScore,
      freshnessScore: memory.freshnessScore,
      sourceKind: MEMORY_SOURCE_KINDS.CHAT_TEXT,
      sourceMessageId: message.id,
      sourceSessionId: session?.id || message.sessionId,
    });
    stored.push({ ...memory, memoryId });
  }
  return stored;
}

export function extractFootballUserMemories(text = "") {
  const normalized = normalizeText(text);
  if (!normalized) return [];

  const memories = [
    ...extractIdentityMemories(normalized),
    ...extractAliasMemories(normalized, CLUB_ALIASES, {
      memoryType: MEMORY_TYPES.FAVORITE_CLUB,
      title: "支持球队",
      contentPrefix: "用户支持或高频关注球队",
      summaryPrefix: "支持球队",
      patterns: [
        /(?:我|本人)?(?:支持|主队是|喜欢|粉|最爱|一直看)([^。！？.!?\n]{1,80})/i,
        /(?:my team is|i support|i'm a fan of|i like|i love)([^。！？.!?\n]{1,80})/i,
      ],
      importanceScore: 88,
    }),
    ...extractAliasMemories(normalized, PLAYER_ALIASES, {
      memoryType: MEMORY_TYPES.FAVORITE_PLAYER,
      title: "喜欢球员",
      contentPrefix: "用户喜欢或高频关注球员",
      summaryPrefix: "喜欢球员",
      patterns: [
        /(?:我|本人)?(?:喜欢|最爱|粉|欣赏)([^。！？.!?\n]{1,80})/i,
        /(?:i like|i love|favorite player is|my favorite player is)([^。！？.!?\n]{1,80})/i,
      ],
      importanceScore: 82,
    }),
    ...extractAliasMemories(normalized, LEAGUE_ALIASES, {
      memoryType: MEMORY_TYPES.FAVORITE_LEAGUE,
      title: "常看联赛",
      contentPrefix: "用户常看或关注赛事",
      summaryPrefix: "常看赛事",
      patterns: [
        /(?:我|本人)?(?:常看|经常看|主要看|喜欢看|关注)([^。！？.!?\n]{1,80})/i,
        /(?:i watch|i follow|i mainly watch|favorite league is)([^。！？.!?\n]{1,80})/i,
      ],
      importanceScore: 76,
    }),
    ...extractLikelyFootballEntityMemories(normalized),
    ...extractRuleMemories(normalized, WATCHING_HABIT_RULES, {
      memoryType: MEMORY_TYPES.WATCHING_HABIT,
      title: "看球习惯",
      contentPrefix: "用户看球习惯",
      importanceScore: 72,
    }),
    ...extractRuleMemories(normalized, INTERACTION_PREFERENCE_RULES, {
      memoryType: MEMORY_TYPES.INTERACTION_PREFERENCE,
      title: "互动偏好",
      contentPrefix: "用户互动偏好",
      importanceScore: 78,
      characterScoped: true,
    }),
    ...extractRuleMemories(normalized, EMOTION_TRIGGER_RULES, {
      memoryType: MEMORY_TYPES.FOOTBALL_EMOTION_TRIGGER,
      title: "足球情绪触发点",
      contentPrefix: "用户足球相关情绪触发点",
      importanceScore: 70,
      freshnessScore: 65,
    }),
    ...extractOngoingTopicMemories(normalized),
    ...extractRawEpisodeMemories(normalized),
  ];

  return dedupeMemories(memories).slice(0, 6);
}

function extractLikelyFootballEntityMemories(text) {
  if (!SOFT_INTEREST_PATTERNS.some((pattern) => pattern.test(text))) return [];
  const matches = [
    ...findAliasMatches(text, CLUB_ALIASES),
    ...findAliasMatches(text, PLAYER_ALIASES),
  ];
  return [...new Set(matches)].slice(0, 4).map((value) => ({
    memoryType: MEMORY_TYPES.FAVORITE_TEAM_ENTITY,
    title: "可能喜欢的球队或球星",
    content: `用户可能喜欢或正在关注：${value}`,
    summary: `可能喜欢：${value}`,
    confidenceScore: 68,
    importanceScore: 74,
    freshnessScore: 82,
  }));
}

function extractIdentityMemories(text) {
  const memories = [];
  const nameMatch = text.match(/(?:我叫|叫我|你可以叫我|我的名字是)\s*([^，。！？,.!?\n]{1,24})/);
  if (nameMatch?.[1]) {
    const name = cleanValue(nameMatch[1], 20);
    if (name) {
      memories.push({
        memoryType: MEMORY_TYPES.IDENTITY,
        title: "用户称呼偏好",
        content: `用户希望被称呼为 ${name}`,
        summary: name,
        confidenceScore: 92,
        importanceScore: 86,
        freshnessScore: 80,
      });
    }
  }
  if (/用中文|说中文|中文聊/.test(text)) {
    memories.push({
      memoryType: MEMORY_TYPES.IDENTITY,
      title: "语言偏好",
      content: "用户偏好使用中文交流",
      summary: "偏好中文交流",
      confidenceScore: 88,
      importanceScore: 70,
      freshnessScore: 75,
    });
  }
  if (/speak english|use english|english please/i.test(text)) {
    memories.push({
      memoryType: MEMORY_TYPES.IDENTITY,
      title: "语言偏好",
      content: "用户偏好使用英文交流",
      summary: "偏好英文交流",
      confidenceScore: 88,
      importanceScore: 70,
      freshnessScore: 75,
    });
  }
  return memories;
}

function extractAliasMemories(text, aliasGroups, options) {
  const candidateSegments = options.patterns
    .map((pattern) => text.match(pattern)?.[1] || "")
    .filter(Boolean)
    .join(" ");
  if (!candidateSegments) return [];

  return findAliasMatches(candidateSegments, aliasGroups).map((value) => ({
    memoryType: options.memoryType,
    title: options.title,
    content: `${options.contentPrefix}：${value}`,
    summary: `${options.summaryPrefix}：${value}`,
    confidenceScore: 86,
    importanceScore: options.importanceScore,
    freshnessScore: 78,
  }));
}

function extractRuleMemories(text, rules, options) {
  return rules
    .filter((rule) => rule.patterns.some((pattern) => pattern.test(text)))
    .map((rule) => ({
      memoryType: options.memoryType,
      title: options.title,
      content: `${options.contentPrefix}：${rule.value}`,
      summary: rule.value,
      confidenceScore: 78,
      importanceScore: options.importanceScore,
      freshnessScore: options.freshnessScore || 72,
      characterScoped: Boolean(options.characterScoped),
    }));
}

function extractOngoingTopicMemories(text) {
  const memories = [];
  const topicPatterns = [
    { label: "转会", pattern: /(?:一直|最近|这几天|这周).{0,12}(转会|签约|买人|卖人)/ },
    { label: "裁判争议", pattern: /(?:一直|最近|这几天|这周).{0,12}(裁判|var|点球|红牌|越位)/i },
    { label: "战术讨论", pattern: /(?:一直|最近|这几天|这周).{0,12}(阵型|战术|压迫|防守|进攻)/ },
  ];
  for (const item of topicPatterns) {
    if (!item.pattern.test(text)) continue;
    memories.push({
      memoryType: MEMORY_TYPES.ONGOING_TOPIC,
      title: "持续话题",
      content: `用户近期持续关注：${item.label}`,
      summary: item.label,
      confidenceScore: 70,
      importanceScore: 68,
      freshnessScore: 86,
      characterScoped: true,
    });
  }
  return memories;
}

function extractRawEpisodeMemories(text) {
  const episodePatterns = [
    /(以后[^。！？\n]{0,50})/,
    /(下次[^。！？\n]{0,50})/,
    /(别这样叫我[^。！？\n]{0,50})/,
    /(这对我很重要[^。！？\n]{0,50})/,
    /(记住我[^。！？\n]{0,50})/,
    /(不要再[^。！？\n]{0,50})/,
  ];
  for (const pattern of episodePatterns) {
    const matched = text.match(pattern);
    const value = cleanValue(matched?.[1] || "", 80);
    if (!value || value.length < 5) continue;
    return [{
      memoryType: MEMORY_TYPES.RAW_EPISODE,
      title: "关键原话片段",
      content: `用户关键原话：${value}`,
      summary: value,
      confidenceScore: 82,
      importanceScore: 88,
      freshnessScore: 84,
      characterScoped: true,
    }];
  }
  return [];
}

function findAliasMatches(text, aliasGroups) {
  const normalized = normalizeText(text).toLowerCase();
  const matches = [];
  for (const group of aliasGroups) {
    const canonical = group[0];
    if (group.some((alias) => normalized.includes(String(alias).toLowerCase()))) {
      matches.push(canonical);
    }
  }
  return [...new Set(matches)].slice(0, 4);
}

function dedupeMemories(memories) {
  const seen = new Set();
  return memories.filter((memory) => {
    const key = `${memory.memoryType}::${memory.summary || memory.content}::${memory.characterScoped ? "private" : "global"}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeText(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function cleanValue(value, maxLength) {
  return normalizeText(value)
    .replace(/^(叫|是|为)/, "")
    .replace(/[，。！？,.!?].*$/, "")
    .slice(0, maxLength)
    .trim();
}
