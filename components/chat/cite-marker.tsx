'use client';

import type { Evidence } from '@/lib/types';

/** The small number in the text that points to a note in the margin. */
export function CiteMarker({ n, evidence, active, onSelect }: {
  n: number; evidence?: Evidence; active: boolean; onSelect: (n: number) => void;
}) {
  // Set like a footnote number in a law book: small, raised, in the accent ink.
  const base = 'relative -top-[0.45em] ml-[1px] rounded-[2px] px-[2px] font-sans text-[12.5px] font-semibold leading-none no-underline';
  // A number with no matching source is shown but does nothing; the check under the answer reports it.
  if (!evidence) return <span className={`${base} text-muted`} title="This source was not retrieved">{n}</span>;
  return (
    <a href={`#cite-${n}`} aria-label={`Source ${n}: ${evidence.reference.split(' — ')[0]}`}
      onClick={e => { e.preventDefault(); onSelect(n); }}
      className={`${base} ${active ? 'bg-accent text-white' : 'text-accent hover:bg-accent-tint'}`}>
      {n}
    </a>
  );
}
