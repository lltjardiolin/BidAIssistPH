'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';

export const MAX_QUESTION_CHARS = 2000;

export function Composer({ onAsk, busy, onStop, focusKey, draft = '', placeholder = 'Ask about a rule, a document or a version' }: {
  onAsk: (text: string) => void; busy: boolean; onStop: () => void; focusKey: number; draft?: string; placeholder?: string;
}) {
  const [value, setValue] = useState('');
  useEffect(() => { if (draft) setValue(draft.slice(0, MAX_QUESTION_CHARS)); }, [draft]);
  const ref = useRef<HTMLTextAreaElement>(null);

  // Grows from one line to six.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 6 * 28 + 4)}px`;
  }, [value]);

  useEffect(() => { if (focusKey > 0) ref.current?.focus(); }, [focusKey]);

  const submit = () => {
    const text = value.trim();
    if (!text || busy) return;
    onAsk(text);
    setValue('');
  };

  return (
    <form onSubmit={e => { e.preventDefault(); submit(); }}
      className="flex items-end gap-3 border-b-2 border-ink pb-2 focus-within:border-accent">
      <label htmlFor="question" className="sr-only">Your question about Philippine procurement law</label>
      <textarea
        id="question" ref={ref} rows={1} value={value} maxLength={MAX_QUESTION_CHARS} placeholder={placeholder}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }}
        className="min-h-[36px] flex-1 resize-none bg-transparent py-1 font-display text-[19px] leading-7 text-ink outline-none placeholder:text-muted"
      />
      {busy
        ? <Button variant="secondary" size="lg" onClick={onStop}>Stop</Button>
        : <Button type="submit" size="lg" disabled={!value.trim()}>Ask</Button>}
    </form>
  );
}
