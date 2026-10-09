// Evaluation target: runs one question through the SAME pipeline as /api/chat (lib/chat.ts).
import { checkCitations, normalizeCitations, type CitationCheck } from '../lib/citations';
import { streamAnswer, type GuardReport } from '../lib/chat';
import { ABSTAIN_MESSAGE } from '../lib/evidence-policy';
import type { ScopeKey } from '../lib/scopes';
import type { Evidence, RetrievalResult } from '../lib/types';

export type RunOutput = {
  answer: string;
  scope: ScopeKey;
  toolCalled: boolean;          // step 1 contained a retrieveEvidence call
  abstained: boolean;
  retrieved: Array<Pick<Evidence, 'n' | 'documentId' | 'status' | 'framework' | 'authority' | 'label' | 'section' | 'companion'>>;
  evidenceText: Record<string, string>;   // "E1" → passage, for the LLM judges
  citations: CitationCheck;
  guard: { checked: number; shown: number; removed: number; recited: number; removedText: string[] } | null;
  firstTokenMs: number | null;
  latencyMs: number;
  error: string | null;
};

export async function runQuestion(question: string, scope: ScopeKey): Promise<RunOutput> {
  const started = Date.now();
  let firstTokenMs: number | null = null;
  let answer = '';
  let result: RetrievalResult | null = null;
  let error: string | null = null;
  let toolCalled = false;
  const report: GuardReport = { stats: null };

  try {
    const stream = streamAnswer({ messages: [{ role: 'user', content: question }], scope, report });
    for await (const part of stream.stream) {
      if (part.type === 'text-delta') { firstTokenMs ??= Date.now() - started; answer += part.text; }
      else if (part.type === 'tool-result' && part.toolName === 'retrieveEvidence') result = part.output as RetrievalResult;
      else if (part.type === 'tool-error') error = `tool error: ${String(part.error)}`;
      else if (part.type === 'error') error = String(part.error);
    }
    const steps = await stream.steps;
    toolCalled = !!steps[0]?.toolCalls.some(c => c.toolName === 'retrieveEvidence');
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  const evidence = result?.evidence ?? [];
  // Deterministic abstention produces no model text; report the fixed sentence the UI shows.
  if (result?.abstain && !answer) answer = ABSTAIN_MESSAGE;
  answer = normalizeCitations(answer);
  return {
    answer, scope, toolCalled,
    abstained: !!result?.abstain || answer.includes(ABSTAIN_MESSAGE),
    retrieved: evidence.map(({ n, documentId, status, framework, authority, label, section, companion }) =>
      ({ n, documentId, status, framework, authority, label, section, companion })),
    evidenceText: Object.fromEntries(evidence.map(e => [`E${e.n}`, `${e.reference} [${e.status}]\n${e.text}`])),
    citations: checkCitations(answer, evidence.length),
    guard: report.stats && { checked: report.stats.checked, shown: report.stats.shown, removed: report.stats.removed,
      recited: report.stats.recited, removedText: report.stats.removedText },
    firstTokenMs, latencyMs: Date.now() - started, error,
  };
}
