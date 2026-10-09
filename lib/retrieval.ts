// retrieveEvidence (PDR B4 / D4): exact identifiers + lexical + vector → RRF → deterministic rerank →
// companion expansion → evidence policy gate. Network-closed: reads only the local index (B5.6).
import { normalizeAliases, type NormalizedQuery } from './aliases';
import { expandCompanions } from './companions';
import { query, toVector } from './db';
import { embedQuery } from './embeddings';
import { ABSTAIN_MESSAGE, applyEvidencePolicy } from './evidence-policy';
import { CORPUS_VERSION, dateLabel, docsById, versionNote } from './manifest';
import { SCOPES, scopeFilter, type ScopeKey } from './scopes';
import type { ChunkRow, Evidence, RetrievalResult } from './types';

export const CANDIDATES = 20;
// Evidence budget. The defaults suit a hosted model; a CPU-only local model reads a few hundred tokens per
// second, so every block costs seconds. Tune with EVIDENCE_TOP_K / EVIDENCE_MAX / EVIDENCE_MAX_CHARS.
export const TOP_K = Number(process.env.EVIDENCE_TOP_K || 6);
export const MAX_EVIDENCE = Math.max(TOP_K, Number(process.env.EVIDENCE_MAX || 8));
/** Longest passage shown to the model per block; 0 = the whole chunk. The UI always shows the whole chunk. */
export const MAX_PASSAGE_CHARS = Number(process.env.EVIDENCE_MAX_CHARS || 0);
const PER_DOC_CAP = 3;
const HISTORICAL_CANDIDATES = 8;
const HISTORICAL_CAP = 2;

/** Retrieval configuration. Production is always D; A–C exist only for the evaluation experiments (PDR E5). */
export type RetrievalConfig = { mode: 'vector' | 'hybrid'; rerank: boolean; companions: boolean; topK: number };
export const EXPERIMENTS: Record<string, RetrievalConfig> = {
  A: { mode: 'vector', rerank: false, companions: false, topK: 5 },   // + fixed chunks 600/100 at ingest
  B: { mode: 'vector', rerank: false, companions: false, topK: 5 },   // + fixed chunks 900/150 at ingest
  C: { mode: 'hybrid', rerank: false, companions: false, topK: 8 },
  D: { mode: 'hybrid', rerank: true, companions: true, topK: TOP_K },
};
export const retrievalConfig = (): RetrievalConfig => EXPERIMENTS[(process.env.EXP ?? 'D').toUpperCase()] ?? EXPERIMENTS.D;

// English + common Filipino/Taglish function words. The 'simple' text config has no stopword list,
// so without this an OR query would rank chunks by how often they say "the" or "ang".
const STOPWORDS = new Set((
  'a an the of to in on for and or but is are was were be been being do does did have has had i we you they it ' +
  'this that these those what which who whom when where why how can could should would will shall may might must ' +
  'there their our your my me us about with from by at as into than then so if not no yes any all some still ' +
  'already under over before after between tell please need needed use used using ' +
  'ang ng mga sa na ba po ko ako namin natin kami tayo ano paano kailan saan sino bakit ito iyan iyon yung yun ' +
  'at o pa lang din rin kung may meron wala para pag nang dapat pwede puwede'
).split(/\s+/));

export function lexicalText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}.\-\s]/gu, ' ')
    .split(/\s+/)
    .filter(w => w && !STOPWORDS.has(w) && !/^[.\-]+$/.test(w))
    .join(' ');
}

// The documents are in English. Filipino/Taglish questions get the English term appended so that both the
// lexical index and the embedding can match them. Deterministic, no translation service involved.
const GLOSSARY: Record<string, string> = {
  dokumento: 'documents documentary requirements', kailangan: 'required requirements', kinakailangan: 'required requirements',
  batas: 'law act', panukala: 'bill proposed', panukalang: 'bill proposed', patakaran: 'rules policy', alituntunin: 'guidelines rules',
  tuntunin: 'rules', parusa: 'penalty penalties', multa: 'fine penalty', bisa: 'effectivity effective', epektibo: 'effective effectivity',
  binawi: 'withdrawn', pinawalang: 'repealed withdrawn', pinalitan: 'superseded replaced', kasalukuyan: 'current',
  dati: 'previous historical', dating: 'previous historical', lumang: 'old previous', bago: 'new', bagong: 'new',
  paraan: 'mode method', pamamaraan: 'mode method procedure', pagbili: 'procurement purchase', pagkuha: 'procurement',
  kontrata: 'contract', tagapagtustos: 'supplier', bidder: 'bidder', kwalipikasyon: 'eligibility qualification',
  kalamidad: 'disaster calamity emergency', sakuna: 'disaster emergency', halalan: 'election', eleksyon: 'election',
  pinagkaiba: 'difference changes compare', pagkakaiba: 'difference changes compare', nagbago: 'changed changes',
  kailan: 'when date', sino: 'who', magkano: 'amount threshold', ilang: 'number how many', kopya: 'copies',
};

// Everyday words → the terms the issuances actually use.
const THESAURUS: Array<[RegExp, string]> = [
  [/\b(documents?|paperwork|papers)\b/i, 'documentary requirements'],
  [/\b(emergency|calamity|typhoon)\b/i, 'disaster'],
  [/\bstill (valid|use|used|apply|applies|in force)\b/i, 'withdrawn'],
  [/\b(forms?|templates?)\b/i, 'standard forms'],
  // "the current procurement framework / law" is the Act itself, not a Framework Agreement.
  [/\b(current|present|new|existing)\s+(government\s+)?(procurement\s+)?(framework|law|act|statute)\b/i, 'New Government Procurement Act RA 12009'],
];

export function expandQuery(text: string): string {
  const added = new Set<string>();
  for (const w of text.toLowerCase().split(/[^\p{L}]+/u)) if (GLOSSARY[w]) added.add(GLOSSARY[w]);
  for (const [re, term] of THESAURUS) if (re.test(text) && !text.toLowerCase().includes(term)) added.add(term);
  return added.size ? `${text} (${[...added].join(' ')})` : text;
}

const stem = (w: string) => w.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 6);
/** Share of the query's content words that appear in the chunk's document title and section header. */
export function titleOverlap(queryText: string, header: string): number {
  const q = [...new Set(lexicalText(queryText).split(' ').map(stem).filter(w => w.length >= 4))];
  if (!q.length) return 0;
  const h = new Set(header.split(/[^A-Za-z0-9]+/).map(stem).filter(w => w.length >= 4));
  return q.filter(w => h.has(w)).length / q.length;
}

const HISTORICAL_INTENT = /\b(9184|before|previous|prior|old|former|historical|dati|noon|2016)\b/i;
const COMPARE_INTENT = /\b(compare|comparison|changed?|changes|difference|differ|versus|vs\.?|pinagkaiba)\b/i;

export async function hybridQuery(
  emb: number[], norm: NormalizedQuery, scope: ScopeKey, limit = CANDIDATES,
  mode: RetrievalConfig['mode'] = 'hybrid', pool?: { statuses: string[]; exclude?: boolean },
): Promise<ChunkRow[]> {
  // Vector-only mode (experiments A/B): no lexical terms, no identifier lookups.
  if (mode === 'vector') norm = { ...norm, text: '', ids: [], tokens: [] };
  const f = scopeFilter(scope, 5);
  if (pool) {
    f.params.push(pool.statuses);
    f.sql += ` and ${pool.exclude ? 'not ' : ''}c.status = any($${4 + f.params.length}::text[])`;
  }
  const sql = `
    with q as (
      select to_tsquery('simple', coalesce(nullif(array_to_string(array(
        select quote_literal(l) from unnest(tsvector_to_array(to_tsvector('simple', $2))) l), ' | '), ''), 'zzzznomatch')) q
    ), vec as (
      select c.id, row_number() over (order by c.embedding <=> $1::vector) r
      from chunks c where ${f.sql} and c.embedding is not null
      order by c.embedding <=> $1::vector limit 40
    ), lex as (
      select c.id, row_number() over (order by ts_rank_cd(c.tsv, q.q) desc) r
      from chunks c, q where c.tsv @@ q.q and ${f.sql}
      order by ts_rank_cd(c.tsv, q.q) desc limit 40
    ), ids as (
      select c.id, row_number() over (order by c.embedding <=> $1::vector) r
      from chunks c where c.document_id = any($3::text[]) and ${f.sql}
      order by c.embedding <=> $1::vector limit 10
    ), u as (select id from vec union select id from lex union select id from ids)
    select c.id, c.document_id, c.context_header, c.text, c.page, c.section, c.heading, c.framework, c.status,
      c.authority_level, c.doc_type, c.reference_tokens, vec.r::int vec_rank, lex.r::int lex_rank,
      coalesce(1.0/(60+vec.r),0) + coalesce(1.0/(60+lex.r),0) + coalesce(1.0/(60+ids.r),0)
        + case when c.reference_tokens && $4::text[] then 0.005 else 0 end as score
    from u join chunks c on c.id = u.id
    left join vec on vec.id = c.id left join lex on lex.id = c.id left join ids on ids.id = c.id
    order by score desc limit ${Number(limit)}`;
  const { rows } = await query<ChunkRow>(sql, [toVector(emb), lexicalText(norm.text), norm.ids, norm.tokens, ...f.params]);
  return rows.map(r => ({ ...r, score: Number(r.score) }));
}

/** Deterministic rerank (B4.4): exact id → section → status fit → authority → RRF, as additive boosts. */
export function rerank(rows: ChunkRow[], opts: { ids: string[]; sections: string[]; scope: ScopeKey; query: string }): ChunkRow[] {
  const historical = opts.scope === 'ra9184' || HISTORICAL_INTENT.test(opts.query);
  const scored = rows.map(r => {
    let s = r.score;
    if (opts.ids.includes(r.document_id)) s += 0.02;
    if (opts.sections.some(t => r.reference_tokens.includes(t) || (r.section ?? '').replace(/\D/g, '') === t.slice(3))) s += 0.01;
    if (r.status === 'CURRENT') s += historical ? 0 : 0.006;
    else if (r.status === 'HISTORICAL') s += historical ? 0.004 : -0.002;
    else if (r.status === 'REFERENCE') s -= 0.002;
    if (r.authority_level <= 3) s += 0.004;
    // "Documents for negotiated procurement" should find the issuance titled "Documentary requirements…".
    s += 0.012 * titleOverlap(opts.query, `${docsById.get(r.document_id)?.reference ?? ''} ${r.context_header}`);
    // "What governed procurement before RA 12009?" is answered by the provisions that mention RA 9184.
    if (historical && r.reference_tokens.includes('RA9184')) s += 0.006;
    return { ...r, score: s };
  }).sort((a, b) => b.score - a.score);

  // Diversity + opinions cap: ≤ PER_DOC_CAP chunks per document, one per section (overlapping parts of the same
  // section repeat each other); ≤ 2 authority-4/5 chunks unless in the opinions tab.
  const out: ChunkRow[] = [];
  const perDoc = new Map<string, number>();
  const sections = new Set<string>();
  let interpretive = 0;
  let old = 0;
  for (const r of scored) {
    if ((perDoc.get(r.document_id) ?? 0) >= PER_DOC_CAP) continue;
    // A current-rule question may show the old rule for context, but not be dominated by it.
    if (r.status === 'HISTORICAL' && !historical && opts.scope === 'all' && old >= HISTORICAL_CAP) continue;
    const sectionKey = r.context_header.replace(/ \(part \d+\/\d+\)$/, '');
    if (sections.has(sectionKey)) continue;
    sections.add(sectionKey);
    if (r.authority_level >= 4 && opts.scope !== 'opinions' && interpretive >= 2) continue;
    out.push(r);
    if (r.status === 'HISTORICAL') old++;
    perDoc.set(r.document_id, (perDoc.get(r.document_id) ?? 0) + 1);
    if (r.authority_level >= 4) interpretive++;
  }
  return out;
}

export function toEvidence(r: ChunkRow, n: number, label: Evidence['label'], companion: boolean): Evidence {
  const d = docsById.get(r.document_id);
  return {
    n, id: r.id, documentId: r.document_id,
    reference: d?.reference ?? r.document_id,
    status: r.status, framework: r.framework, authority: r.authority_level, kind: r.doc_type, label,
    section: r.section ?? r.heading, page: r.page,
    issuingBody: d?.issuing_body ?? '', dateLabel: d ? dateLabel(d) : null, note: d ? versionNote(d) : null,
    sourceUrl: d?.source_url ?? null, companion, text: r.text,
  };
}

export async function retrieveEvidence({ query: q, compare, scope }: { query: string; compare?: boolean; scope: ScopeKey }): Promise<RetrievalResult> {
  const norm = normalizeAliases(expandQuery(q));
  const wantsCompare = !!compare || COMPARE_INTENT.test(q);
  const cfg = retrievalConfig();
  const emb = await embedQuery(norm.text);
  // In the full corpus the RA 9184-era manuals and IRR hold over a third of all chunks. Unless the question
  // is about the old framework, candidates are drawn from a current pool and a smaller historical pool, so
  // volume alone can never crowd current issuances out (A7: historical ranks below current).
  const historical = HISTORICAL_INTENT.test(q) || wantsCompare;
  const split = cfg.rerank && scope === 'all' && !historical;
  const candidates = split
    ? [
        ...await hybridQuery(emb, norm, scope, CANDIDATES, cfg.mode, { statuses: ['HISTORICAL'], exclude: true }),
        ...await hybridQuery(emb, norm, scope, HISTORICAL_CANDIDATES, cfg.mode, { statuses: ['HISTORICAL'] }),
      ]
    : await hybridQuery(emb, norm, scope, CANDIDATES, cfg.mode);
  const ranked = (cfg.rerank ? rerank(candidates, { ids: norm.ids, sections: norm.sections, scope, query: norm.text }) : candidates).slice(0, cfg.topK);
  // The evidence policy gate below always runs, whatever the experiment: safety is not a tunable.
  const expanded = cfg.companions
    ? await expandCompanions(ranked, { emb, compare: wantsCompare, namedIds: norm.ids, scope, max: MAX_EVIDENCE })
    : ranked.map(row => ({ row, companion: false }));

  const policy = applyEvidencePolicy(
    expanded.map(({ row }) => {
      const d = docsById.get(row.document_id);
      return { id: row.id, documentId: row.document_id, status: row.status, framework: row.framework,
        authorityLevel: row.authority_level, text: row.text, withdrawnBy: d?.withdrawn_by, supersededBy: d?.superseded_by };
    }),
    { compare: wantsCompare },
  );
  if (policy.abstain) return { abstain: true, reason: policy.reason, scope, corpusVersion: CORPUS_VERSION, flags: null, evidence: [] };

  const keep = new Set(policy.eligible.map(e => e.id));
  const evidence = expanded
    .filter(({ row }) => keep.has(row.id))
    .map(({ row, companion }, i) => toEvidence(row, i + 1, policy.labels[row.id], companion));
  return { abstain: false, reason: null, scope, corpusVersion: CORPUS_VERSION, flags: policy.flags, evidence };
}

/**
 * The part of a passage that best matches the question, cut at line boundaries. Used only to fit a small
 * model's budget: the lines kept are verbatim, and an ellipsis marks anything left out.
 */
export function focusPassage(text: string, question: string, maxChars: number): string {
  if (!maxChars || text.length <= maxChars) return text;
  const terms = new Set(lexicalText(question).split(' ').map(stem).filter(w => w.length >= 3));
  const lines = text.split('\n').flatMap(l => l.length <= maxChars ? [l] : l.match(new RegExp(`.{1,${maxChars}}(?:\\s|$)`, 'g')) ?? [l]);
  const score = (l: string) => l.split(/[^A-Za-z0-9]+/).map(stem).filter(w => terms.has(w)).length;
  let best = { start: 0, end: 0, score: -1 };
  for (let start = 0; start < lines.length; start++) {
    let size = 0, total = 0, end = start;
    while (end < lines.length && size + lines[end].length + 1 <= maxChars) { size += lines[end].length + 1; total += score(lines[end]); end++; }
    if (end > start && total > best.score) best = { start, end, score: total };
    if (end >= lines.length) break;
  }
  const body = lines.slice(best.start, best.end).join('\n');
  return `${best.start > 0 ? '… ' : ''}${body}${best.end < lines.length ? ' …' : ''}`;
}

/** Evidence blocks exactly as the model sees them (B4.6). Evidence text is data, never instructions. */
export function formatEvidenceForModel(r: RetrievalResult, question?: string): string {
  if (r.abstain) return `NO ELIGIBLE EVIDENCE (${r.reason}). Reply exactly: "I couldn't verify that from the available procurement documents."` +
    (r.scope !== 'all' ? ' Then suggest switching to the "All data" scope.' : '');
  const header = [
    `Scope: ${SCOPES[r.scope as ScopeKey]?.label ?? r.scope} · corpus ${r.corpusVersion}`,
    r.flags?.mixedFrameworks ? 'NOTE: evidence spans RA 9184 and RA 12009 — keep frameworks separate and label each.' : '',
    r.flags?.hasProposal ? 'NOTE: PROPOSAL_ONLY evidence is a bill — say "proposes"; it is not law.' : '',
    r.flags?.hasOpinion ? 'NOTE: INTERPRETIVE_ONLY evidence — write "GPPB-TSO has opined…", never "the rule is…".' : '',
    r.flags?.hasVersionEvidence ? 'NOTE: VERSION_ONLY evidence is withdrawn/superseded — never cite it as the current rule; name its replacement.' : '',
  ].filter(Boolean).join('\n');
  const blocks = r.evidence.map(e =>
    `[E${e.n}] ${e.reference} · STATUS: ${e.status} · FRAMEWORK: ${e.framework} · AUTHORITY: ${e.authority} · USE AS: ${e.label}\n` +
    `Section: ${e.section ?? '—'}${e.page ? ` · p. ${e.page}` : ''}${e.dateLabel ? ` · ${e.dateLabel}` : ''}${e.note ? `\nNote: ${e.note}` : ''}\n` +
    `<evidence>\n${focusPassage(e.text, question ?? '', MAX_PASSAGE_CHARS)}\n</evidence>`);
  // Restated after the evidence: long evidence must not push the task out of the model's attention or context.
  const task = [
    question ? `Search request: "${question}"` : '',
    `Answer the user's question using ONLY evidence blocks E1–E${r.evidence.length} above. Cite every claim as [E1], [E2], …`,
    `If they do not answer it, reply exactly: "${ABSTAIN_MESSAGE}"`,
  ].filter(Boolean).join('\n');
  return `${header}\n\n${blocks.join('\n\n')}\n\n${task}`;
}
