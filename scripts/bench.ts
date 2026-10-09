// Latency and load test through the real pipeline (retrieval + chat model).
//   npm run bench                         10 demo questions, one at a time
//   npm run bench -- --concurrency 3      three visitors asking at once
//   npm run bench -- --questions 4        first N questions only
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { TOOL_CALL_MODE } from '../lib/chat';
import { getPool } from '../lib/db';
import { LLM_PROVIDER, MODEL_ID } from '../lib/model';
import { MAX_EVIDENCE, MAX_PASSAGE_CHARS, TOP_K } from '../lib/retrieval';
import type { ScopeKey } from '../lib/scopes';
import { runQuestion } from '../evaluation/target';

const args = process.argv.slice(2);
const num = (f: string, d: number) => { const i = args.indexOf(f); return i >= 0 ? Number(args[i + 1]) : d; };
const CONCURRENCY = num('--concurrency', 1);
const LIMIT = num('--questions', 10);

// PDR F4 demo script.
const QUESTIONS: Array<[string, ScopeKey]> = [
  ['What governed procurement before RA 12009?', 'all'],
  ['What is the current procurement framework?', 'all'],
  ['Should we still use the March 31, 2026 IRR?', 'all'],
  ['What documents do I need for negotiated procurement?', 'all'],
  ['What are the framework agreement guidelines?', 'all'],
  ['Is HB 7917 already law?', 'all'],
  ['Can direct acquisition be used for customized goods?', 'opinions'],
  ['What was the rule on tie-breaking?', 'ra9184'],
  ['What changed from RA 9184 to RA 12009?', 'all'],
  ['What is the penalty for bidding while wearing a red shirt?', 'all'],
];

const pct = (v: number[], p: number) => { const s = [...v].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * p))] ?? 0; };
const sec = (ms: number | null) => (ms === null ? '   —  ' : `${(ms / 1000).toFixed(1).padStart(5)}s`);

const queue = QUESTIONS.slice(0, LIMIT).map(([q, scope], i) => ({ i, q, scope }));
const results: Array<{ q: string; scope: string; queuedMs: number; firstTokenMs: number | null; latencyMs: number; chars: number;
  cited: number; invalid: number; unverified: boolean; abstained: boolean; toolCalled: boolean; error: string | null; answer: string }> = [];
const started = Date.now();
const loadBefore = os.loadavg()[0];

console.log(`model ${LLM_PROVIDER}/${MODEL_ID} · tool call ${TOOL_CALL_MODE} · evidence ${TOP_K}–${MAX_EVIDENCE} blocks, ${MAX_PASSAGE_CHARS || 'full'} chars each · concurrency ${CONCURRENCY}\n`);

async function worker() {
  for (let job = queue.shift(); job; job = queue.shift()) {
    const queuedMs = Date.now() - started;
    const r = await runQuestion(job.q, job.scope);
    results.push({ q: job.q, scope: job.scope, queuedMs, firstTokenMs: r.firstTokenMs, latencyMs: r.latencyMs, chars: r.answer.length,
      cited: r.citations.cited.length, invalid: r.citations.invalid.length, unverified: r.citations.unverified, abstained: r.abstained,
      toolCalled: r.toolCalled, error: r.error, answer: r.answer });
    const flag = r.error ? `ERROR ${r.error.slice(0, 60)}` : r.abstained ? 'abstained' : r.citations.unverified ? 'UNVERIFIED (no citations)'
      : r.citations.invalid.length ? 'invalid citation' : `${r.citations.cited.length} sources cited`;
    console.log(`first text ${sec(r.firstTokenMs)}  done ${sec(r.latencyMs)}  ${String(r.answer.length).padStart(5)} chars  ${flag.padEnd(26)} ${job.q}`);
  }
}
try {
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
} finally {
  await getPool().end();
}

const answered = results.filter(r => !r.error && !r.abstained);
const first = answered.map(r => r.firstTokenMs).filter((x): x is number => x !== null);
const total = results.filter(r => !r.error).map(r => r.latencyMs);
const summary = {
  model: `${LLM_PROVIDER}/${MODEL_ID}`, toolCallMode: TOOL_CALL_MODE, evidence: { topK: TOP_K, max: MAX_EVIDENCE, passageChars: MAX_PASSAGE_CHARS },
  concurrency: CONCURRENCY, questions: results.length, wallClockS: Math.round((Date.now() - started) / 1000),
  firstTextP50s: +(pct(first, 0.5) / 1000).toFixed(1), firstTextP95s: +(pct(first, 0.95) / 1000).toFixed(1),
  doneP50s: +(pct(total, 0.5) / 1000).toFixed(1), doneP95s: +(pct(total, 0.95) / 1000).toFixed(1),
  errors: results.filter(r => r.error).length, abstained: results.filter(r => r.abstained).length,
  unverified: results.filter(r => r.unverified).length, withInvalidCitation: results.filter(r => r.invalid > 0).length,
  toolCalled: results.filter(r => r.toolCalled).length,
  loadAverage: { before: +loadBefore.toFixed(1), after: +os.loadavg()[0].toFixed(1), cores: os.cpus().length },
};
console.log('\n' + JSON.stringify(summary, null, 1));
const out = path.resolve(import.meta.dirname, '..', 'storage', 'logs', `bench-${MODEL_ID.replace(/[^\w.-]/g, '_')}-c${CONCURRENCY}.json`);
await fs.writeFile(out, JSON.stringify({ summary, results }, null, 1));
console.log(`details: ${path.relative(process.cwd(), out)}`);
