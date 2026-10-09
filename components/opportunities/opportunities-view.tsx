'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import type { Category, Feed, NoticeStatus, NoticeView, RuleBadge, RuleRow } from '@/lib/opportunities';

const CATEGORIES: Category[] = ['Goods', 'Infrastructure', 'Consulting'];
const PREFS_KEY = 'bidaissistph.categories';

const BADGE: Record<RuleBadge, string> = {
  STATUTE: 'bg-status-current-bg text-status-current-fg',
  IRR: 'bg-status-current-bg text-status-current-fg',
  BOARD: 'bg-status-current-bg text-status-current-fg',
  OPINION: 'bg-status-reference-bg text-status-reference-fg',
  HISTORICAL: 'bg-status-historical-bg text-status-historical-fg',
  'TIME-BOUND': 'bg-status-superseded-bg text-status-superseded-fg',
};
const LABEL: Record<RuleBadge, string> = { STATUTE: 'Statute', IRR: 'IRR', BOARD: 'Board issuance', OPINION: 'Opinion', HISTORICAL: 'Historical', 'TIME-BOUND': 'Time-bound' };
const STATUS_LABEL: Record<NoticeStatus, string> = { OPEN: 'Open', CLOSED: 'Closed', POSTPONED: 'Postponed', CANCELLED: 'Cancelled', AWARDED: 'Awarded' };
const STATUS: Record<NoticeStatus, string> = {
  OPEN: 'bg-status-current-bg text-status-current-fg',
  CLOSED: 'bg-status-historical-bg text-status-historical-fg',
  POSTPONED: 'bg-status-superseded-bg text-status-superseded-fg',
  CANCELLED: 'bg-status-withdrawn-bg text-status-withdrawn-fg',
  AWARDED: 'bg-status-proposed-bg text-status-proposed-fg',
};
const tag = 'inline-flex items-center rounded-badge px-1.5 py-[2px] text-[12px] font-semibold leading-none';
const pill = (active: boolean) =>
  `min-h-10 shrink-0 border-b-2 px-2 text-[14.5px] ${
    active ? 'border-accent font-semibold text-ink' : 'border-transparent text-ink-2 hover:text-ink'}`;
const textLink = 'font-medium text-accent underline decoration-accent/30 underline-offset-2 hover:decoration-accent';

function SourceLine({ n }: { n: NoticeView }) {
  if (n.sample) return <p className="text-[12.5px] text-muted">A sample notice, not a real posting. There is no original to open.</p>;
  return (
    <p className="text-[12.5px] text-muted">
      Posted on PhilGEPS on {n.publishedLabel}{n.fetchedAt ? `, read on ${n.fetchedAt}` : ''}
    </p>
  );
}

function OriginalLink({ n }: { n: NoticeView }) {
  if (!n.sourceUrl) return null;
  return (
    <a href={n.sourceUrl} target="_blank" rel="noopener noreferrer"
      className={`inline-flex min-h-10 items-center text-[13.5px] ${textLink}`}>
      View the original posting<span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

function RuleItem({ r }: { r: RuleRow }) {
  return (
    <li className="text-[13.5px] leading-[1.45]">
      <span className={`${tag} ${BADGE[r.badge]}`}>{LABEL[r.badge]}</span>
      <p className="mt-1.5 font-semibold text-ink">{r.name}</p>
      {r.title && <p className="text-ink-2">{r.title}</p>}
      {r.detail && <p className="mt-0.5 font-mono text-[13px] text-ink">{r.detail}</p>}
      {r.note && <p className="mt-1.5 text-[12.5px] text-ink">{r.note}</p>}
      {r.sourceUrl && (
        <a href={r.sourceUrl} target="_blank" rel="noopener noreferrer"
          className={`mt-2 inline-block text-[12.5px] ${textLink}`}>
          Open the original<span className="sr-only"> (opens in a new tab)</span>
        </a>
      )}
    </li>
  );
}

function RuleLens({ n, onClose }: { n: NoticeView | null; onClose?: () => void }) {
  if (!n) {
    return (
      <div>
        <h2 className="font-display text-[22px] font-medium text-ink">The rules for a notice</h2>
        <p className="mt-2 text-[13.5px] leading-relaxed text-ink-2">
          Choose “Show the rules” on a notice to see which documents govern it. The list comes from the registry of indexed
          documents, not from a language model.
        </p>
      </div>
    );
  }
  const governing = n.rules.filter(r => r.role === 'governing');
  const context = n.rules.filter(r => r.role === 'context');
  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="eyebrow">The rules for</p>
          <h2 className="mt-1 font-display text-[22px] font-medium leading-tight text-ink">{n.title}</h2>
        </div>
        {onClose && (
          <button type="button" autoFocus onClick={onClose}
            className="inline-flex min-h-10 shrink-0 items-center rounded-control border border-line-strong bg-surface px-3 text-[13.5px] font-medium">Close</button>
        )}
      </div>
      <p className="mt-2 text-[13.5px] leading-snug text-ink-2">
        Reference {n.refNo}{n.sample ? ', a sample notice' : ''}. {n.sample ? 'Mode' : 'PhilGEPS lists the mode as'}{' '}
        <span className="font-medium text-ink">{n.mode}</span>. Closes on <span className="font-medium text-ink">{n.closingLabel}</span>.
      </p>

      <h3 className="eyebrow mt-6">Rules that apply</h3>
      <ul className="mt-3 flex flex-col gap-5">{governing.map(r => <RuleItem key={r.documentId} r={r} />)}</ul>

      {context.length > 0 && (
        <>
          <h3 className="eyebrow mt-6">Not governing</h3>
          <ul className="mt-3 flex flex-col gap-5">{context.map(r => <RuleItem key={r.documentId} r={r} />)}</ul>
        </>
      )}

      <h3 className="eyebrow mt-6">Before you prepare a bid</h3>
      <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-[13.5px] leading-snug text-ink-2">
        <li>Read the original posting and its bidding documents; they set the actual requirements.</li>
        <li>Open each document listed above and check the section that covers this mode.</li>
        <li>Ask BidAIssistPH what the documents require, and read the sources it cites.</li>
      </ol>

      <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2">
        <Link href={n.askUrl}
          className="inline-flex min-h-11 items-center rounded-control bg-accent px-4 text-[14.5px] font-semibold text-white hover:bg-accent-hover">
          Ask about this notice
        </Link>
        <OriginalLink n={n} />
      </div>
      <p className="mt-4 text-[12px] leading-snug text-muted">
        This list shows which documents to read. It does not say whether a bid is compliant and is not legal advice.
      </p>
    </div>
  );
}

export function OpportunitiesView({ notices, feed, modes, election }: {
  notices: NoticeView[]; feed: Feed; modes: string[];
  election: { name: string; window: string } | null;
}) {
  const [search, setSearch] = useState('');
  const [mode, setMode] = useState<string>('All');
  const [mine, setMine] = useState<Category[]>([]);
  const [matchMine, setMatchMine] = useState(false);
  const [openOnly, setOpenOnly] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '[]') as Category[];
      if (Array.isArray(stored)) setMine(stored.filter(c => CATEGORIES.includes(c)));
    } catch { /* storage unavailable: no saved categories */ }
  }, []);

  const toggleMine = (c: Category) => setMine(prev => {
    const next = prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c];
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
    return next;
  });

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return notices.filter(n =>
      (mode === 'All' || n.lensMode === mode) &&
      (!openOnly || n.status === 'OPEN') &&
      (!matchMine || mine.length === 0 || mine.includes(n.category)) &&
      (!q || [n.title, n.procuringEntity, n.refNo, n.region ?? ''].some(v => v.toLowerCase().includes(q))));
  }, [matchMine, mine, mode, notices, openOnly, search]);

  const current = notices.find(n => n.refNo === selected) ?? null;

  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSelected(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected]);

  return (
    <div className="grid grid-cols-1 gap-x-10 pt-8 md:pt-12 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0">
        <div>
          <h1 className="max-w-[22ch] font-display text-[30px] font-medium leading-[1.12] tracking-[-0.01em] text-ink md:text-[40px]">
            What is open for bidding, and which rules apply
          </h1>

          {feed.kind === 'live' && (
            <p className="mt-4 max-w-[68ch] text-[14.5px] leading-relaxed text-ink-2">
              The newest notices published on PhilGEPS, from the last 7 days.{feed.lastSync ? ` Last read on ${feed.lastSync}.` : ''} Confirm
              dates and details on the original posting before you act on them.
            </p>
          )}
          {feed.kind === 'live' && feed.stale && (
            <p role="status" className="mt-4 max-w-[68ch] border-l-[3px] border-status-withdrawn-fg pl-4 text-[14.5px] leading-snug text-ink">
              <strong className="font-semibold">This list may be out of date.</strong> The last attempt to read PhilGEPS did not
              succeed. Check the original postings for current dates and status.
            </p>
          )}
          {feed.kind === 'sample' && (
            <p role="status" className="mt-4 max-w-[68ch] border-l-[3px] border-status-superseded-fg pl-4 text-[14.5px] leading-snug text-ink">
              <strong className="font-semibold">Sample data.</strong> {feed.note} The rules shown for each one are real.
            </p>
          )}
          {election && (
            <p role="note" className="mt-4 max-w-[68ch] border-l-[3px] border-status-superseded-fg pl-4 text-[14.5px] leading-snug text-ink">
              <strong className="font-semibold">Election period.</strong> {election.name} applies from {election.window}.
              Notices closing in that period are marked.
            </p>
          )}

          <div className="mt-8 flex flex-col gap-3">
            <div className="max-w-[760px] border-b-2 border-ink focus-within:border-accent">
              <label htmlFor="notice-search" className="sr-only">Search notices</label>
              <input id="notice-search" type="search" value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Search by title, entity, place or reference number"
                className="min-h-11 w-full bg-transparent font-display text-[18px] text-ink outline-none placeholder:text-muted" />
            </div>
            <div role="group" aria-label="Procurement mode" className="flex gap-1 overflow-x-auto">
              {['All', ...modes].map(m => (
                <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)} className={pill(mode === m)}>{m}</button>
              ))}
            </div>
            <fieldset className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[13.5px] text-ink">
              <legend className="sr-only">Filters</legend>
              <label className="inline-flex min-h-10 items-center gap-2">
                <input type="checkbox" checked={openOnly} onChange={e => setOpenOnly(e.target.checked)} className="h-4 w-4 accent-[#23408E]" />
                Open notices only
              </label>
              <label className="inline-flex min-h-10 items-center gap-2">
                <input type="checkbox" checked={matchMine} onChange={e => setMatchMine(e.target.checked)} className="h-4 w-4 accent-[#23408E]" />
                Match my categories
              </label>
              {matchMine && CATEGORIES.map(c => (
                <label key={c} className="inline-flex min-h-10 items-center gap-2 text-ink-2">
                  <input type="checkbox" checked={mine.includes(c)} onChange={() => toggleMine(c)} className="h-4 w-4 accent-[#23408E]" />
                  {c}
                </label>
              ))}
            </fieldset>
          </div>

          <p className="mt-5 text-[13.5px] text-muted" aria-live="polite">Showing {shown.length} of {notices.length} notices</p>
          {shown.length === 0 ? (
            <p className="mt-3 border-t border-line py-6 text-[15px] text-ink-2">
              No notice matches. Clear the search, or choose “All”.
            </p>
          ) : (
            <ul className="mt-3 border-b border-line">
              {shown.map(n => (
                <li key={n.refNo}>
                  <article className={`border-t py-5 ${selected === n.refNo ? 'border-t-2 border-accent' : 'border-line'}`}>
                    <h2 className="max-w-[60ch] font-display text-[19px] font-medium leading-snug text-ink">{n.title}</h2>
                    <p className="mt-1 text-[14px] text-ink-2">{n.procuringEntity}{n.region && !n.procuringEntity.toLowerCase().includes(n.region.toLowerCase()) ? `, ${n.region}` : ''}</p>
                    <p className="mt-2 text-[14px] leading-snug text-ink">
                      {n.abcLabel && <>Budget <span className="font-mono font-semibold">{n.abcLabel}</span>. </>}
                      Closes <span className="font-semibold">{n.closingLabel}</span>. {n.mode}, {n.category.toLowerCase()}.
                    </p>
                    <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className={`${tag} ${STATUS[n.status]}`}>{STATUS_LABEL[n.status]}</span>
                      {n.inElectionWindow && <span className={`${tag} ${BADGE['TIME-BOUND']}`}>Closes in the election period</span>}
                      <span className="font-mono text-[12.5px] text-muted">Reference {n.refNo}</span>
                    </p>
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-x-5 gap-y-1">
                      <SourceLine n={n} />
                      <div className="flex flex-wrap items-center gap-x-5">
                        <OriginalLink n={n} />
                        <button type="button" onClick={() => setSelected(n.refNo)} aria-haspopup="dialog"
                          className={`inline-flex min-h-10 items-center text-[13.5px] ${textLink}`}>
                          Show the rules
                        </button>
                      </div>
                    </div>
                  </article>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <aside aria-label="The rules for the chosen notice" className="hidden xl:block">
        <div className="sticky top-[84px] max-h-[calc(100dvh-100px)] overflow-y-auto border-l border-line pl-6">
          <RuleLens n={current} />
        </div>
      </aside>

      {current && (
        <div className="fixed inset-0 z-40 xl:hidden">
          <button type="button" aria-label="Close the rules" onClick={() => setSelected(null)} className="absolute inset-0 h-full w-full cursor-default bg-ink/30" />
          <div role="dialog" aria-modal="true" aria-label="The rules for the chosen notice"
            className="absolute inset-x-0 bottom-0 max-h-[88dvh] overflow-y-auto border-t border-line bg-surface px-5 py-5 shadow-sheet md:inset-x-auto md:inset-y-0 md:right-0 md:max-h-none md:w-[440px] md:border-l md:border-t-0">
            <RuleLens n={current} onClose={() => setSelected(null)} />
          </div>
        </div>
      )}
    </div>
  );
}
