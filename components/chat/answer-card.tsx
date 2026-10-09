'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { normalizeCitations, type CitationCheck } from '@/lib/citations';
import { ABSTAIN_MESSAGE } from '@/lib/evidence-policy';
import type { Evidence } from '@/lib/types';
import { MarginNote } from '@/components/evidence/margin-note';
import { Button } from '@/components/ui/button';
import { CiteMarker } from './cite-marker';
import { StatusCallout } from './status-callout';

/** "[E3]" → a markdown link the renderer turns into a marker. */
const linkCitations = (text: string) => normalizeCitations(text).replace(/\s*\[E(\d{1,2})\]/g, (_, n) => `[${n}](#cite-${n})`).replace(/(\))(?=\[\d)/g, '$1 ');
const citedIn = (text: string) => [...new Set([...normalizeCitations(text).matchAll(/\[E(\d{1,2})\]/g)].map(m => Number(m[1])))];

/**
 * The answer, set as a page of text. Each block carries, in the margin beside it, the sources it is the
 * first to cite: the note sits next to the sentence that needs it.
 */
export function AnswerCard({
  messageId, text, evidence, streaming, citations, guard, corpusDate, activeCite, onCite,
}: {
  messageId: string;
  text: string;
  evidence: Evidence[];
  streaming: boolean;
  citations?: CitationCheck;
  guard?: { checked: number; shown: number; removed: number; recited: number };
  corpusDate: string;
  flags?: { mixedFrameworks: boolean } | null;
  activeCite: number | null;
  onCite: (n: number) => void;
}) {
  const byN = new Map(evidence.map(e => [e.n, e]));
  const seen = new Set<number>();
  const leaves = text.split(/\n{2,}/).map(b => b.trim()).filter(Boolean).map(md => {
    const fresh = citedIn(md).filter(n => byN.has(n) && !seen.has(n));
    fresh.forEach(n => seen.add(n));
    return { md, notes: fresh.map(n => byN.get(n)!) };
  });
  const uncited = evidence.filter(e => !seen.has(e.n));

  return (
    <section aria-label="Answer">
      {/* While the answer is being written the notice covers every document found; once it is written, only
          the ones it cites. A document that was read but not used should not raise a notice. */}
      <StatusCallout evidence={leaves.length && !streaming ? evidence.filter(e => seen.has(e.n)) : evidence.filter(e => e.status === 'WITHDRAWN' || e.status === 'SUPERSEDED' || e.status === 'PROPOSED')}
        mixedFrameworks={false} />
      <div aria-live="polite" aria-busy={streaming}>
        {leaves.length === 0 ? (
          <div className="leaf">
            <p className="pb-5 text-[14.5px] text-muted" role="status">
              Reading {evidence.length} document{evidence.length === 1 ? '' : 's'}.
              
            </p>
            <aside className="margin flex flex-col gap-4" aria-label="Documents being read">
              {evidence.map(e => <MarginNote key={e.id} e={e} messageId={messageId} active={false} compact />)}
            </aside>
          </div>
        ) : leaves.map((leaf, i) => (
          <div className="leaf" key={i}>
            <div className="answer">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  a: ({ href, children }) => {
                    const m = /^#cite-(\d+)$/.exec(href ?? '');
                    if (m) return <CiteMarker n={Number(m[1])} evidence={byN.get(Number(m[1]))} active={activeCite === Number(m[1])} onSelect={onCite} />;
                    // Only the notes in the margin link out; an address written by the model is not trusted.
                    return <span>{children}</span>;
                  },
                  table: ({ children }) => <div className="table-wrap"><table>{children}</table></div>,
                  img: () => null,
                }}
              >
                {linkCitations(leaf.md)}
              </ReactMarkdown>
            </div>
            <aside className={`margin flex flex-col gap-5 ${leaf.notes.length ? '' : 'max-xl:hidden'}`} aria-label={leaf.notes.length ? 'Sources for this passage' : undefined}>
              {leaf.notes.map(e => <MarginNote key={e.id} e={e} messageId={messageId} active={activeCite === e.n} fresh />)}
            </aside>
          </div>
        ))}
      </div>

      {!streaming && leaves.length > 0 && (
        <footer className="mt-1 flex max-w-[68ch] flex-col gap-2 border-t border-line pt-3 text-[13px] leading-snug text-muted">
          {citations?.unverified && (
            <p role="alert" className="border-l-[3px] border-status-withdrawn-fg pl-3 text-ink">
              <strong className="font-semibold">Not verified.</strong> This answer cites none of the documents that were found, so it
              could not be checked against them. Read the documents instead.
            </p>
          )}
          {citations?.partiallyVerified && !citations.unverified && (
            <p className="border-l-[3px] border-status-superseded-fg pl-3 text-ink">
              <strong className="font-semibold">Partly verified.</strong>{' '}
              {citations.invalid.length > 0 ? 'This answer cites a source that was not found.' : 'Some statements carry no citation.'}{' '}
              Check the sources before relying on it.
            </p>
          )}
          <p>
            Every statement shown was checked against the source it cites
            {guard?.removed ? `; ${guard.removed} that the sources did not support ${guard.removed === 1 ? 'was' : 'were'} left out` : ''}.
            The documents were last updated on {corpusDate}.
          </p>
          {uncited.length > 0 && (
            <details>
              <summary className="inline cursor-pointer select-none font-medium text-accent underline decoration-accent/30 underline-offset-2 hover:decoration-accent">
                {uncited.length} more document{uncited.length === 1 ? ' was' : 's were'} read but not cited
              </summary>
              <div className="mt-3 flex flex-col gap-5">
                {uncited.map(e => <MarginNote key={e.id} e={e} messageId={messageId} active={activeCite === e.n} />)}
              </div>
            </details>
          )}
        </footer>
      )}
    </section>
  );
}

function Documents({ evidence, messageId }: { evidence: Evidence[]; messageId: string }) {
  if (!evidence.length) return null;
  return (
    <div className="mt-5 max-w-[68ch]">
      <p className="eyebrow">Documents that were found</p>
      <div className="mt-3 flex flex-col gap-5 border-l border-line pl-5">
        {evidence.map(e => <MarginNote key={e.id} e={e} messageId={messageId} active={false} />)}
      </div>
    </div>
  );
}

/** Documents were found, but nothing the model wrote could be checked against them. */
export function UnsupportedCard({ removed, evidence, messageId }: { removed: number; evidence: Evidence[]; messageId: string }) {
  return (
    <section aria-label="Answer" aria-live="polite">
      {/* What the registry records about a document's status holds whether or not an answer could be written. */}
      <StatusCallout evidence={evidence.filter(e => e.status === 'WITHDRAWN' || e.status === 'SUPERSEDED' || e.status === 'PROPOSED')} mixedFrameworks={false} />
      <p className="answer !pb-2">{ABSTAIN_MESSAGE}</p>
      <p className="max-w-[68ch] text-[14.5px] leading-snug text-ink-2">
        {removed > 0 ? `An answer was drafted, but ${removed === 1 ? 'its one statement is' : `its ${removed} statements are`} not supported by the documents, so it is not shown. ` : ''}
        The documents below may still hold what you need.
      </p>
      <Documents evidence={evidence} messageId={messageId} />
    </section>
  );
}

export function AbstentionCard({ scopeIsAll, onTryAll }: { scopeIsAll: boolean; onTryAll: () => void }) {
  return (
    <section aria-label="Answer" aria-live="polite">
      <p className="answer !pb-2">{ABSTAIN_MESSAGE}</p>
      <p className="max-w-[68ch] text-[14.5px] leading-snug text-ink-2">
        {scopeIsAll
          ? 'No indexed document supports an answer. Name the document, section or issuance number if you know it.'
          : 'This search covers only part of the documents. The full set may hold the answer.'}
      </p>
      {!scopeIsAll && <Button className="mt-4" onClick={onTryAll}>Search all documents</Button>}
    </section>
  );
}

export function ErrorCard({ message, onRetry }: { message?: string; onRetry: () => void }) {
  return (
    <section role="alert">
      <p className="answer !pb-2">{message ?? 'The documents could not be searched just now.'}</p>
      <p className="max-w-[68ch] text-[14.5px] leading-snug text-ink-2">No answer is shown, because it could not be checked against the sources.</p>
      <Button className="mt-4" onClick={onRetry}>Try again</Button>
    </section>
  );
}
