import fs from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();
const requiredDocs = [
  {
    file: 'docs/system/README.md',
    headings: ['AIOVE System Documentation', '文档结构', '当前重要状态']
  },
  {
    file: 'docs/system/01-system-overview.md',
    headings: ['01. System Overview', '系统核心概念', '页面地图']
  },
  {
    file: 'docs/system/02-frontend-pages.md',
    headings: ['02. Frontend Pages', '登录页', 'Chat 聊天页']
  },
  {
    file: 'docs/system/03-admin-console.md',
    headings: ['03. Admin Console', '概览', '知识库']
  },
  {
    file: 'docs/system/04-backend-services-and-data.md',
    headings: ['04. Backend Services and Data', '认证 / 用户 / 账号', '商品 / 商品源 / 商品埋点']
  },
  {
    file: 'docs/system/05-operations-and-deployment.md',
    headings: ['05. Operations and Deployment', '本地运行', '线上发布']
  },
  {
    file: 'docs/system/06-api-index.md',
    headings: ['06. API Index', 'Auth', 'Products']
  },
  {
    file: 'docs/system/pages/README.md',
    headings: ['AIOVE 页面与字段规范', '用户侧页面', '后台页面', '维护要求']
  }
];

const requiredPageDocs = [
  ['docs/system/pages/user/01-authentication.md', ['登录页', '注册页', '忘记密码页']],
  ['docs/system/pages/user/02-navigation-discover-search.md', ['App Shell', 'Discover', 'Search', '404']],
  ['docs/system/pages/user/03-chat-product-call.md', ['Chat 页面', '商品详情面板', '实时通话']],
  ['docs/system/pages/user/04-create-profile.md', ['Create Character', 'Profile 弹窗']],
  ['docs/system/pages/user/05-kitshop-feedback-creator.md', ['Kitshop', '用户反馈弹窗', 'Creator Workspace']],
  ['docs/system/pages/admin/01-overview-characters.md', ['概览', '网红角色', '通用角色']],
  ['docs/system/pages/admin/02-sites-mascot-carousel.md', ['站点管理', '前台管理', '首页轮播']],
  ['docs/system/pages/admin/03-commerce-knowledge.md', ['Kitshop 管理', '广告活动', '知识库']],
  ['docs/system/pages/admin/04-feedback-accounts-logs.md', ['用户反馈', '账号管理', '错误日志']],
  ['docs/system/pages/admin/05-placeholders-hidden.md', ['商家线索', '折扣码', '交易支付', '成本与利润', 'AI 角色卡']],
];

const missing = [];

for (const doc of requiredDocs) {
  const fullPath = path.join(rootDir, doc.file);
  if (!fs.existsSync(fullPath)) {
    missing.push(`${doc.file}: missing file`);
    continue;
  }

  const content = fs.readFileSync(fullPath, 'utf8');
  for (const heading of doc.headings) {
    if (!content.includes(heading)) {
      missing.push(`${doc.file}: missing "${heading}"`);
    }
  }
}

for (const [file, headings] of requiredPageDocs) {
  const fullPath = path.join(rootDir, file);
  if (!fs.existsSync(fullPath)) {
    missing.push(`${file}: missing page spec`);
    continue;
  }
  const content = fs.readFileSync(fullPath, 'utf8');
  for (const heading of headings) {
    if (!content.includes(heading)) missing.push(`${file}: missing "${heading}"`);
  }
  if (!content.includes('实现状态：') || !content.includes('验证范围：')) {
    missing.push(`${file}: missing implementation status or verification scope`);
  }
  if (!content.includes('| ---')) missing.push(`${file}: missing field/operation table`);
  validateRelativeMarkdownLinks(file, content, missing);
}

validatePageInventory(missing);

if (missing.length > 0) {
  console.error('[system-docs-self-check] failed');
  for (const item of missing) {
    console.error(`- ${item}`);
  }
  process.exit(1);
}

console.log('[system-docs-self-check] ok');

function validateRelativeMarkdownLinks(file, content, errors) {
  const linkPattern = /\]\(([^)#]+\.md)(?:#[^)]+)?\)/g;
  for (const match of content.matchAll(linkPattern)) {
    const target = match[1];
    if (/^(?:https?:|\/)/.test(target)) continue;
    const resolved = path.resolve(rootDir, path.dirname(file), target);
    if (!fs.existsSync(resolved)) errors.push(`${file}: broken link ${target}`);
  }
}

function validatePageInventory(errors) {
  const pageIndexPath = path.join(rootDir, 'docs/system/pages/README.md');
  const pageIndex = fs.readFileSync(pageIndexPath, 'utf8');
  const accessControl = fs.readFileSync(path.join(rootDir, 'src/app/access-control.js'), 'utf8');
  const adminData = fs.readFileSync(path.join(rootDir, 'src/features/admin-console/admin-console-data.js'), 'utf8');

  const viewBlock = accessControl.match(/const VIEW_PATHS = Object\.freeze\(\{([\s\S]*?)\}\);/)?.[1] || '';
  const frontendViews = Array.from(viewBlock.matchAll(/^\s*(?:"([^"]+)"|([a-z][a-z-]*)):\s*"([^"]+)"/gm))
    .map((match) => ({ key: match[1] || match[2], route: match[3] }));
  const frontendMarkers = {
    login: 'login', register: 'register', 'forgot-password': 'forgot-password', discover: 'discover',
    kitshop: 'kitshop', search: 'search', create: 'create', chat: 'chat', creator: 'creator',
    admin: '后台页面', 'not-found': '404',
  };
  for (const view of frontendViews) {
    const marker = frontendMarkers[view.key] || view.route;
    if (!pageIndex.toLowerCase().includes(String(marker).toLowerCase())) {
      errors.push(`docs/system/pages/README.md: missing frontend view ${view.key}`);
    }
  }

  const navBlock = adminData.match(/export const ADMIN_NAV = \[([\s\S]*?)\];/)?.[1] || '';
  const adminViews = Array.from(navBlock.matchAll(/\["([^"]+)"/g)).map((match) => match[1]);
  for (const view of adminViews) {
    if (!pageIndex.includes(view)) errors.push(`docs/system/pages/README.md: missing admin view ${view}`);
  }
}
