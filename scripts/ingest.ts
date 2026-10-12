// Maintainer-only. archive → extract → normalize → sectionize → chunk → reference tokens → embed → upsert.
// Reads ONLY locked local artifacts (corpus/manifest.lock.json); never touches the network for sources.
//
// Usage: npm run corpus:ingest                          approved artifacts only (production rule)
//        npm run corpus:ingest -- --allow-unapproved    development: also ingest unapproved artifacts
//        npm run corpus:ingest -- --only ID [ID ...]    re-ingest selected documents
//        npm run corpus:ingest -- --dry-run             extract + chunk, no embeddings, no DB writes
//        npm run corpus:ingest -- --resume              skip documents whose chunks are already indexed unchanged
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { extractTokens } from '../lib/aliases';
import { getPool, toVector } from '../lib/db';
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL, embedDocuments } from '../lib/embeddings';
import { manifest, shortRef } from '../lib/manifest';
import type { ManifestDoc } from '../lib/types';
import { chunkOptionsFromEnv, chunkSections } from '../ingestion/chunk';
import { closeExtractors, extractArtifact } from '../ingestion/extract';
import { normalize } from '../ingestion/normalize';
import { sectionize } from '../ingestion/sectionize';

type Artifact = {
  document_id: string; source_field: string; variant: string | null; source_url: string; local_path: string;
  sha256: string; retrieved_at: string; bytes: number; content_type: string; ingest_field: boolean;
  verified_for_ingest: boolean;
};

const ROOT = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const ALLOW_UNAPPROVED = args.includes('--allow-unapproved');
const DRY = args.includes('--dry-run');
const RESUME = args.includes('--resume');
const onlyIdx = args.indexOf('--only');
const ONLY = onlyIdx >= 0 ? new Set(args.slice(onlyIdx + 1).filter(a => !a.startsWith('--'))) : null;

const lockPath = path.join(ROOT, 'corpus', 'manifest.lock.json');
const lockRaw = await fs.readFile(lockPath, 'utf8');
const lock = JSON.parse(lockRaw) as { corpus_version: string; artifacts: Artifact[] };
if (lock.corpus_version !== manifest.corpus_version)
  throw new Error(`lock corpus_version ${lock.corpus_version} ≠ manifest ${manifest.corpus_version}; run npm run corpus:download`);

const isoDate = (v?: string | null) => /^\d{4}-\d{2}-\d{2}/.exec(v ?? '')?.[0] ?? null;
const GPM_VOLUMES = ['Volume 1', 'Volume 2', 'Volume 3', 'Volume 4', 'LGU Manual'];

/** Names the artifact inside a multi-file document, e.g. the circular annexed to a resolution. */
function artifactLabel(d: ManifestDoc, a: Artifact): { label: string | null; docType: string } {
  const type = d.type;
  if (a.source_field === 'circular_urls' && a.variant) return { label: `Circular No. ${a.variant}`, docType: 'circular' };
  if (a.source_field === 'circular_url') {
    const circ = /Circular No\. \d{2}-\d{4}/.exec(d.reference)?.[0] ?? d.aliases.find(x => /^Circular No\./.test(x)) ?? 'Annex';
    return { label: circ, docType: 'circular' };
  }
  if (a.source_field === 'annex_urls') return { label: `Annex ${Number(a.variant) + 1}`, docType: type };
  if (a.source_field === 'volume_urls') return { label: GPM_VOLUMES[Number(a.variant)] ?? `Volume ${Number(a.variant) + 1}`, docType: type };
  return { label: null, docType: type };
}

const chunkOpts = chunkOptionsFromEnv();
/** OCR pages below this Tesseract confidence are photos, stamps or scanned attachments that read as noise. */
const MIN_OCR_CONFIDENCE = Number(process.env.MIN_OCR_CONFIDENCE || 50);
let noisyPages = 0;
const cacheDir = path.join(ROOT, 'storage', 'processed');
const report: Array<{ id: string; artifacts: number; pages: number; ocrPages: number; chunks: number; skipped?: string }> = [];
const pool = DRY ? null : getPool();
type Row = { id: string; versionKey: string; header: string; text: string; page: number | null; section: string | null;
  heading: string | null; docType: string; tokens: string[] };
const plans: Array<{ d: ManifestDoc; arts: Artifact[]; rows: Row[] }> = [];

try {
  if (pool) {
    // Documents first, in ONE transaction: self-references are deferred, so manifest order does not matter.
    const c = await pool.connect();
    try {
      await c.query('begin');
      for (const d of manifest.documents) {
        await c.query(
          `insert into documents (id, reference, title, doc_type, framework, status, authority_level, issuing_body,
             date_approved, date_published, date_filed, effective_date, withdrawn_date, expires_at,
             withdrawn_by, superseded_by, counterpart, parent_id, index_default, ingest, source_url, verification)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
           on conflict (id) do update set reference=excluded.reference, title=excluded.title, doc_type=excluded.doc_type,
             framework=excluded.framework, status=excluded.status, authority_level=excluded.authority_level,
             issuing_body=excluded.issuing_body, date_approved=excluded.date_approved, date_published=excluded.date_published,
             date_filed=excluded.date_filed, effective_date=excluded.effective_date, withdrawn_date=excluded.withdrawn_date,
             expires_at=excluded.expires_at, withdrawn_by=excluded.withdrawn_by, superseded_by=excluded.superseded_by,
             counterpart=excluded.counterpart, parent_id=excluded.parent_id, index_default=excluded.index_default,
             ingest=excluded.ingest, source_url=excluded.source_url, verification=excluded.verification`,
          [d.id, d.reference, d.reference.split(' — ')[1] ?? d.reference, d.type, d.framework, d.status, d.authority_level,
            d.issuing_body, isoDate(d.date_approved), isoDate(d.date_published), isoDate(d.date_filed), isoDate(d.effective_date),
            isoDate(d.withdrawn_date), isoDate(d.expires_at), d.withdrawn_by ?? null, d.superseded_by ?? null,
            d.counterpart ?? null, d.parent_id ?? null, d.index_default !== false, d.ingest !== false, d.source_url ?? null,
            d.verification ?? null]);
        for (const alias of d.aliases ?? [])
          await c.query(
            `insert into document_aliases (alias, document_id) values ($1,$2) on conflict (alias) do update set document_id = excluded.document_id`,
            [alias, d.id]);
      }
      await c.query('commit');
    } catch (e) { await c.query('rollback'); throw e; } finally { c.release(); }
  }

  for (const d of manifest.documents) {
    if (ONLY && !ONLY.has(d.id)) continue;
    if (d.ingest === false) { report.push({ id: d.id, artifacts: 0, pages: 0, ocrPages: 0, chunks: 0, skipped: `ingest:false — ${d.ingest_blocker}` }); continue; }
    const all = lock.artifacts.filter(a => a.document_id === d.id && a.ingest_field);
    const arts = all.filter(a => a.verified_for_ingest || ALLOW_UNAPPROVED);
    if (!arts.length) {
      report.push({ id: d.id, artifacts: 0, pages: 0, ocrPages: 0, chunks: 0,
        skipped: all.length ? 'not approved — run corpus:approve after checking the file' : 'no archived artifact' });
      continue;
    }

    const rows: Row[] = [];
    let pages = 0, ocrPages = 0;
    for (const a of arts) {
      const ex = await extractArtifact(path.join(ROOT, a.local_path), { contentType: a.content_type, sha256: a.sha256, cacheDir });
      pages += ex.pages.length; ocrPages += ex.ocrPages;
      const readable = ex.pages.filter(p => !(p.ocr && (p.confidence ?? 100) < MIN_OCR_CONFIDENCE));
      noisyPages += ex.pages.length - readable.length;
      const { label, docType } = artifactLabel(d, a);
      const chunks = chunkSections(sectionize(normalize(readable)), chunkOpts);
      const key = a.variant ? `${a.source_field}-${a.variant}` : a.source_field;
      chunks.forEach((ch, i) => {
        const header = [shortRef(d), label, ...ch.path].filter(Boolean).join(' › ') + (ch.parts > 1 ? ` (part ${ch.part}/${ch.parts})` : '');
        rows.push({
          id: `${d.id}:${key}:${String(i + 1).padStart(4, '0')}`, versionKey: a.sha256, header, text: ch.text, page: ch.page,
          section: ch.section, heading: ch.heading ?? label, docType,
          // Identity tokens of the document itself plus every identifier cited in the text.
          tokens: [...new Set([...extractTokens([d.reference, ...(d.aliases ?? [])].join(' ; ')), ...extractTokens(`${header}\n${ch.text}`)])],
        });
      });
    }
    report.push({ id: d.id, artifacts: arts.length, pages, ocrPages, chunks: rows.length });
    console.log(`${d.id.padEnd(36)} ${String(arts.length).padStart(2)} file(s) ${String(pages).padStart(4)} p ${String(ocrPages).padStart(3)} ocr → ${rows.length} chunks`);
    plans.push({ d, arts, rows });
  }

  // Smallest documents first: the index becomes usable early and a failure costs little.
  plans.sort((x, y) => x.rows.length - y.rows.length);
  const totalChunks = plans.reduce((n, p) => n + p.rows.length, 0);
  const started = Date.now();
  let done = 0;
  for (const { d, arts, rows } of pool ? plans : []) {
    if (RESUME) {
      // Unchanged chunk ids and text → the stored embeddings are still valid.
      const { rows: have } = await pool!.query<{ id: string; h: string }>('select id, md5(text) h from chunks where document_id = $1', [d.id]);
      const stored = new Map(have.map(r => [r.id, r.h]));
      if (have.length === rows.length && rows.every(r => stored.get(r.id) === crypto.createHash('md5').update(r.text).digest('hex'))) {
        done += rows.length;
        console.log(`unchanged ${d.id} (${rows.length} chunks)`);
        continue;
      }
    }
    const embeddings: number[][] = [];
    for (let i = 0; i < rows.length; i += 16) {
      embeddings.push(...await embedDocuments(rows.slice(i, i + 16).map(r => `${r.header}\n${r.text}`)));
      const n = done + embeddings.length;
      const rate = n / ((Date.now() - started) / 1000);
      console.log(`embedded ${n}/${totalChunks} (${rate.toFixed(1)}/s, ~${Math.ceil((totalChunks - n) / rate / 60)} min left) ${d.id}`);
    }
    done += rows.length;

    const c = await pool!.connect();
    try {
      await c.query('begin');
      await c.query('delete from chunks where document_id = $1', [d.id]);
      const versionIds = new Map<string, number>();
      for (const a of arts) {
        const { rows: v } = await c.query<{ id: number }>(
          `insert into document_versions (document_id, source_url, local_path, sha256, retrieved_at, content_type, bytes, verified_for_ingest)
           values ($1,$2,$3,$4,$5,$6,$7,$8)
           on conflict (document_id, sha256) do update set verified_for_ingest = excluded.verified_for_ingest, local_path = excluded.local_path
           returning id`,
          [d.id, a.source_url, a.local_path, a.sha256, a.retrieved_at, a.content_type, a.bytes, a.verified_for_ingest]);
        versionIds.set(a.sha256, v[0].id);
      }
      for (const [i, r] of rows.entries())
        await c.query(
          `insert into chunks (id, document_id, document_version_id, context_header, text, page, section, heading,
             framework, status, authority_level, doc_type, index_default, reference_tokens, embedding)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::vector)`,
          [r.id, d.id, versionIds.get(r.versionKey), r.header, r.text, r.page, r.section, r.heading, d.framework, d.status,
            d.authority_level, r.docType, d.index_default !== false, r.tokens, toVector(embeddings[i])]);
      await c.query('commit');
    } catch (e) { await c.query('rollback'); throw e; } finally { c.release(); }
  }

  if (pool) {
    // Chunks of documents that are no longer ingestible must leave the index.
    const gone = manifest.documents.filter(d => d.ingest === false).map(d => d.id);
    await pool.query('delete from chunks where document_id = any($1::text[])', [gone]);
    await pool.query(
      `insert into corpus_releases (corpus_version, embedding_model, embedding_dimensions, lock_sha256) values ($1,$2,$3,$4)
       on conflict (corpus_version) do update set embedding_model = excluded.embedding_model,
         embedding_dimensions = excluded.embedding_dimensions, lock_sha256 = excluded.lock_sha256, created_at = now()`,
      [manifest.corpus_version, EMBEDDING_MODEL, EMBEDDING_DIMENSIONS, crypto.createHash('sha256').update(lockRaw).digest('hex')]);
    await pool.query('create index if not exists chunks_embedding_hnsw on chunks using hnsw (embedding vector_cosine_ops)');
    await pool.query('analyze chunks');
  }

  const total = report.reduce((n, r) => n + r.chunks, 0);
  const ingested = report.filter(r => r.chunks > 0);
  const notes = [
    '# Ingestion notes', '',
    `- Corpus version: ${manifest.corpus_version}`,
    `- Generated: ${new Date().toISOString()}${DRY ? ' (dry run — nothing written to the index)' : ''}`,
    `- Embedding: ${EMBEDDING_MODEL} (${EMBEDDING_DIMENSIONS} dimensions)`,
    `- OCR pages skipped as unreadable (confidence < ${MIN_OCR_CONFIDENCE}): ${noisyPages}`,
    `- Chunking: ${chunkOpts.mode}, max ${chunkOpts.maxTokens} tokens, overlap ${chunkOpts.overlapTokens}`,
    `- Approval gate: ${ALLOW_UNAPPROVED ? '**BYPASSED (--allow-unapproved) — development index, not a release**' : 'enforced (approved artifacts only)'}`,
    `- Documents indexed: ${ingested.length} of ${manifest.documents.length} manifest entries · ${total} chunks`, '',
    '| Document | Files | Pages | OCR pages | Chunks | Note |', '|---|---:|---:|---:|---:|---|',
    ...report.map(r => `| ${r.id} | ${r.artifacts} | ${r.pages} | ${r.ocrPages} | ${r.chunks} | ${r.skipped ?? ''} |`), '',
  ].join('\n');
  if (!ONLY) await fs.writeFile(path.join(ROOT, 'corpus', 'INGESTION_NOTES.md'), notes);
  console.log(`\n${ingested.length} documents, ${total} chunks${DRY ? ' (dry run)' : ''}.`);
  const skipped = report.filter(r => r.skipped);
  if (skipped.length) console.warn(`Skipped ${skipped.length}:\n  ` + skipped.map(r => `${r.id}: ${r.skipped}`).join('\n  '));
} finally {
  await closeExtractors();
  await pool?.end();
}
