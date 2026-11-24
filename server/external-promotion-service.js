import { getDbPool, withTransaction } from './db-core.js';
import { SERVER_CONFIG } from './config.js';
import { createId } from './security.js';
import { throwNotFound, throwUserError } from './admin-site-shared.js';
import { normalizeLauncherImageUrl, resolveExternalOrigin } from './external-embed-service.js';

const READ_SQL = `SELECT s.id AS site_id,s.slug AS site_slug,s.site_url,s.site_status,
 e.id,e.public_id,e.external_origin,e.promotion_draft_json,e.promotion_published_json
 FROM sites s LEFT JOIN site_external_embeds e ON e.site_id=s.id WHERE s.id=? LIMIT 1`;
const own = (v,k) => Object.prototype.hasOwnProperty.call(v,k);

export function defaultExternalPromotion(siteSlug = '') {
  return { launcherImageUrl: '/assets/promotions/pj-gift.svg',
    popupImageUrl: siteSlug === 'projerseyshop' ? '/assets/promotions/pj-black-friday-2026.png' : '',
    label: 'Black Friday offers', desktopRightPx: 24, desktopBottomPx: 24,
    mobileRightPx: 16, mobileBottomPx: 24, autoAvoid: true };
}

export function normalizeExternalPromotion(value, { complete = false } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throwUserError('活动挂件配置无效。');
  const config = {};
  for (const key of ['launcherImageUrl','popupImageUrl']) {
    const raw = typeof value[key] === 'string' ? value[key].trim() : '';
    if (raw.length > 512) throwUserError('活动图片地址过长。');
    if (complete && !raw) throwUserError('请先保存完整的礼盒图标和弹窗图片再发布。');
    // Public, image-only local directories; do not admit arbitrary paths or data/HTML.
    if (/^\/(?:assets\/promotions|uploads\/(?:avatars|carousel))\/[A-Za-z0-9_-][A-Za-z0-9_.-]*\.(?:png|jpe?g|webp|gif|svg)$/i.test(raw)) config[key] = raw;
    else {
      if (raw.startsWith('/')) throwUserError('活动图片必须使用允许的图片目录。');
      config[key] = raw ? normalizeLauncherImageUrl(raw) : '';
    }
  }
  const label = typeof value.label === 'string' ? value.label.trim() : '';
  if (label.length > 96) throwUserError('活动说明不能超过96个字符。');
  config.label = label || 'Special offers';
  for (const [key, fallback, max] of [['desktopRightPx',24,160],['desktopBottomPx',24,640],['mobileRightPx',16,120],['mobileBottomPx',24,640]]) {
    const v = value[key] ?? fallback;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > max) throwUserError('活动挂件位置超出允许范围。');
    config[key] = Math.round(v);
  }
  if (own(value,'autoAvoid') && typeof value.autoAvoid !== 'boolean') throwUserError('自动避让配置无效。');
  config.autoAvoid = value.autoAvoid !== false;
  return config;
}

function parseSaved(raw) {
  if (raw == null) return null;
  try { return normalizeExternalPromotion(typeof raw === 'string' ? JSON.parse(raw) : raw); }
  catch { return null; }
}
function installer(publicId) {
  if (!publicId) return '';
  return `<script src=${JSON.stringify(SERVER_CONFIG.publicBaseUrl+'/embed/promotion.js')} data-aiove-promotion=${JSON.stringify(publicId)} async></script>`;
}
function mapAdmin(row) {
  const published = parseSaved(row.promotion_published_json);
  return { siteId:row.site_id,publicId:row.public_id || '',
    draft:parseSaved(row.promotion_draft_json) || defaultExternalPromotion(row.site_slug),
    published,installerSnippet:published ? installer(row.public_id) : '' };
}
async function readSite(db, siteId, lock = false) {
  if (typeof siteId !== 'string' || !siteId.trim() || siteId.length > 64) throwNotFound();
  const [rows] = await db.execute(READ_SQL+(lock ? ' FOR UPDATE' : ''),[siteId.trim()]);
  if (!rows[0] || rows[0].site_status !== 'active') throwNotFound();
  return rows[0];
}
export async function getAdminExternalPromotion(siteId) {
  return {ok:true,item:mapAdmin(await readSite(getDbPool(),siteId))};
}
export async function saveAdminExternalPromotion(siteId, payload = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throwUserError('活动挂件操作无效。');
  const action = payload.action;
  if (!['save_draft','publish','disable'].includes(action)) throwUserError('活动挂件操作无效。');
  const draft = action === 'save_draft' ? normalizeExternalPromotion(payload.config) : null;
  const visiblePublication = action === 'publish' && own(payload,'config')
    ? normalizeExternalPromotion(payload.config,{complete:true}) : null;
  return withTransaction(async db => {
    let row = await readSite(db,siteId,true);
    if (!row.id) {
      if (action !== 'save_draft' && !visiblePublication) throwUserError('请先保存活动挂件草稿。');
      // Never use ON DUPLICATE UPDATE here: a concurrent chat save must not be overwritten.
      await db.execute(`INSERT IGNORE INTO site_external_embeds (id,public_id,site_id,external_origin)
        VALUES (?,?,?,?)`,[createId('embed'),createId('embed_public'),row.site_id,resolveExternalOrigin('',row.site_url)]);
      row = await readSite(db,siteId,true);
    }
    if (action === 'publish') {
      if (visiblePublication) {
        // Explicit publish is one transaction for exactly the config being previewed.
        const json = JSON.stringify(visiblePublication);
        await db.execute('UPDATE site_external_embeds SET promotion_draft_json=?, promotion_published_json=?, updated_at=NOW(3) WHERE id=?',[json,json,row.id]);
      } else {
        if (!row.promotion_draft_json) throwUserError('请先保存活动挂件草稿。');
        const saved = parseSaved(row.promotion_draft_json);
        normalizeExternalPromotion(saved,{complete:true});
        await db.execute('UPDATE site_external_embeds SET promotion_published_json=promotion_draft_json, updated_at=NOW(3) WHERE id=?',[row.id]);
      }
    } else if (action === 'save_draft') {
      await db.execute('UPDATE site_external_embeds SET promotion_draft_json=?, updated_at=NOW(3) WHERE id=?',[JSON.stringify(draft),row.id]);
    } else {
      await db.execute('UPDATE site_external_embeds SET promotion_published_json=NULL, updated_at=NOW(3) WHERE id=?',[row.id]);
    }
    return {ok:true,item:mapAdmin(await readSite(db,siteId))};
  });
}
export async function getPublicExternalPromotion(publicId, requestOrigin = '') {
  if (typeof publicId !== 'string' || !publicId || publicId.length > 64) return null;
  const [rows] = await getDbPool().execute(`SELECT e.promotion_published_json,e.external_origin
    FROM site_external_embeds e INNER JOIN sites s ON s.id=e.site_id
    WHERE e.public_id=? AND s.site_status='active' LIMIT 1`,[publicId]);
  const row = rows[0];
  // Exact browser Origin, never a path-normalized or user-provided alternate origin.
  if (!row || !requestOrigin || requestOrigin !== row.external_origin) return null;
  const config = parseSaved(row.promotion_published_json);
  if (!config) return null;
  try { normalizeExternalPromotion(config,{complete:true}); } catch { return null; }
  const absolute = value => new URL(value,SERVER_CONFIG.publicBaseUrl).toString();
  return {...config,launcherImageUrl:absolute(config.launcherImageUrl),popupImageUrl:absolute(config.popupImageUrl)};
}
