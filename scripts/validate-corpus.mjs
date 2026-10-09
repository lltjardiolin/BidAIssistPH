// Usage: node scripts/validate-corpus.mjs            (development)
//        node scripts/validate-corpus.mjs --release  (production gate)
//        node scripts/validate-corpus.mjs --manifest-only  (CI: no archive available)
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RELEASE = process.argv.includes('--release');
// CI has no archive (raw corpus is not committed): check the manifest only.
const MANIFEST_ONLY = process.argv.includes('--manifest-only');
const m = JSON.parse(await fs.readFile(path.join(ROOT, 'corpus', 'manifest.json'), 'utf8'));
const errors = [], warnings = [];
const ids = new Set(m.documents.map(d => d.id));

for (const d of m.documents) {
  for (const k of ['id', 'reference', 'type', 'framework', 'status', 'authority_level', 'issuing_body'])
    if (d[k] === undefined || d[k] === null || d[k] === '') errors.push(`${d.id || '<unknown>'}: missing ${k}`);
  if (d.ingest !== false && !d.source_url && !d.volume_urls) errors.push(`${d.id}: ingest:true but no source URL`);
  if (d.ingest === false && !d.ingest_blocker) errors.push(`${d.id}: ingest:false needs ingest_blocker`);
  if ((d.status === 'WITHDRAWN' || d.status === 'SUPERSEDED') && d.index_default !== false) errors.push(`${d.id}: ${d.status} must set index_default=false`);
  if (d.status === 'WITHDRAWN' && !d.withdrawn_by) errors.push(`${d.id}: WITHDRAWN needs withdrawn_by`);
  for (const k of ['withdrawn_by', 'superseded_by', 'counterpart', 'parent_id'])
    if (d[k] && !ids.has(d[k])) errors.push(`${d.id}: ${k} references unknown id ${d[k]}`);
  if (d.ingest === false) warnings.push(`${d.id}: excluded from ingest — ${d.ingest_blocker}`);
  if (d.release_note) (RELEASE ? errors : warnings).push(`${d.id}: ${d.release_note}`);
}

let lock;
if (!MANIFEST_ONLY) {
  try { lock = JSON.parse(await fs.readFile(path.join(ROOT, 'corpus', 'manifest.lock.json'), 'utf8')); }
  catch { errors.push('manifest.lock.json missing: run npm run corpus:download'); }
}

if (lock) {
  if (lock.corpus_version !== m.corpus_version) errors.push(`lock corpus_version ${lock.corpus_version} ≠ manifest ${m.corpus_version}`);
  for (const f of lock.failures ?? []) (RELEASE ? errors : warnings).push(`download failed: ${f.document_id} ${f.source_url} — ${f.error}`);
  for (const a of lock.artifacts) {
    if (!/^[a-f0-9]{64}$/.test(a.sha256 || '')) errors.push(`${a.document_id}: invalid sha256`);
    try { const st = await fs.stat(path.join(ROOT, a.local_path)); if (st.size !== a.bytes) errors.push(`${a.document_id}: byte-size mismatch`); }
    catch { errors.push(`${a.document_id}: missing local artifact ${a.local_path}`); }
    if (/\.pdf($|\?)/i.test(a.source_url) && a.content_type !== 'application/pdf') errors.push(`${a.document_id}: ${a.source_url} archived as ${a.content_type}, expected PDF`);
  }
  for (const d of m.documents.filter(d => d.ingest !== false)) {
    const arts = lock.artifacts.filter(a => a.document_id === d.id && a.ingest_field);
    if (!arts.length) errors.push(`${d.id}: ingest:true but no archived ingestible artifact`);
    else if (RELEASE && arts.some(a => !a.verified_for_ingest)) errors.push(`${d.id}: artifact(s) not approved — run corpus:approve after checking the PDF`);
  }
}

if (warnings.length) console.warn('WARN\n  ' + warnings.join('\n  '));
if (errors.length) { console.error('ERROR\n  ' + errors.join('\n  ')); process.exit(1); }
const n = m.documents.filter(d => d.ingest !== false).length;
console.log(`Corpus ${RELEASE ? 'RELEASE' : 'dev'} check passed: ${n} ingestible of ${m.documents.length} manifest entries; ${lock?.artifacts?.length || 0} locked artifacts.`);
