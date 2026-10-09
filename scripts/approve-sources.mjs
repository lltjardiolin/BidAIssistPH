// Maintainer-only. Marks archived artifacts as human-verified for ingest.
// Usage: node scripts/approve-sources.mjs --by "J. Name" DOC_ID [DOC_ID ...]
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOCK = path.join(ROOT, 'corpus', 'manifest.lock.json');
const args = process.argv.slice(2);
const byIdx = args.indexOf('--by');
if (byIdx < 0 || !args[byIdx + 1]) { console.error('Required: --by "<reviewer name>"'); process.exit(1); }
const by = args[byIdx + 1];
const ids = args.filter((_, i) => i !== byIdx && i !== byIdx + 1);
if (!ids.length) { console.error('List at least one document id.'); process.exit(1); }
const manifest = JSON.parse(await fs.readFile(path.join(ROOT, 'corpus', 'manifest.json'), 'utf8'));
const docs = new Map(manifest.documents.map(d => [d.id, d]));
const lock = JSON.parse(await fs.readFile(LOCK, 'utf8'));
for (const id of ids) {
  const d = docs.get(id);
  if (!d) { console.error(`Unknown id ${id}`); process.exitCode = 1; continue; }
  if (d.ingest === false) { console.error(`${id} is ingest:false (${d.ingest_blocker}). Fix the manifest first.`); process.exitCode = 1; continue; }
  const arts = lock.artifacts.filter(a => a.document_id === id && a.ingest_field);
  if (!arts.length) { console.error(`${id}: no ingestible archived artifacts`); process.exitCode = 1; continue; }
  for (const a of arts) { a.verified_for_ingest = true; a.verified_by = by; a.verified_at = new Date().toISOString(); }
  console.log(`Approved ${id} (${arts.length} artifact(s))`);
}
await fs.writeFile(LOCK, JSON.stringify(lock, null, 2) + '\n');
