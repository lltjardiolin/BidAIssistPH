// Evaluators (PDR E3). Code evaluators are deterministic. The two LLM judges run on a model that is NOT
// the model under test and are skipped — never silently passed — when no judge is configured.
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateText } from 'ai';
import { CITE } from '../lib/citations';
import { extractTokens } from '../lib/aliases';
import { MODEL_ID } from '../lib/model';
import type { EvalRow } from './csv';
import type { RunOutput } from './target';

export type Score = { key: string; score: number | null; comment?: string };
type Evaluator = (run: RunOutput, row: EvalRow) => Score | Promise<Score>;

const na = (key: string, comment: string): Score => ({ key, score: null, comment });
const sentencesCiting = (answer: string, n: number) =>
  answer.split(/(?<=[.!?])\s+|\n+/).filter(s => s.includes(`[E${n}]`));

export const hitAt5: Evaluator = (run, row) => {
  if (!row.expected_documents.length) return na('hit_at_5', 'no expected documents');
  const top5 = run.retrieved.slice(0, 5).map(r => r.documentId);
  const hit = row.expected_documents.some(d => top5.includes(d));
  return { key: 'hit_at_5', score: hit ? 1 : 0, comment: hit ? undefined : `top 5: ${top5.join(', ') || 'none'}` };
};

export const sectionHit: Evaluator = (run, row) => {
  if (!row.expected_sections.length) return na('section_hit', 'no expected sections');
  const want = row.expected_sections.flatMap(s => extractTokens(s));
  const got = new Set(run.retrieved.flatMap(r => extractTokens(r.section ?? '')));
  const textTokens = new Set(Object.values(run.evidenceText).flatMap(t => extractTokens(t)));
  const hit = want.some(t => got.has(t) || textTokens.has(t));
  return { key: 'section_hit', score: hit ? 1 : 0 };
};

const CURRENT_CLAIM = /\b(is|remains|are) (the )?(current|in force|in effect|applicable|authoritative|valid)\b|\bthe rule is\b|\bstill (valid|applies|in force)\b/i;
const NEGATED = /\b(not|no longer|never|isn't|aren't|withdrawn|superseded|should not|must not|do not|hindi)\b/i;

export const versionAccuracy: Evaluator = run => {
  const versionOnly = run.retrieved.filter(r => r.label === 'VERSION_ONLY');
  const bad = versionOnly.flatMap(r => sentencesCiting(run.answer, r.n)).filter(s => CURRENT_CLAIM.test(s) && !NEGATED.test(s));
  return { key: 'version_accuracy', score: bad.length ? 0 : 1, comment: bad[0] };
};

export const frameworkAccuracy: Evaluator = (run, row) => {
  if (run.abstained || !row.expected_documents.length) return na('framework_accuracy', 'not applicable');
  const cited = [...new Set([...run.answer.matchAll(CITE)].map(m => Number(m[1])))];
  if (!cited.length) return { key: 'framework_accuracy', score: 0, comment: 'no citations' };
  const expected = row.expected_status === 'HISTORICAL' ? ['RA9184', 'BOTH'] : ['RA12009', 'BOTH'];
  const frameworks = cited.map(n => run.retrieved.find(r => r.n === n)?.framework).filter(Boolean) as string[];
  // A comparison legitimately cites both frameworks; otherwise at least one citation must be in the expected one.
  const ok = frameworks.some(f => expected.includes(f));
  return { key: 'framework_accuracy', score: ok ? 1 : 0, comment: ok ? undefined : `cited frameworks: ${frameworks.join(', ')}` };
};

export const statusAccuracy: Evaluator = run => {
  if (run.abstained) return na('status_accuracy', 'abstained');
  const problems: string[] = [];
  for (const r of run.retrieved) {
    const s = sentencesCiting(run.answer, r.n);
    if (!s.length) continue;
    if (r.label === 'PROPOSAL_ONLY' && !s.some(x => /\bpropos|\bbill\b|not (yet )?(a )?law|panukala/i.test(x))) problems.push(`E${r.n}: bill not phrased as a proposal`);
    if (r.label === 'INTERPRETIVE_ONLY' && s.some(x => /\bthe rule is\b/i.test(x))) problems.push(`E${r.n}: opinion stated as the rule`);
    if (r.label === 'INTERPRETIVE_ONLY' && !/opin|GPPB-TSO|TSO|interpret|FAQ|explain|guidance/i.test(run.answer)) problems.push(`E${r.n}: opinion not attributed`);
    if (r.label === 'HISTORICAL_ONLY' && s.some(x => CURRENT_CLAIM.test(x) && !NEGATED.test(x))) problems.push(`E${r.n}: historical source stated as current`);
  }
  return { key: 'status_accuracy', score: problems.length ? 0 : 1, comment: problems.join('; ') || undefined };
};

export const abstention: Evaluator = (run, row) => ({
  key: 'abstention', score: run.abstained === row.should_abstain ? 1 : 0,
  comment: run.abstained === row.should_abstain ? undefined : run.abstained ? 'false abstention' : 'answered an unsupported question',
});

export const toolCalled: Evaluator = run => ({ key: 'tool_called', score: run.toolCalled ? 1 : 0 });

export const citationValidity: Evaluator = run =>
  run.abstained ? na('citation_validity', 'abstained')
    : { key: 'citation_validity', score: run.citations.invalid.length === 0 && run.citations.cited.length > 0 ? 1 : 0,
        comment: run.citations.invalid.length ? `invalid: ${run.citations.invalid.join(', ')}` : undefined };

// ---- LLM judges ------------------------------------------------------------------------------------

const JUDGE_MODEL = process.env.JUDGE_MODEL ?? '';
export const judgeConfigured = !!(process.env.JUDGE_BASE_URL && JUDGE_MODEL);
if (judgeConfigured && JUDGE_MODEL === MODEL_ID)
  throw new Error(`JUDGE_MODEL (${JUDGE_MODEL}) must differ from the model under test (PDR E3).`);

const judge = judgeConfigured
  ? createOpenAICompatible({ name: 'judge', baseURL: process.env.JUDGE_BASE_URL!, apiKey: process.env.JUDGE_API_KEY || undefined })(JUDGE_MODEL)
  : null;

async function ask(key: string, instructions: string, run: RunOutput): Promise<Score> {
  if (!judge) return na(key, 'no judge configured (JUDGE_BASE_URL / JUDGE_MODEL)');
  if (run.abstained) return na(key, 'abstained');
  const evidence = Object.entries(run.evidenceText).map(([k, v]) => `[${k}] ${v}`).join('\n\n');
  const { text } = await generateText({
    model: judge, temperature: 0, maxRetries: 2,
    instructions: `${instructions}\nReply with JSON only: {"supported": <number of supported items>, "total": <number of items checked>, "unsupported": ["<short quote>", ...]}`,
    prompt: `EVIDENCE\n${evidence}\n\nANSWER\n${run.answer}`,
  });
  try {
    const j = JSON.parse(/\{[\s\S]*\}/.exec(text)?.[0] ?? '') as { supported: number; total: number; unsupported?: string[] };
    if (!j.total) return na(key, 'judge found nothing to check');
    return { key, score: Math.max(0, Math.min(1, j.supported / j.total)), comment: j.unsupported?.slice(0, 3).join(' | ') || undefined };
  } catch {
    return na(key, `unparseable judge output: ${text.slice(0, 120)}`);
  }
}

export const groundedness: Evaluator = run => ask('groundedness',
  'You audit a legal research assistant. List every factual claim in ANSWER (rules, dates, requirements, document status). ' +
  'A claim is supported only if the EVIDENCE states it. General knowledge does not count.', run);

export const citationSupport: Evaluator = run => ask('citation_support',
  'You audit citations. For every sentence in ANSWER that carries a marker such as [E2], check whether that specific ' +
  'evidence block supports the sentence. Count one item per marker.', run);

/** Share of the statements the model drafted that survived the grounding guard. Measures the model, not the app: nothing unsupported is shown either way. */
export const statementsSupported: Evaluator = run =>
  !run.guard || !run.guard.checked ? na('statements_supported', 'no statements drafted')
    : { key: 'statements_supported', score: (run.guard.checked - run.guard.removed) / run.guard.checked,
        comment: run.guard.removedText.slice(0, 2).join(' | ') || undefined };

export const CODE_EVALUATORS = [hitAt5, sectionHit, versionAccuracy, frameworkAccuracy, statusAccuracy, abstention, toolCalled, citationValidity, statementsSupported];
export const ALL_EVALUATORS = [...CODE_EVALUATORS, groundedness, citationSupport];

// PDR E6. False abstention and latency are reported separately by the runner.
export const TARGETS: Record<string, number> = {
  hit_at_5: 0.85, section_hit: 0.75, citation_support: 0.9, groundedness: 0.9, version_accuracy: 0.95,
  framework_accuracy: 0.95, status_accuracy: 0.95, abstention: 1, tool_called: 1, citation_validity: 1,
};
