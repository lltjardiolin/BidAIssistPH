'use client';

import { useRef } from 'react';
import { SCOPES, SCOPE_KEYS, type ScopeKey } from '@/lib/scopes';

/** Which documents to search. Plain words in a row; the count is part of the word, not a badge. */
export function ScopeTabs({ scope, counts, onChange }: {
  scope: ScopeKey; counts: Record<ScopeKey, number>; onChange: (s: ScopeKey) => void;
}) {
  const refs = useRef<Partial<Record<ScopeKey, HTMLButtonElement | null>>>({});
  const move = (to: number) => {
    const key = SCOPE_KEYS[(to + SCOPE_KEYS.length) % SCOPE_KEYS.length];
    onChange(key);
    refs.current[key]?.focus();
  };
  const onKey = (e: React.KeyboardEvent, i: number) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); move(i + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); move(i - 1); }
    else if (e.key === 'Home') { e.preventDefault(); move(0); }
    else if (e.key === 'End') { e.preventDefault(); move(SCOPE_KEYS.length - 1); }
  };
  return (
    <div>
      <div className="flex items-baseline gap-4 overflow-x-auto">
        <span id="scope-label" className="shrink-0 text-[14px] text-muted">Search in</span>
        <div role="tablist" aria-labelledby="scope-label" className="flex shrink-0 gap-1">
          {SCOPE_KEYS.map((k, i) => {
            const active = k === scope;
            return (
              <button key={k} ref={el => { refs.current[k] = el; }} role="tab" type="button" id={`scope-tab-${k}`}
                aria-selected={active} aria-controls="conversation" tabIndex={active ? 0 : -1}
                onClick={() => onChange(k)} onKeyDown={e => onKey(e, i)}
                className={`min-h-10 shrink-0 border-b-2 px-2 text-[14.5px] ${
                  active ? 'border-accent font-semibold text-ink' : 'border-transparent text-ink-2 hover:text-ink'}`}>
                {SCOPES[k].label}
                <span className={`ml-1.5 font-mono text-[12.5px] ${active ? 'text-accent' : 'text-muted'}`}>{counts[k]}<span className="sr-only"> documents</span></span>
              </button>
            );
          })}
        </div>
      </div>
      <p className="mt-1.5 text-[13px] text-muted">{SCOPES[scope].note}</p>
    </div>
  );
}
