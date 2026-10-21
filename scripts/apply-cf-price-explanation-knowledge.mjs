import mysql from 'mysql2/promise';
import { mkdir, writeFile } from 'node:fs/promises';
import { SERVER_CONFIG } from '../server/config.js';

// Explicit local maintenance only; never run from startup or a global seed.
if (!['127.0.0.1', 'localhost', '::1'].includes(SERVER_CONFIG.db.host) || SERVER_CONFIG.db.port !== 3307) {
  throw new Error('This knowledge change is restricted to local MySQL :3307.');
}
const apply = process.argv.includes('--apply');
const baseId = 'kb_site_cf_price_explanation';
const sectionId = 'kbs_cf_price_explanation';
const content = 'En CamisetasFutbol, las diferencias de precio se relacionan principalmente con el modelo de la prenda y las promociones vigentes. Revisa la información y las condiciones que aparecen en la página de cada producto. Esta explicación general no confirma por qué dos artículos concretos tienen precios diferentes ni que una promoción se aplique a un artículo determinado. Para comparar dos artículos concretos hacen falta sus referencias o enlaces y la información verificable de sus páginas; no atribuyas la diferencia a una versión, calidad, impresión u otra característica sin esa evidencia.';
const db = await mysql.createConnection(SERVER_CONFIG.db);
try {
  await db.beginTransaction();
  const [[site]] = await db.execute('SELECT id FROM sites WHERE slug=?', ['camisetasfutbol']);
  if (!site) throw new Error('CamisetasFutbol site missing');
  const [bases] = await db.execute('SELECT * FROM knowledge_bases WHERE id=? FOR UPDATE', [baseId]);
  const [sections] = await db.execute('SELECT * FROM knowledge_sections WHERE id=? OR knowledge_base_id=? FOR UPDATE', [sectionId, baseId]);
  if (bases.length && (bases[0].site_id !== site.id || bases[0].scope !== 'site')) throw new Error('Existing knowledge scope mismatch');
  if (bases.length || sections.length) {
    const unchanged = bases.length === 1 && sections.length === 1 && sections[0].id === sectionId && sections[0].knowledge_base_id === baseId && sections[0].content === content;
    if (!unchanged) throw new Error('Existing knowledge differs; review before replacing');
    console.log(JSON.stringify({ ok: true, applied: false, reason: 'already_present' }));
  } else if (!apply) {
    console.log(JSON.stringify({ ok: true, applied: false, site: 'camisetasfutbol', baseId, sectionId, content }));
  } else {
    const backupDir = new URL('../.backups/price-followup-20261015/', import.meta.url);
    await mkdir(backupDir, { recursive: true, mode: 0o700 });
    await writeFile(new URL('local-price-knowledge-before.json', backupDir), JSON.stringify({ siteId: site.id, bases, sections }, null, 2), { mode: 0o600, flag: 'wx' });
    const keywords = JSON.stringify(['precio', 'diferencia', 'modelo', 'promociones', 'price difference', '款式', '价格差异']);
    await db.execute(`INSERT INTO knowledge_bases (id,label,summary,category,scope,site_id,language,priority,keywords_json,source_type,source_ref)
      VALUES (?,?,?,'customer_service','site',?,'Spanish',100,?,'manual',?)`,
    [baseId, 'CF Explicación de precios', 'Diferencias de precio: modelo y promociones; consultar las páginas de producto.', site.id, keywords, 'Customer-service guidance confirmed by project owner 2026-10-15']);
    await db.execute(`INSERT INTO knowledge_sections (id,knowledge_base_id,section_key,title,summary,content,keywords_json)
      VALUES (?,?,'price_explanation',?,?,?,?)`,
    [sectionId, baseId, 'Diferencias de precio entre prendas', 'El modelo y las promociones pueden explicar diferencias de precio; los casos concretos requieren evidencia.', content, keywords]);
    await db.commit();
    console.log(JSON.stringify({ ok: true, applied: true, site: 'camisetasfutbol', baseId, sectionId }));
  }
} finally {
  await db.rollback();
  await db.end();
}
