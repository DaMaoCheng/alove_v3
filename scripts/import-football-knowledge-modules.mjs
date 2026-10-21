import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { closeDbPool, initializeDatabase } from "../server/db.js";
import { upsertKnowledgeBaseWithSections } from "../server/admin-knowledge-service.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const SOURCE_DIR = path.join(PROJECT_ROOT, "docs/knowledge-base/sources");

const MODULES = [
  {
    id: "kb_football_epic_moments",
    label: "足球史诗、经典战役与标志性转会知识库",
    file: "football-epic-moments.md",
    summary: "覆盖经典比赛、足球史悲剧事件、黑暗事件和改变足球版图的标志性转会，适合角色讲故事、赛事情绪铺垫和文化背景解释。",
    keywords: ["经典战役", "世界杯", "欧冠", "悲剧事件", "标志性转会", "Maracanazo", "Istanbul", "Bosman"],
    fuzzyKeywords: ["马拉卡纳", "伯尔尼奇迹", "伊斯坦布尔", "上帝之手", "希尔斯伯勒", "博斯曼", "菲戈", "内马尔"],
    priority: 88,
    sectionPrefix: "epic",
  },
  {
    id: "kb_football_tactics_managers",
    label: "足球战术演变与传奇主教练知识库",
    file: "football-tactics-managers.md",
    summary: "覆盖阵型演变、战术体系、足球哲学和传奇主教练档案，适合战术分析、赛后复盘和 pundit 角色引用。",
    keywords: ["战术", "阵型", "主教练", "高位逼抢", "全攻全守", "Tiki-Taka", "Gegenpressing", "False 9"],
    fuzzyKeywords: ["金字塔阵型", "WM", "链式防守", "瓜迪奥拉", "克洛普", "穆里尼奥", "弗格森", "安切洛蒂"],
    priority: 87,
    sectionPrefix: "tactics",
  },
  {
    id: "kb_football_stadiums_kits",
    label: "传奇球场、标志性球衣与复古球衣文化知识库",
    file: "football-stadiums-kits.md",
    summary: "覆盖传奇球场、经典球衣款式、复古球衣品牌和球衣收藏术语，适合商品推荐、球衣故事和球迷文化聊天。",
    keywords: ["球场", "球衣", "复古球衣", "收藏", "Match Worn", "Player Issue", "Wembley", "Camp Nou"],
    fuzzyKeywords: ["马拉卡纳", "温布利", "诺坎普", "伯纳乌", "巴西1970", "德国1990", "尼日利亚2018", "球员版"],
    priority: 90,
    sectionPrefix: "kits",
  },
  {
    id: "kb_football_culture_awards",
    label: "足球荣誉、影视书籍与文化名场面知识库",
    file: "football-culture-awards.md",
    summary: "覆盖金球奖、FIFA/UEFA 奖项、纪录片电影书籍、足球名言和文化名场面，适合轻知识、榜单、荣誉和文化讨论。",
    keywords: ["金球奖", "FIFA", "UEFA", "纪录片", "足球电影", "足球书籍", "名言", "名场面"],
    fuzzyKeywords: ["Ballon d'Or", "Puskas", "Yashin", "贝克汉姆", "马拉多纳", "Fever Pitch", "梅西举杯"],
    priority: 86,
    sectionPrefix: "culture",
  },
];

const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  const imports = [];

  for (const module of MODULES) {
    const sourcePath = path.join(SOURCE_DIR, module.file);
    const source = await readFile(sourcePath, "utf8");
    const sections = buildMarkdownSections(source, module.sectionPrefix);
    imports.push({ module, sourcePath, sections });
  }

  if (DRY_RUN) {
    console.log(JSON.stringify({
      ok: true,
      dryRun: true,
      modules: imports.map(({ module, sections }) => ({
        id: module.id,
        file: module.file,
        sectionCount: sections.length,
        firstSection: sections.at(0)?.title || "",
        lastSection: sections.at(-1)?.title || "",
      })),
    }, null, 2));
    return;
  }

  await initializeDatabase();

  const imported = [];
  for (const { module, sourcePath, sections } of imports) {
    const result = await upsertKnowledgeBaseWithSections({
      id: module.id,
      label: module.label,
      category: "football",
      scope: "global",
      status: "active",
      language: "中文/English football terms",
      priority: module.priority,
      maxSections: 12,
      maxCharsPerSection: 1800,
      summary: module.summary,
      keywords: module.keywords,
      fuzzyKeywords: module.fuzzyKeywords,
      sourceType: "import",
      sourceRef: path.relative(PROJECT_ROOT, sourcePath),
      sections,
    });
    imported.push({
      id: result.item.id,
      label: result.item.label,
      sectionCount: result.item.sectionCount,
    });
  }

  console.log(JSON.stringify({ ok: true, imported }, null, 2));
}

function buildMarkdownSections(markdown, prefix) {
  const lines = String(markdown || "").split(/\r?\n/);
  const sections = [];
  let parentHeading = "";
  let current = null;
  let skipReferences = false;

  for (const line of lines) {
    const h2 = line.match(/^##\s+(.+)$/);
    if (h2) {
      if (current) {
        sections.push(current);
        current = null;
      }
      parentHeading = cleanHeading(h2[1]);
      skipReferences = isSkippedHeading(parentHeading);
      continue;
    }

    const h3 = line.match(/^###\s+(.+)$/);
    if (h3) {
      if (current) sections.push(current);
      if (skipReferences) {
        current = null;
        continue;
      }
      const title = cleanHeading(h3[1]);
      current = { title, parentHeading, lines: [line] };
      continue;
    }

    if (current && !skipReferences) current.lines.push(line);
  }

  if (current) sections.push(current);

  return sections
    .filter((section) => section.lines.join("\n").trim().length >= 120)
    .map((section, index) => {
      const content = section.lines.join("\n").trim();
      const title = normalizeTitle(section.title, section.parentHeading);
      const orderKey = String(index + 1).padStart(3, "0");
      return {
        key: `${prefix}_${orderKey}_${slugify(section.parentHeading)}_${slugify(section.title)}`.replace(/_+/g, "_").slice(0, 96),
        title,
        summary: buildSummary(content),
        content,
        keywords: buildKeywords(section.title, section.parentHeading),
        fuzzyKeywords: buildFuzzyKeywords(content),
        order: (index + 1) * 10,
        sourceHeading: section.parentHeading ? `${section.parentHeading} / ${section.title}` : section.title,
      };
    });
}

function isSkippedHeading(heading) {
  return /^目录\b/.test(heading) || /主要参考资料/.test(heading) || /参考资料/.test(heading);
}

function cleanHeading(value) {
  return String(value || "")
    .replace(/\s*\{#.+?\}\s*$/g, "")
    .trim();
}

function normalizeTitle(title, parentHeading) {
  const cleanTitle = cleanHeading(title).replace(/^\d+(?:\.\d+)*\s*[.、]?\s*/, "").trim();
  const cleanParent = cleanHeading(parentHeading).replace(/^[一二三四五六七八九十]+[、.]\s*/, "").trim();
  if (!cleanParent || cleanTitle.includes(cleanParent)) return cleanTitle.slice(0, 255);
  return `${cleanParent} / ${cleanTitle}`.slice(0, 255);
}

function buildSummary(content) {
  const normalized = String(content || "")
    .replace(/^#+\s+/gm, "")
    .replace(/\[[^\]]+\]\([^)]+\)/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/[>*`|\-#]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized.slice(0, 260);
}

function buildKeywords(title, parentHeading) {
  return [...new Set(`${parentHeading} ${title}`
    .split(/[\s/／、&|｜()（）【】\[\]："“”]+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2))]
    .slice(0, 12);
}

function buildFuzzyKeywords(content) {
  const picked = [];
  const words = [
    "世界杯", "欧冠", "英超", "西甲", "意甲", "德甲", "国家队", "俱乐部", "转会",
    "球衣", "复古", "球场", "主教练", "战术", "阵型", "金球奖", "纪录片", "名言",
    "Brazil", "England", "Argentina", "Germany", "Manchester", "Barcelona", "Real Madrid",
    "Messi", "Ronaldo", "Maradona", "Guardiola", "Mourinho", "Klopp",
  ];
  for (const word of words) {
    if (content.toLowerCase().includes(word.toLowerCase())) picked.push(word);
  }
  return picked.slice(0, 16);
}

function slugify(value) {
  const ascii = String(value || "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
  return ascii || "section";
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (!DRY_RUN) await closeDbPool();
  });
