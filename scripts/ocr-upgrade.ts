// Maintainer-only. Re-reads the weak pages of v1 (200 dpi) extractions with the current OCR settings and writes a
// v2 cache entry when any page improved. The v1 file is left as it was. Weak = an OCR page under CLEAN_RETRY_BELOW,
// or a letter-spaced text layer. Each page keeps whichever reading scores higher. Changed document ids are appended
// to storage/logs/ocr-upgrade-changed.txt so only those need `corpus:ingest -- --only ...`.
//
// Usage: npx tsx scripts/ocr-upgrade.ts --shard 0/3      (run 0/3, 1/3 and 2/3 side by side)
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  CLEAN_RETRY_BELOW, closeExtractors, isLetterSpaced, ocrPage, readCachedExtraction, recognizeBest, writeCachedExtraction,
  type Extracted,
} from '../ingestion/extract';

type Artifact = { document_id: string; local_path: string; sha256: string; content_type: string; ingest_field: boolean };

const ROOT = path.resolve(import.meta.dirname, '..');
const arg = process.argv[process.argv.indexOf('--shard') + 1] ?? '0/1';
const [index, count] = arg.split('/').map(Number);
const cacheDir = path.join(ROOT, 'storage', 'processed');
const tessCache = path.join(cacheDir, 'tessdata');
const changedLog = path.join(ROOT, 'storage', 'logs', 'ocr-upgrade-changed.txt');
const lock = JSON.parse(await fs.readFile(path.join(ROOT, 'corpus', 'manifest.lock.json'), 'utf8')) as { artifacts: Artifact[] };

const cached = new Set(await fs.readdir(cacheDir).catch(() => [] as string[]));
const isWeak = (p: Extracted['pages'][number]) => p.ocr ? (p.confidence ?? 100) < CLEAN_RETRY_BELOW : isLetterSpaced(p.text);

const todo: Array<{ a: Artifact; ex: Extracted }> = [];
for (const a of lock.artifacts) {
  if (!a.ingest_field || cached.has(`${a.sha256}.v2.json`) || !cached.has(`${a.sha256}.v1.json`)) continue;
  if (a.content_type !== 'application/pdf' && !a.content_type.startsWith('image/')) continue;
  const ex = await readCachedExtraction(cacheDir, a.sha256);
  if (ex?.pages.some(isWeak)) todo.push({ a, ex });
}
const mine = todo.sort((x, y) => x.a.sha256.localeCompare(y.a.sha256)).filter((_, i) => i % count === index);
console.log(`shard ${index}/${count}: ${mine.length} of ${todo.length} artifacts with weak pages`);

const started = Date.now();
let reread = 0, improved = 0, files = 0;
try {
  for (const [i, { a, ex }] of mine.entries()) {
    try {
      const file = path.join(ROOT, a.local_path);
      let changed = false;
      const pages = [];
      for (const p of ex.pages) {
        if (!isWeak(p)) { pages.push(p); continue; }
        reread++;
        const o = a.content_type === 'application/pdf' ? await ocrPage(file, p.page ?? 1, tessCache) : await recognizeBest(file, tessCache);
        const better = p.ocr ? o.confidence > (p.confidence ?? 0) : o.text.trim().length >= 120;
        if (better) { pages.push({ page: p.page, text: o.text, ocr: true, confidence: o.confidence }); changed = true; improved++; }
        else pages.push(p);
      }
      if (changed) {
        const ocrPages = pages.filter(p => p.ocr).length;
        const method = a.content_type === 'application/pdf'
          ? (ocrPages === 0 ? 'pdf-text' : ocrPages === pages.length ? 'pdf-ocr' : 'pdf-mixed') : ex.method;
        await writeCachedExtraction(cacheDir, a.sha256, { pages, method, ocrPages });
        await fs.appendFile(changedLog, `${a.document_id}\n`);
        files++;
      }
    } catch (e) {
      console.error(`FAIL ${a.document_id} ${a.local_path}: ${String(e)}`);
    }
    if ((i + 1) % 10 === 0 || i + 1 === mine.length) {
      const min = (Date.now() - started) / 60000;
      console.log(`shard ${index}: ${i + 1}/${mine.length} files, ${reread} pages re-read, ${improved} improved, ${files} files changed, ${min.toFixed(1)} min, ~${Math.ceil(min / (i + 1) * (mine.length - i - 1))} min left`);
    }
  }
} finally {
  await closeExtractors();
}
