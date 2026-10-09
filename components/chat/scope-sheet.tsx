'use client';

import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { SCOPES, SCOPE_KEYS, type ScopeKey } from '@/lib/scopes';

/** On a phone, the seven choices open as a list. */
export function ScopeSheet({ open, scope, counts, onChange, onClose }: {
  open: boolean; scope: ScopeKey; counts: Record<ScopeKey, number>; onChange: (s: ScopeKey) => void; onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog ref={ref} onClose={onClose} onClick={e => { if (e.target === ref.current) onClose(); }} aria-labelledby="scope-sheet-title"
      className="m-0 mt-auto w-full max-w-none border-t border-line bg-surface p-0 text-ink shadow-sheet backdrop:bg-ink/40">
      <div className="px-4 pb-5 pt-5">
        <h2 id="scope-sheet-title" className="font-display text-[22px] font-medium">Search in</h2>
        <fieldset className="mt-2">
          <legend className="sr-only">Choose which documents to search</legend>
          <ul>
            {SCOPE_KEYS.map(k => (
              <li key={k} className="border-b border-line last:border-b-0">
                <label className="flex min-h-12 cursor-pointer items-start gap-3 py-3">
                  <input type="radio" name="scope" value={k} checked={scope === k} onChange={() => { onChange(k); onClose(); }} className="mt-0.5 h-5 w-5 accent-[#5B2A86]" />
                  <span className="flex-1">
                    <span className="block text-[15.5px] font-semibold">{SCOPES[k].label} <span className="font-mono text-[13px] font-normal text-muted">{counts[k]}</span></span>
                    <span className="block text-[13.5px] leading-snug text-ink-2">{SCOPES[k].note}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
        <Button variant="secondary" size="lg" className="mt-3 w-full" onClick={onClose}>Close</Button>
      </div>
    </dialog>
  );
}
