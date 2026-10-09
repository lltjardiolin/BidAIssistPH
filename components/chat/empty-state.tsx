import { Stamp } from '@/components/evidence/status-badge';
import { SCOPES, type ScopeKey } from '@/lib/scopes';

export type Recent = { q: string; scope: ScopeKey };

const link = 'text-left font-display text-[17px] leading-snug text-ink underline decoration-line-strong underline-offset-4 hover:text-accent hover:decoration-accent';

/**
 * The first screen shows the product doing its job on a real case: one sentence from the corpus, with the
 * two documents behind it stamped in the margin.
 */
export function EmptyState({ scope, corpusDate, recent, onAsk, onPick, onClear, children }: {
  scope: ScopeKey; corpusDate: string; recent: Recent[]; onAsk: (q: string) => void; onPick: (r: Recent) => void; onClear?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="pb-10 pt-6 md:pt-12">
      <h1 className="max-w-[20ch] font-display text-[34px] font-medium leading-[1.12] tracking-[-0.01em] text-ink md:text-[48px]">
        Which document says that, and is it still in force?
      </h1>
      <div className="mt-8 max-w-[760px]">{children}</div>

      <div className="leaf mt-12" aria-label="An example of an answer">
        <div>
          <p className="eyebrow">How an answer reads</p>
          <p className="answer mt-2 !pb-5">
            The IRR “1st Edition, as of 31 March 2026” has been withdrawn and should no longer be used as reference.
            Use only the IRR approved through Resolution No. 02-2025, effective 25 February 2025.
          </p>
        </div>
        <aside className="margin flex flex-col gap-5 text-[13.5px] leading-[1.45]">
          <div>
            <Stamp status="WITHDRAWN" />
            <p className="mt-2 font-semibold text-ink">IRR of RA 12009, 1st Edition</p>
            <p className="text-[12.5px] text-muted">Withdrawn on 31 Jul 2026.</p>
          </div>
          <div>
            <Stamp status="CURRENT" />
            <p className="mt-2 font-semibold text-ink">GPPB-TSO Public Advisory No. 09-2026</p>
            <p className="text-[12.5px] text-muted">The record that withdrew it.</p>
          </div>
        </aside>
      </div>
      <p className="max-w-[68ch] text-[14.5px] leading-relaxed text-ink-2">
        Answers come only from official RA 9184, RA 12009, IRR and GPPB documents, last updated on {corpusDate}. Each statement is
        checked against the document it cites. When the documents do not answer a question, it says so.
      </p>

      <div className="mt-10 grid gap-x-16 gap-y-8 md:grid-cols-2">
        <div>
          <p className="eyebrow">Questions to try in {SCOPES[scope].label}</p>
          <ul className="mt-3 flex flex-col gap-3">
            {SCOPES[scope].suggestions.map(q => (
              <li key={q}><button type="button" onClick={() => onAsk(q)} className={link}>{q}</button></li>
            ))}
          </ul>
        </div>
        {recent.length > 0 && (
          <div>
            <div className="flex items-baseline justify-between gap-4">
              <p className="eyebrow">Your recent questions</p>
              {onClear && (
                <button type="button" onClick={onClear} className="text-[12.5px] text-muted underline-offset-2 hover:underline" aria-label="Clear your recent questions">
                  Clear
                </button>
              )}
            </div>
            <ul className="mt-3 flex flex-col gap-3">
              {recent.slice(0, 5).map(r => (
                <li key={`${r.scope}:${r.q}`}>
                  <button type="button" onClick={() => onPick(r)} className={link}>{r.q}</button>
                  <span className="ml-2 text-[12.5px] text-muted">in {SCOPES[r.scope].label}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
