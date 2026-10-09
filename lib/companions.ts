// Companion expansion (PDR B4.5). Companions deliberately cross the scope filter: a withdrawn edition is
// only meaningful next to the record that withdrew it, and a comparison needs both frameworks.
import { query, toVector } from './db';
import { docsById, manifest } from './manifest';
import type { ScopeKey } from './scopes';
import type { ChunkRow } from './types';

export type Expanded = { row: ChunkRow; companion: boolean };

const COLS = `id, document_id, context_header, text, page, section, heading, framework, status, authority_level,
  doc_type, reference_tokens, null::int vec_rank, null::int lex_rank, 0::float score`;

async function bestChunk(documentId: string, emb: number[]): Promise<ChunkRow | null> {
  const { rows } = await query<ChunkRow>(
    `select ${COLS} from chunks where document_id = $1 order by embedding <=> $2::vector limit 1`,
    [documentId, toVector(emb)]);
  return rows[0] ?? null;
}

/** Documents whose `counterpart` points at this one (e.g. Res. 12-2026 ← Res. 27-2019). */
const reverseCounterparts = new Map<string, string[]>();
for (const d of manifest.documents) if (d.counterpart) {
  reverseCounterparts.set(d.counterpart, [...(reverseCounterparts.get(d.counterpart) ?? []), d.id]);
}

export async function expandCompanions(
  ranked: ChunkRow[],
  opts: { emb: number[]; compare: boolean; namedIds: string[]; scope: ScopeKey; max: number },
): Promise<Expanded[]> {
  const out: Expanded[] = ranked.map(row => ({ row, companion: false }));
  const present = () => new Set(out.map(e => e.row.document_id));
  const add = async (docId: string | null | undefined) => {
    if (!docId || out.length >= opts.max || present().has(docId)) return;
    const d = docsById.get(docId);
    if (!d || d.ingest === false) return;
    const row = await bestChunk(docId, opts.emb);
    if (row) out.push({ row, companion: true });
  };

  // A withdrawn edition named explicitly ("the March 2026 IRR") is surfaced with its withdrawal record,
  // even in tabs that exclude it from ranking — the answer is about its status, not its content.
  // Only in tabs that cover the IRR and GPPB issuances; other tabs stay strictly within their own documents.
  if (['all', 'ngpa', 'issuances'].includes(opts.scope)) {
    for (const id of opts.namedIds) {
      const d = docsById.get(id);
      if (d && d.index_default === false && !present().has(id)) {
        const row = await bestChunk(id, opts.emb);
        if (!row) continue;
        // The edition and the record that withdrew it always fit, whatever the evidence budget: the
        // lowest-ranked passages give way.
        const replacement = d.withdrawn_by ?? d.superseded_by;
        const needed = 1 + (replacement && !present().has(replacement) ? 1 : 0);
        if (out.length + needed > opts.max) out.splice(Math.max(0, opts.max - needed));
        out.splice(0, 0, { row, companion: true });
        await add(replacement);
      }
    }
  }

  for (const { row } of [...out]) {
    const d = docsById.get(row.document_id);
    if (!d) continue;
    if (row.status === 'WITHDRAWN') await add(d.withdrawn_by);
    if (row.status === 'SUPERSEDED') await add(d.superseded_by);
    if (opts.compare) {
      await add(d.counterpart);
      for (const id of reverseCounterparts.get(d.id) ?? []) await add(id);
    }
  }
  if (opts.compare) {
    // Comparisons: every document the user named must be on the table…
    for (const id of opts.namedIds) await add(id);
    // …and, in the full corpus, both frameworks must be represented even when a named statute has no
    // indexed copy yet. Narrow tabs stay narrow: a tab is a promise about what gets searched.
    for (const fw of opts.scope === 'all' ? (['RA12009', 'RA9184'] as const) : []) {
      if (out.some(e => e.row.framework === fw)) continue;
      out.splice(opts.max - 2);   // make room for two blocks of the missing framework
      const { rows } = await query<ChunkRow>(
        `select ${COLS} from chunks where framework = $1 and index_default = true and authority_level <= 3
         order by embedding <=> $2::vector limit 2`, [fw, toVector(opts.emb)]);
      for (const row of rows) if (out.length < opts.max) out.push({ row, companion: true });
    }
  }
  return out.slice(0, opts.max);
}
