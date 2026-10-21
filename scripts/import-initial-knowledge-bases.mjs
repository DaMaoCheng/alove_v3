import { readFile } from "node:fs/promises";
import { closeDbPool, initializeDatabase } from "../server/db.js";
import { upsertKnowledgeBaseWithSections } from "../server/admin-knowledge-service.js";

const CUSTOMER_SOURCE = "/Users/cheng/Documents/客服话术知识库_KB_CustomerService.md";
const FOOTBALL_SOURCE = "/Users/cheng/Documents/足球知识库_KB_Football.md";

const FOOTBALL_SUPPLEMENT_SECTIONS = [
  {
    key: "football_rules_2025_26",
    title: "足球基础规则与 2025/26 规则更新",
    summary: "解释足球基础规则、VAR 适用边界、IFAB 2025/26 规则变化和英超 VAR 现场解释趋势。",
    content: `足球比赛通常每队 11 人，常规时间 90 分钟，分上下半场。基础规则包括进球、越位、犯规、黄牌、红牌、点球、任意球、角球、界外球等。VAR 用于辅助重大判罚，不替代主裁；具体适用范围由赛事规则决定。IFAB 是足球竞赛规则权威来源。2025/26 赛季英超观众可听到裁判对部分 VAR 审核结果作现场广播解释，事实性越位/不越位决定除外。回答用户时应把 VAR 描述为辅助工具，不应声称它能解决所有争议。参考：https://www.theifab.com/law-changes/latest/ 和 https://www.premierleague.com/en/news/4373884/whats-new-in-2025-26-season-ifab-laws-and-premier-league-football-principles`,
    keywords: ["IFAB", "VAR", "offside", "penalty", "yellow card", "red card", "足球规则"],
    fuzzyKeywords: ["越位", "点球", "红牌", "黄牌", "裁判", "规则变化"],
  },
  {
    key: "football_world_cup_champions_league_format",
    title: "2026 世界杯与欧冠新赛制",
    summary: "记录 2026 世界杯 48 队赛制和欧冠 36 队联赛阶段的通用解释。",
    content: `2026 FIFA World Cup 扩军到 48 队，分为 12 个四队小组；每组前 2 名和 8 个成绩最好的小组第三晋级 32 强淘汰赛。UEFA Champions League 已采用 36 队联赛阶段，不再是传统 32 队小组赛结构。具体赛程和参赛队伍会随赛季变化，回答时应避免把易过期日期说成永久事实。参考：https://www.uefa.com/uefachampionsleague/ 和 https://www.olympics.com/en/news/fifa-world-cup-2026-schedule-results-scores-standings-list`,
    keywords: ["World Cup 2026", "48 teams", "Champions League", "league phase", "UEFA"],
    fuzzyKeywords: ["世界杯", "欧冠", "小组赛", "联赛阶段", "赛制"],
  },
  {
    key: "modern_tactics_and_analytics",
    title: "现代战术与数据指标",
    summary: "解释高位逼抢、低位防守、内收边后卫、伪九号、半空间、xG、xA、PPDA、Field Tilt 等常见术语。",
    content: `现代足球聊天常见术语包括：高位逼抢，即在前场主动压迫对手出球；低位防守，即整体回撤压缩禁区前空间；内收边后卫，即边后卫在己方控球时进入中路，帮助中场出球并形成中路人数优势；伪九号，即名义中锋回撤组织，拉开中卫；半空间，即边路和中路之间的进攻区域。数据指标包括 xG（预期进球，衡量射门机会质量）、xA（预期助攻，衡量传球创造出的射门机会质量）、PPDA（衡量防守压迫强度，数值越低通常代表压迫越积极）和 Field Tilt（衡量比赛主要发生区域，不等于谁一定踢得更好）。参考：https://www.fifatrainingcentre.com/ 和 https://www.fourfourtwo.com/features/the-inverted-full-back-football-tactics-explained`,
    keywords: ["pressing", "inverted full-back", "false nine", "half-space", "xG", "xA", "PPDA", "Field Tilt"],
    fuzzyKeywords: ["高位逼抢", "内收边后卫", "伪九号", "半空间", "预期进球", "数据指标"],
  },
  {
    key: "football_fan_social_slang",
    title: "球迷社媒暗语与聊天边界",
    summary: "补充 GOAT、Derby、Ultras、Plastic fan、Banter、Bottle、Park the bus 等常见社媒表达。",
    content: `常见足球社媒表达：GOAT 指历史最佳；Derby 指德比或强敌对决；Ultras 指组织性强、氛围浓烈的球迷团体；Plastic fan 常用于吐槽跟风球迷，带攻击性，不建议主动对用户使用；Banter 指球迷间调侃；bottled it 指关键时刻掉链子；park the bus 指摆大巴、极端保守防守。聊天时可以轻松解释球迷文化，但不能输出仇恨、歧视、地域攻击、宗教攻击或煽动对立内容。参考：https://www.britannica.com/sports/Soccer-Slang-101-Glossary-of-Football-Terminology`,
    keywords: ["GOAT", "derby", "ultras", "plastic fan", "banter", "bottled it", "park the bus"],
    fuzzyKeywords: ["球迷暗语", "德比", "摆大巴", "跟风球迷", "球迷调侃"],
  },
];

async function main() {
  await initializeDatabase();

  const [customerSource, footballSource] = await Promise.all([
    readFile(CUSTOMER_SOURCE, "utf8"),
    readFile(FOOTBALL_SOURCE, "utf8"),
  ]);

  const customer = await upsertKnowledgeBaseWithSections({
    id: "kb_customer_service",
    label: "客服话术与跨境售后知识库",
    category: "customer_service",
    scope: "global",
    status: "active",
    language: "ES/PT-BR/FR/IT/DE/AR/TR/中文",
    priority: 95,
    maxSections: 8,
    maxCharsPerSection: 1800,
    summary: "跨境足球球衣电商客服知识库，覆盖客服 SLA、SOP、尺码、售前、物流、退换货、投诉、VIP、敏感场景和多平台话术。",
    keywords: ["客服", "SOP", "尺码", "物流", "退换货", "投诉", "VIP", "WhatsApp", "Email"],
    fuzzyKeywords: ["售前", "售后", "退款", "发货", "延误", "差评", "复购", "话术"],
    sourceType: "import",
    sourceRef: CUSTOMER_SOURCE,
    sections: buildMarkdownSections(cleanCustomerSource(customerSource), {
      prefix: "customer",
      startOrder: 10,
    }),
  });

  const footballSections = [
    ...FOOTBALL_SUPPLEMENT_SECTIONS.map((section, index) => ({ ...section, order: (index + 1) * 10 })),
    ...buildMarkdownSections(footballSource, {
      prefix: "football",
      startOrder: 100,
      skipHeadings: new Set([
        "11. 附录：球衣工艺术语对照表（9 语种）",
        "12. 正品鉴定术语详解",
        "13. 球迷俚语 & 助威口号（7 语种）",
      ]),
    }),
  ];

  const football = await upsertKnowledgeBaseWithSections({
    id: "kb_football",
    label: "足球百科、球衣文化与球迷语言知识库",
    category: "football",
    scope: "global",
    status: "active",
    language: "中文/多语种术语",
    priority: 85,
    maxSections: 8,
    maxCharsPerSection: 1800,
    summary: "足球百科与球衣文化知识库，覆盖规则、赛事、战术数据、俱乐部、国家队、球星、球衣工艺、鉴定、球迷俚语、品牌、赞助商和德比。",
    keywords: ["足球", "俱乐部", "国家队", "球星", "球衣", "赛事", "德比", "战术", "xG"],
    fuzzyKeywords: ["足球百科", "球迷文化", "球衣文化", "欧冠", "世界杯", "俱乐部历史"],
    sourceType: "import",
    sourceRef: FOOTBALL_SOURCE,
    sections: footballSections,
  });

  console.log(JSON.stringify({
    ok: true,
    imported: [
      { id: customer.item.id, sectionCount: customer.item.sectionCount },
      { id: football.item.id, sectionCount: football.item.sectionCount },
    ],
  }, null, 2));
}

function buildMarkdownSections(markdown, { prefix, startOrder = 10, skipHeadings = new Set() }) {
  const lines = String(markdown || "").split(/\r?\n/);
  const sections = [];
  let current = null;

  for (const line of lines) {
    const match = line.match(/^##\s+(.+)$/);
    if (match) {
      if (current) sections.push(current);
      const title = match[1].trim();
      current = skipHeadings.has(title) ? null : { title, lines: [line] };
      continue;
    }
    if (current) current.lines.push(line);
  }
  if (current) sections.push(current);

  return sections
    .filter((section) => !/^目录\b/.test(section.title))
    .map((section, index) => {
      const content = section.lines.join("\n").trim();
      return {
        key: `${prefix}_${slugify(section.title) || index + 1}`.slice(0, 96),
        title: normalizeTitle(section.title),
        summary: buildSummary(content),
        content,
        keywords: buildKeywords(section.title),
        fuzzyKeywords: buildFuzzyKeywords(content),
        order: startOrder + index * 10,
        sourceHeading: section.title,
      };
    });
}

function cleanCustomerSource(markdown) {
  return String(markdown || "")
    .replace(/\{描述商品状态：高品质仿制品\/官方授权正品\}/g, "以商品页面标注和订单信息为准")
    .replace(/高品质仿制品\/官方授权正品/g, "以商品页面标注和订单信息为准");
}

function normalizeTitle(title) {
  return String(title || "")
    .replace(/^\d+(?:\.\d+)*\s*[.、]?\s*/, "")
    .trim()
    .slice(0, 255);
}

function buildSummary(content) {
  const normalized = String(content || "")
    .replace(/^#+\s+/gm, "")
    .replace(/\[[^\]]+\]\([^)]+\)/g, "")
    .replace(/[>*`|\-#]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized.slice(0, 240);
}

function buildKeywords(title) {
  return normalizeTitle(title)
    .split(/[\s/／、&]+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2)
    .slice(0, 12);
}

function buildFuzzyKeywords(content) {
  const picked = [];
  for (const word of ["尺码", "物流", "退换货", "投诉", "VIP", "球员版", "球迷版", "俱乐部", "国家队", "球星", "德比", "球衣", "正品", "俚语", "赛事", "战术"]) {
    if (content.includes(word)) picked.push(word);
  }
  return picked.slice(0, 12);
}

function slugify(value) {
  return String(value || "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDbPool();
  });
