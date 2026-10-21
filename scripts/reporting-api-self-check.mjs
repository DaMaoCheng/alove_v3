import { readFile } from 'node:fs/promises';
const files = ['server/reporting-token-service.js','server/reporting-data-service.js','server/reporting-routes.js','server/admin-reporting-routes.js'];
for (const file of files) { const source=await readFile(file,'utf8'); if (!source.trim()) throw new Error(`${file} empty`); }
const token=await readFile(files[0],'utf8');
const data=await readFile(files[1],'utf8');
const routes=await readFile(files[2],'utf8');
for (const text of [token,data,routes]) if (/token[^\n]*(?:raw|value).*send|sendJson[^\n]*token_hash/i.test(text)) throw new Error('possible token hash leak');
for (const required of ['revoked_at IS NULL','expires_at > NOW','token_hash','request_count','allSites']) if (!token.includes(required)) throw new Error(`missing token guard ${required}`);
for (const required of ['siteClause','guest_sessions','messages:read','LIMIT ${limit}']) if (!data.includes(required)) throw new Error(`missing data guard ${required}`);
if (!routes.includes('requireReportingToken')) throw new Error('report routes are not token guarded');
console.log('reporting-api-self-check: passed');
