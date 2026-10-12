// Maintainer-only. Never called from /api/chat.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await fs.readFile(path.join(ROOT, 'corpus', 'manifest.json'), 'utf8'));
const LOCK = path.join(ROOT, 'corpus', 'manifest.lock.json');
const archive = path.join(ROOT, 'corpus', 'archive');
await fs.mkdir(archive, { recursive: true });

let previous = { artifacts: [] };
try { previous = JSON.parse(await fs.readFile(LOCK, 'utf8')); } catch {}
const prevByKey = new Map(previous.artifacts.map(a => [`${a.document_id}|${a.source_field}|${a.variant ?? ''}`, a]));

// Optional: `node scripts/download-corpus.mjs DOC_ID [DOC_ID ...]` re-downloads only those documents;
// every other artifact/failure is carried over from the previous lock unchanged.
const ONLY = new Set(process.argv.slice(2));
const unknown = [...ONLY].filter(id => !manifest.documents.some(d => d.id === id));
if (unknown.length) { console.error(`Unknown document id(s): ${unknown.join(', ')}`); process.exit(1); }

const DEFAULT_FIELDS = ['source_url', 'circular_url', 'circular_urls', 'volume_urls'];
const sleep = ms => new Promise(r => setTimeout(r, ms));

function collect(doc) {
  const fields = doc.ingest_fields ?? DEFAULT_FIELDS;
  const out = [];
  // Always archive source_url for provenance, even when it is not an ingest field.
  for (const k of new Set(['source_url', ...fields])) {
    const v = doc[k];
    if (typeof v === 'string' && v) out.push({ field: k, variant: null, url: v, ingestField: fields.includes(k) });
    else if (Array.isArray(v)) v.forEach((url, i) => out.push({ field: k, variant: String(i), url, ingestField: fields.includes(k) }));
    else if (v && typeof v === 'object') Object.entries(v).forEach(([variant, url]) => out.push({ field: k, variant, url, ingestField: fields.includes(k) }));
  }
  return out;
}

async function fetchWithRetry(url, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 60_000);
    try {
      const r = await fetch(url, { redirect: 'follow', signal: ctl.signal,
        headers: { 'user-agent': 'BidAIssistPH-CorpusBuilder/1.1 (maintainer corpus build)' } });
      clearTimeout(t);
      if (r.ok) return r;
      last = new Error(`HTTP ${r.status}`);
      if (r.status < 500 && r.status !== 429) break;
    } catch (e) { clearTimeout(t); last = e; }
    await sleep(2000 * (i + 1));
  }
  throw last;
}

const artifacts = [], failures = [], changed = [];
if (ONLY.size) {
  artifacts.push(...previous.artifacts.filter(a => !ONLY.has(a.document_id)));
  failures.push(...(previous.failures ?? []).filter(f => !ONLY.has(f.document_id)));
}
for (const doc of manifest.documents) {
  if (ONLY.size && !ONLY.has(doc.id)) continue;
  for (const src of collect(doc)) {
    try {
      const r = await fetchWithRetry(src.url);
      const buf = Buffer.from(await r.arrayBuffer());
      const ct = (r.headers.get('content-type') || 'application/octet-stream').split(';')[0].trim();
      const expectPdf = /\.pdf($|\?)/i.test(src.url);
      const isPdf = buf.subarray(0, 5).toString() === '%PDF-';
      if (expectPdf && !isPdf) throw new Error(`expected PDF, got ${ct} (${buf.length} bytes) — blocked page or soft 404?`);
      const ext = isPdf ? '.pdf' : ct.includes('html') ? '.html' : ct === 'image/jpeg' ? '.jpg' : ct === 'image/png' ? '.png' : '.bin';
      const safe = (src.variant ? `${src.field}-${src.variant}` : src.field).replace(/[^a-zA-Z0-9._-]/g, '_');
      const rel = path.posix.join('corpus', 'archive', doc.id, `${safe}${ext}`);
      await fs.mkdir(path.join(archive, doc.id), { recursive: true });
      await fs.writeFile(path.join(ROOT, rel), buf);
      const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
      const prev = prevByKey.get(`${doc.id}|${src.field}|${src.variant ?? ''}`);
      const same = prev && prev.sha256 === sha256;
      if (prev && !same) changed.push(`${doc.id} ${src.field} ${src.variant ?? ''}`);
      artifacts.push({
        document_id: doc.id, source_field: src.field, variant: src.variant, source_url: src.url,
        local_path: rel, sha256, retrieved_at: same ? prev.retrieved_at : new Date().toISOString(),
        bytes: buf.length, content_type: isPdf ? 'application/pdf' : ct, http_status: r.status,
        ingest_field: src.ingestField && doc.ingest !== false,
        // Approval survives re-download only if bytes are unchanged.
        verified_for_ingest: same ? !!prev.verified_for_ingest : false,
        verified_by: same ? prev.verified_by ?? null : null,
        verified_at: same ? prev.verified_at ?? null : null,
      });
      console.log(same ? 'SAME' : 'OK  ', doc.id, src.field, src.variant ?? '', buf.length, ct);
    } catch (e) {
      failures.push({ document_id: doc.id, source_field: src.field, variant: src.variant, source_url: src.url, error: String(e) });
      console.error('FAIL', doc.id, src.url, String(e));
    }
    await sleep(750); // be polite to gppb.gov.ph
  }
}

await fs.writeFile(LOCK, JSON.stringify({ corpus_version: manifest.corpus_version, generated_at: new Date().toISOString(), artifacts, failures }, null, 2) + '\n');
if (changed.length) console.warn(`\n${changed.length} artifact(s) CHANGED since last lock — approvals reset, bump corpus_version:\n  ${changed.join('\n  ')}`);
if (failures.length) { console.error(`\n${failures.length} download(s) failed. Review manifest.lock.json.`); process.exitCode = 2; }
