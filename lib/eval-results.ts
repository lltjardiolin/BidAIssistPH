// Reads evaluation/results/*.json (written by `npm run eval`) for the /evaluation page. Server only.
import fs from 'node:fs/promises';
import path from 'node:path';

export type Metric = { n: number; mean: number | null; target: number | null };
export type EvalRun = {
  experiment: string; status: 'running' | 'complete'; startedAt: string; generated_at: string;
  progress: { done: number; total: number };
  metadata: { corpus: string; scope: string; provider: string; model: string; embedding: string; exp: string; toolCallMode: string;
    evidence: { topK: number; max: number; passageChars: number }; guard: string; groundTruth: string; retrievalOnly: boolean;
    judge: string | null; rowsInSet: Record<string, number> };
  summary: Record<string, Metric>;
  false_abstain_rate: number | null; first_word_p50_ms: number | null; latency_p50_ms: number | null; latency_p95_ms: number | null;
  errors: number;
  guard: { statementsDrafted: number; statementsShown: number; statementsRemoved: number; citationsCorrected: number };
  rows: Array<{ id: string; question: string; category: string; ground_truth_status: string; scope: string; should_abstain: boolean;
    abstained: boolean; answer: string; scores: Array<{ key: string; score: number | null; comment?: string }>;
    retrieved: Array<{ n: number; documentId: string }>; latencyMs: number; error: string | null }>;
};

export async function loadRuns(): Promise<EvalRun[]> {
  const dir = path.join(process.cwd(), 'evaluation', 'results');
  let files: string[] = [];
  try { files = (await fs.readdir(dir)).filter(f => f.endsWith('.json')); } catch { return []; }
  const runs: EvalRun[] = [];
  for (const f of files) {
    try {
      const run = JSON.parse(await fs.readFile(path.join(dir, f), 'utf8')) as EvalRun;
      if (run.experiment && run.summary && run.rows) runs.push(run);
    } catch { /* a file being written right now; it will be readable on the next request */ }
  }
  return runs.sort((a, b) => b.generated_at.localeCompare(a.generated_at));
}

export const METRIC_LABEL: Record<string, [string, string]> = {
  hit_at_5: ['Right document in top 5', 'An expected document is among the first five sources retrieved.'],
  section_hit: ['Right section retrieved', 'The expected section is among the retrieved passages.'],
  tool_called: ['Retrieval used', 'The first step of every answer was a retrieval call.'],
  abstention: ['Abstains when it should', 'Refuses unsupported questions, answers supported ones.'],
  citation_validity: ['Citations valid', 'The answer cites sources, and only sources that were retrieved.'],
  version_accuracy: ['Version accuracy', 'No withdrawn or superseded document is presented as current.'],
  framework_accuracy: ['Framework accuracy', 'Cites the framework the question is about (RA 12009 or RA 9184).'],
  status_accuracy: ['Status wording', 'Bills are "proposed", opinions are attributed, historical is labelled.'],
  statements_supported: ['Drafted statements supported', 'Share of what the model drafted that the grounding guard could verify. The rest was never shown.'],
  groundedness: ['Groundedness (LLM judge)', 'Claims supported by the evidence, as judged by a second model.'],
  citation_support: ['Citation support (LLM judge)', 'Each citation supports its sentence, as judged by a second model.'],
};
