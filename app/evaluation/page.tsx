import type { Metadata } from 'next';
import { AppHeader } from '@/components/shell/app-header';
import { Sheet } from '@/components/shell/sheet';
import { CORPUS_DATE } from '@/lib/copy';
import { METRIC_LABEL, loadGroundTruthCounts, loadRuns, type EvalRun } from '@/lib/eval-results';
import { CORPUS_VERSION, formatDate } from '@/lib/manifest';

export const metadata: Metadata = { title: 'Evaluation' };
export const dynamic = 'force-dynamic';

const pct = (v: number | null) => (v === null ? 'n/a' : `${Math.round(v * 100)}%`);
const sec = (ms: number | null) => (ms === null ? 'n/a' : `${(ms / 1000).toFixed(1)} s`);
const when = (iso: string) => `${formatDate(iso.slice(0, 10))} ${iso.slice(11, 16)} UTC`;
const H2 = 'font-display text-[24px] font-medium leading-tight text-ink';
const tag = 'inline-flex items-center rounded-badge px-1.5 py-[2px] text-[12px] font-semibold leading-none';

function Notice({ tone, children }: { tone: 'warn' | 'info'; children: React.ReactNode }) {
  return (
    <p role="note" className={`mt-3 rounded-control px-3.5 py-2.5 text-[13px] leading-snug ${tone === 'warn' ? 'bg-status-superseded-bg text-status-superseded-fg' : 'bg-status-proposed-bg text-status-proposed-fg'}`}>
      {children}
    </p>
  );
}

function Run({ run }: { run: EvalRun }) {
  const m = run.metadata;
  const unverified = m.groundTruth !== 'VERIFIED';
  const failures = run.rows.filter(r => r.error || r.scores.some(s => s.score !== null && s.score < 1));
  return (
    <section className="mt-8" aria-labelledby={`run-${run.experiment}`}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 id={`run-${run.experiment}`} className="font-mono text-[15px] text-ink">{run.experiment}</h2>
        <span className={`${tag} ${run.status === 'complete' ? 'bg-status-current-bg text-status-current-fg' : 'bg-status-proposed-bg text-status-proposed-fg'}`}>
          {run.status === 'complete' ? 'Complete' : `Running, ${run.progress.done} of ${run.progress.total}`}
        </span>
        {unverified && <span className={`${tag} bg-status-superseded-bg text-status-superseded-fg`}>Ground truth not verified</span>}
      </div>
      <p className="mt-1.5 text-[13px] text-ink-2">
        {when(run.generated_at)}. Model {m.provider}/{m.model}, {run.progress.done} questions
        {m.retrievalOnly ? ', retrieval only with no model' : `, guard ${m.guard}, ${m.evidence.topK} to ${m.evidence.max} passages per answer`}
        {m.judge ? `, judge ${m.judge}` : ', no LLM judge'}, experiment {m.exp}, documents of {m.corpus}.
      </p>
      <p className="mt-1 text-[13px] text-ink-2">Scores are computed by this harness and stored with the repository; answer and judge calls are traced in Pydantic Logfire when tracing is configured.</p>

      <div className="relative mt-4 overflow-x-auto border-y border-line">
        <table className="w-full min-w-[640px] border-collapse text-left text-[13.5px]">
          <thead className="text-[13px] text-ink-2">
            <tr>
              <th scope="col" className="px-4 py-2.5 font-semibold">Measure</th>
              <th scope="col" className="px-4 py-2.5 text-right font-semibold">Result</th>
              <th scope="col" className="px-4 py-2.5 text-right font-semibold">Target</th>
              <th scope="col" className="px-4 py-2.5 font-semibold">Outcome</th>
              <th scope="col" className="px-4 py-2.5 text-right font-semibold">Questions</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(run.summary).map(([key, s]) => {
              const [label, help] = METRIC_LABEL[key] ?? [key, ''];
              const met = s.mean !== null && s.target !== null ? s.mean >= s.target : null;
              return (
                <tr key={key} className="border-t border-line-soft align-top">
                  <th scope="row" className="px-4 py-3 text-left font-normal">
                    <span className="font-medium text-ink">{label}</span>
                    <span className="mt-0.5 block text-[12.5px] text-ink-2">{help}</span>
                  </th>
                  <td className="px-4 py-3 text-right font-mono text-[13px] font-medium text-ink">{pct(s.mean)}</td>
                  <td className="px-4 py-3 text-right font-mono text-[13px] text-ink-2">{s.target === null ? '—' : `≥ ${pct(s.target)}`}</td>
                  <td className="px-4 py-3">
                    {met === null ? <span className="text-[12.5px] text-muted">{s.n ? 'no target' : 'not measured'}</span>
                      : <span className={`${tag} ${met ? 'bg-status-current-bg text-status-current-fg' : 'bg-status-withdrawn-bg text-status-withdrawn-fg'}`}>{met ? 'Met' : 'Below target'}</span>}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-[13px] text-ink-2">{s.n}</td>
                </tr>
              );
            })}
            {!m.retrievalOnly && (
              <>
                <tr className="border-t border-line-soft">
                  <th scope="row" className="px-4 py-3 text-left font-medium text-ink">False abstention</th>
                  <td className="px-4 py-3 text-right font-mono text-[13px] font-medium">{pct(run.false_abstain_rate)}</td>
                  <td className="px-4 py-3 text-right font-mono text-[13px] text-ink-2">≤ 10%</td>
                  <td className="px-4 py-3">{run.false_abstain_rate !== null && <span className={`${tag} ${run.false_abstain_rate <= 0.1 ? 'bg-status-current-bg text-status-current-fg' : 'bg-status-withdrawn-bg text-status-withdrawn-fg'}`}>{run.false_abstain_rate <= 0.1 ? 'Met' : 'Above target'}</span>}</td>
                  <td />
                </tr>
                <tr className="border-t border-line-soft">
                  <th scope="row" className="px-4 py-3 text-left font-medium text-ink">Time to complete answer (p95)</th>
                  <td className="px-4 py-3 text-right font-mono text-[13px] font-medium">{sec(run.latency_p95_ms)}</td>
                  <td className="px-4 py-3 text-right font-mono text-[13px] text-ink-2">≤ 8.0 s</td>
                  <td className="px-4 py-3">{run.latency_p95_ms !== null && <span className={`${tag} ${run.latency_p95_ms <= 8000 ? 'bg-status-current-bg text-status-current-fg' : 'bg-status-withdrawn-bg text-status-withdrawn-fg'}`}>{run.latency_p95_ms <= 8000 ? 'Met' : 'Above target'}</span>}</td>
                  <td className="px-4 py-3 text-right text-[12.5px] text-ink-2">first word p50 {sec(run.first_word_p50_ms)}</td>
                </tr>
              </>
            )}
          </tbody>
        </table>
      </div>

      {!m.retrievalOnly && (
        <p className="mt-3 text-[13px] leading-relaxed text-ink-2">
          Grounding guard: the model drafted {run.guard.statementsDrafted} statements; {run.guard.statementsShown} were shown,{' '}
          {run.guard.statementsRemoved} were removed because the sources did not support them, and {run.guard.citationsCorrected} had
          their citation corrected.
        </p>
      )}

      {failures.length > 0 && (
        <details className="mt-4 border-y border-line">
          <summary className="cursor-pointer px-4 py-3 text-[13.5px] font-medium text-accent">Questions that missed a measure ({failures.length})</summary>
          <ul className="border-t border-line-soft">
            {failures.map(r => (
              <li key={r.id} className="border-b border-line-soft px-4 py-3 last:border-b-0">
                <p className="text-[13.5px] text-ink"><span className="font-mono text-[12px] font-medium text-ink-2">{r.id}</span> {r.question}</p>
                <p className="mt-1 text-[12.5px] text-status-withdrawn-fg">
                  {r.error ? `Error: ${r.error}` : r.scores.filter(s => s.score !== null && s.score < 1).map(s => `${METRIC_LABEL[s.key]?.[0] ?? s.key}${s.comment ? ` (${s.comment.slice(0, 140)})` : ''}`).join(' · ')}
                </p>
                <p className="mt-1 text-[12.5px] text-ink-2">Retrieved: {r.retrieved.map(x => x.documentId).join(', ') || 'nothing'}</p>
                {r.answer && <p className="mt-1 line-clamp-3 text-[12.5px] text-ink-2">Answer: {r.answer}</p>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

export default async function EvaluationPage() {
  const runs = await loadRuns();
  const counts = (await loadGroundTruthCounts()) ?? runs[0]?.metadata.rowsInSet;
  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader active="evaluation" />
      <Sheet className="pt-8 md:pt-12">
                <h1 className="max-w-[22ch] font-display text-[30px] font-medium leading-[1.12] tracking-[-0.01em] text-ink md:text-[40px]">How well does it answer?</h1>
        <p className="mt-4 max-w-[760px] text-[15px] leading-relaxed text-ink-2">
          A fixed set of 50 questions is run through the same pipeline that answers visitors: direct questions, provisions,
          version traps, bills, opinions and questions it should refuse. Each answer is scored by code and by a second model;
          the calls behind every run are traced in Pydantic Logfire.
        </p>
        {counts && (
          <Notice tone="warn">
            <strong className="font-semibold">Ground truth.</strong> {counts.VERIFIED ?? 0} of the 50 questions have an expected answer
            checked by a person against the source PDFs; {counts.PENDING ?? 0} are waiting for that check and {counts.EXCLUDED ?? 0} are
            excluded because their source is not in the corpus yet. Runs marked “ground truth unverified” show how the system
            behaves; they are not final results.
          </Notice>
        )}
        {runs.length === 0
          ? <p className="mt-8 border-y border-line px-5 py-6 text-[14px] text-ink-2">No evaluation has been run yet. Run <span className="font-mono text-[13px]">npm run eval</span> on the server.</p>
          : runs.map(r => <Run key={r.experiment} run={r} />)}

        <section className="mt-10" aria-labelledby="method">
          <h2 id="method" className={H2}>Method</h2>
          <ul className="mt-3 list-disc space-y-1.5 pl-5 text-[13.5px] leading-relaxed text-ink-2">
            <li>Retrieval measures compare the documents retrieved with the documents each question is expected to find.</li>
            <li>Answer measures are computed by code from the answer and the evidence it cites.</li>
            <li>The two judge measures use a second language model, which must differ from the model being tested.</li>
            <li>Experiments A to D compare chunking and retrieval settings; D is the configuration in production.</li>
          </ul>
        </section>
      </Sheet>
    </div>
  );
}
