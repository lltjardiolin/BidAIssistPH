// Maintainer-only. Fills the extraction cache (storage/processed) ahead of corpus:ingest so OCR can run in
// several processes at once; ingest then reads the cached text. Each process takes every Nth artifact.
//
// Usage: npx tsx scripts/ocr-warm.ts --shard 0/3      (run 0/3, 1/3 and 2/3 side by side)
import fs from 'node:fs/promises';
import path from 'node:path';
import { closeExtractors, extractArtifact } from '../ingestion/extract';

type Artifact = { document_id: string; local_path: string; sha256: string; content_type: string; ingest_field: boolean };

const ROOT = path.resolve(import.meta.dirname, '..');
const arg = process.argv[process.argv.indexOf('--shard') + 1] ?? '0/1';
const [index, count] = arg.split('/').map(Number);
const cacheDir = path.join(ROOT, 'storage', 'processed');
const lock = JSON.parse(await fs.readFile(path.join(ROOT, 'corpus', 'manifest.lock.json'), 'utf8')) as { artifacts: Artifact[] };

const cached = new Set(await fs.readdir(cacheDir).catch(() => [] as string[]));
const todo = lock.artifacts
  .filter(a => a.ingest_field && !cached.has(`${a.sha256}.v1.json`))
  .sort((a, b) => a.sha256.localeCompare(b.sha256))
  .filter((_, i) => i % count === index);

console.log(`shard ${index}/${count}: ${todo.length} artifacts to extract`);
const started = Date.now();
let pages = 0, ocr = 0;
try {
  for (const [i, a] of todo.entries()) {
    try {
      const ex = await extractArtifact(path.join(ROOT, a.local_path), { contentType: a.content_type, sha256: a.sha256, cacheDir });
      pages += ex.pages.length; ocr += ex.ocrPages;
    } catch (e) {
      console.error(`FAIL ${a.document_id} ${a.local_path}: ${String(e)}`);
    }
    if ((i + 1) % 20 === 0 || i + 1 === todo.length) {
      const min = (Date.now() - started) / 60000;
      console.log(`shard ${index}: ${i + 1}/${todo.length} files, ${pages} pages (${ocr} OCR), ${min.toFixed(1)} min, ~${Math.ceil(min / (i + 1) * (todo.length - i - 1))} min left`);
    }
  }
} finally {
  await closeExtractors();
}
