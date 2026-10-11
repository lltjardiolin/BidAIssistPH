// Evaluation runner (PDR Part E).
//
//   npm run eval                          score VERIFIED rows
//   npm run eval -- --include-pending     DEVELOPMENT ONLY: also run PENDING rows. Results are marked
//                                         "unverified" and must not be reported as evaluation results.
// Every run writes evaluation/results/<experiment>.json (shown on the /evaluation page). Model and judge
// calls are traced in Pydantic Logfire when OTEL_EXPORTER_OTLP_ENDPOINT is set.
//   npm run eval -- --only Q31,Q34        selected rows
//   npm run eval -- --retrieval-only      no LLM: retrieval evaluators only
//   EXP=A|B|C|D  EVAL_SCOPE=own|all|<tab>  LLM_PROVIDER=openai|mock
import fs from 'node:fs/promises';
import path from 'node:path';
import { getPool } from '../lib/db';
import { EMBEDDING_MODEL } from '../lib/embeddings';
import { CORPUS_VERSION } from '../lib/manifest';
import { LLM_PROVIDER, MODEL_ID } from '../lib/model';
import { retrieveEvidence } from '../lib/retrieval';
import { isScopeKey, type ScopeKey } from '../lib/scopes';
import { parseCsv, toEvalRow, type EvalRow } from './csv';
import { ALL_EVALUATORS, CODE_EVALUATORS, TARGETS, hitAt5, judgeConfigured, sectionHit, type Score } from './evaluators';
import { TOOL_CALL_MODE } from '../lib/chat';
import { MAX_EVIDENCE, MAX_PASSAGE_CHARS, TOP_K } from '../lib/retrieval';
import { runQuestion, type RunOutput } from './target';

const ROOT = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const flag = (f: string) => args.includes(f);
const value = (f: string) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };

const INCLUDE_PENDING = flag('--include-pending');
const RETRIEVAL_ONLY = flag('--retrieval-only');
const ONLY = value('--only')?.split(',').map(s => s.trim());
const EXP = (process.env.EXP ?? 'D').toUpperCase();
const EVAL_SCOPE = process.env.EVAL_SCOPE ?? 'own';

const all = parseCsv(await fs.readFile(path.join(ROOT, 'evaluation', 'evaluation.csv'), 'utf8')).map(toEvalRow);
const counts = Object.fromEntries(['VERIFIED', 'PENDING', 'EXCLUDED'].map(s => [s, all.filter(r => r.ground_truth_status === s).length]));
const rows = all
  .filter(r => r.ground_truth_status === 'VERIFIED' || (INCLUDE_PENDING && r.ground_truth_status === 'PENDING'))
  .filter(r => !ONLY || ONLY.includes(r.id));

console.log(`Evaluation set: ${all.length} rows — ${counts.VERIFIED} VERIFIED, ${counts.PENDING} PENDING, ${counts.EXCLUDED} EXCLUDED`);
if (!rows.length) {
  console.log(
    '\nNothing to score: only rows with ground_truth_status=VERIFIED are scored (PDR E1.1).\n' +
    'A human must check each expected answer against the archived PDF, then set verified_by, verified_at and\n' +
    'ground_truth_status=VERIFIED in evaluation/evaluation.csv.\n' +
    'To exercise the harness during development: npm run eval -- --include-pending');
  process.exit(0);
}
if (INCLUDE_PENDING) console.warn('\n*** DEVELOPMENT RUN: includes PENDING rows whose ground truth is unverified. Not reportable. ***\n');

const scopeFor = (r: EvalRow): ScopeKey => {
  const s = EVAL_SCOPE === 'own' ? r.scope : EVAL_SCOPE;
  if (!isScopeKey(s)) throw new Error(`${r.id}: invalid scope "${s}"`);
  return s;
};

async function target(row: EvalRow): Promise<RunOutput> {
  if (!RETRIEVAL_ONLY) return runQuestion(row.question, scopeFor(row));
  const started = Date.now();
  const r = await retrieveEvidence({ query: row.question, scope: scopeFor(row) });
  return {
    answer: '', scope: scopeFor(row), toolCalled: true, abstained: r.abstain,
    retrieved: r.evidence.map(({ n, documentId, status, framework, authority, label, section, companion }) =>
      ({ n, documentId, status, framework, authority, label, section, companion })),
    evidenceText: Object.fromEntries(r.evidence.map(e => [`E${e.n}`, e.text])),
    citations: { cited: [], invalid: [], claims: 0, uncited: 0, uncitedRatio: 0, partiallyVerified: false, unverified: false, abstained: r.abstain },
    guard: null,
    firstTokenMs: null, latencyMs: Date.now() - started, error: null,
  };
}

const evaluators = RETRIEVAL_ONLY ? [hitAt5, sectionHit] : judgeConfigured ? ALL_EVALUATORS : CODE_EVALUATORS;
if (!RETRIEVAL_ONLY && !judgeConfigured)
  console.warn('No judge configured (JUDGE_BASE_URL, JUDGE_MODEL): groundedness and citation_support are NOT measured.\n');

const experiment = `exp-${EXP}-${LLM_PROVIDER}-${MODEL_ID.replace(/[^\w.-]/g, '_')}-${EVAL_SCOPE}${INCLUDE_PENDING ? '-UNVERIFIED' : ''}${RETRIEVAL_ONLY ? '-retrieval' : ''}`;
const metadata = {
  corpus: CORPUS_VERSION, scope: EVAL_SCOPE, provider: LLM_PROVIDER, model: MODEL_ID, embedding: EMBEDDING_MODEL, exp: EXP,
  toolCallMode: TOOL_CALL_MODE, evidence: { topK: TOP_K, max: MAX_EVIDENCE, passageChars: MAX_PASSAGE_CHARS },
  guard: process.env.GUARD === 'off' ? 'off' : 'on',
  groundTruth: INCLUDE_PENDING ? 'UNVERIFIED — development run' : 'VERIFIED', retrievalOnly: RETRIEVAL_ONLY,
  judge: judgeConfigured ? process.env.JUDGE_MODEL : null, rowsInSet: counts,
};
const out = path.join(ROOT, 'evaluation', 'results', `${experiment}.json`);
await fs.mkdir(path.dirname(out), { recursive: true });

type Result = { row: EvalRow; run: RunOutput; scores: Score[] };
const results: Result[] = [];
const startedAt = new Date().toISOString();

function summarise(done: boolean) {
  const keys = [...new Set(results.flatMap(r => r.scores.map(s => s.key)))];
  const summary = Object.fromEntries(keys.map(k => {
    const v = results.map(r => r.scores.find(s => s.key === k)?.score).filter((x): x is number => x !== null && x !== undefined);
    return [k, { n: v.length, mean: v.length ? v.reduce((a, b) => a + b, 0) / v.length : null, target: TARGETS[k] ?? null }];
  }));
  const answerable = results.filter(r => !r.row.should_abstain);
  const lat = results.map(r => r.run.latencyMs).sort((a, b) => a - b);
  const first = results.map(r => r.run.firstTokenMs).filter((x): x is number => x !== null).sort((a, b) => a - b);
  const guard = results.map(r => r.run.guard).filter((g): g is NonNullable<typeof g> => !!g);
  return {
    experiment, status: done ? 'complete' : 'running', startedAt, generated_at: new Date().toISOString(),
    progress: { done: results.length, total: rows.length }, metadata, summary,
    false_abstain_rate: answerable.length ? answerable.filter(r => r.run.abstained).length / answerable.length : null,
    first_word_p50_ms: first[Math.floor(first.length * 0.5)] ?? null,
    latency_p50_ms: lat[Math.floor(lat.length * 0.5)] ?? null,
    latency_p95_ms: lat[Math.min(lat.length - 1, Math.floor(lat.length * 0.95))] ?? null,
    errors: results.filter(r => r.run.error).length,
    guard: { statementsDrafted: guard.reduce((n, g) => n + g.checked, 0), statementsShown: guard.reduce((n, g) => n + g.shown, 0),
      statementsRemoved: guard.reduce((n, g) => n + g.removed, 0), citationsCorrected: guard.reduce((n, g) => n + g.recited, 0) },
    rows: results.map(r => ({ id: r.row.id, question: r.row.question, category: r.row.category, ground_truth_status: r.row.ground_truth_status,
      scope: r.run.scope, should_abstain: r.row.should_abstain, expected_documents: r.row.expected_documents, abstained: r.run.abstained,
      answer: r.run.answer, retrieved: r.run.retrieved, scores: r.scores, guard: r.run.guard, firstTokenMs: r.run.firstTokenMs,
      latencyMs: r.run.latencyMs, error: r.run.error })),
  };
}

try {
  for (const row of rows) {
    const run = await target(row);
    const scores = await Promise.all(evaluators.map(ev => ev(run, row)));
    results.push({ row, run, scores });
    const failed = scores.filter(s => s.score !== null && s.score < 1).map(s => s.key);
    console.log(`${row.id.padEnd(4)} ${(run.latencyMs / 1000).toFixed(1).padStart(6)} s  ${run.error ? `ERROR ${run.error}` : failed.length ? `✗ ${failed.join(', ')}` : 'ok'}  — ${row.question}`);
    // Written after every question, so the /evaluation page shows progress while the run is going.
    await fs.writeFile(out, JSON.stringify(summarise(false), null, 1));
  }

  const final = summarise(true);
  await fs.writeFile(out, JSON.stringify(final, null, 1));
  console.log(`\n${experiment}  (${results.length} rows${INCLUDE_PENDING ? ', UNVERIFIED ground truth — development only' : ''})`);
  for (const [k, s] of Object.entries(final.summary))
    console.log(`  ${k.padEnd(20)} ${s.mean === null ? '  n/a' : `${(s.mean * 100).toFixed(0).padStart(4)}%`}  (n=${s.n}${s.target !== null ? `, target ${(s.target * 100).toFixed(0)}%` : ''})${s.mean !== null && s.target !== null && s.mean < s.target ? '  ← below target' : ''}`);
  console.log(`  ${'false_abstain'.padEnd(20)} ${final.false_abstain_rate === null ? '  n/a' : `${(final.false_abstain_rate * 100).toFixed(0).padStart(4)}%`}  (target ≤ 10%)`);
  console.log(`  ${'latency p50 / p95'.padEnd(20)} ${((final.latency_p50_ms ?? 0) / 1000).toFixed(1)} s / ${((final.latency_p95_ms ?? 0) / 1000).toFixed(1)} s  (target p95 ≤ 8 s)`);
  console.log(`  ${'guard'.padEnd(20)} ${final.guard.statementsShown} shown, ${final.guard.statementsRemoved} removed, ${final.guard.citationsCorrected} citations corrected`);
  console.log(`\nWrote ${path.relative(ROOT, out)}`);
} finally {
  await getPool().end();
}
