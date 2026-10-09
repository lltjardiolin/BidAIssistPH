import { KIND_LABEL } from '@/lib/status';
import type { Evidence } from '@/lib/types';
import { Stamp } from './status-badge';

export const noteId = (messageId: string, n: number) => `note-${messageId}-${n}`;

const FRAMEWORK: Record<string, string> = { RA12009: 'under RA 12009', RA9184: 'under RA 9184', BOTH: 'covering RA 9184 and RA 12009' };

/** A source, written in the margin beside the text that cites it. */
export function MarginNote({ e, messageId, active, fresh = false, compact = false }: {
  e: Evidence; messageId: string; active: boolean; fresh?: boolean; compact?: boolean;
}) {
  const [name, ...rest] = e.reference.split(' — ');
  const where = [e.section, e.page ? `page ${e.page}` : null].filter(Boolean).join(', ');
  return (
    <article id={noteId(messageId, e.n)} aria-label={`Source ${e.n}: ${name}`}
      className={`relative pt-1 text-[13.5px] leading-[1.45] ${active ? 'before:absolute before:-left-[25px] before:top-0 before:h-full before:w-[3px] before:bg-accent max-xl:before:-left-[18px]' : ''}`}>
      <Stamp status={e.status} fresh={fresh} />
      <p className="mt-2 font-semibold text-ink">
        <span className="font-mono text-accent">{e.n}</span>&ensp;{name}
      </p>
      {!compact && rest.length > 0 && <p className="text-ink-2">{rest.join(' — ')}</p>}
      {!compact && (
        <p className="mt-1 text-[12.5px] text-muted">
          {KIND_LABEL[e.kind] ?? e.kind} {FRAMEWORK[e.framework] ?? ''}{where ? `. ${where}` : ''}{e.dateLabel ? `. ${e.dateLabel[0].toUpperCase()}${e.dateLabel.slice(1)}` : ''}.
        </p>
      )}
      {!compact && e.note && <p className="mt-1.5 text-[12.5px] text-ink">{e.note}</p>}
      {!compact && e.label === 'INTERPRETIVE_ONLY' && <p className="mt-1.5 text-[12.5px] text-ink">An opinion or explanation, not Board policy.</p>}
      {!compact && (
        <details className="mt-1.5 text-[12.5px]">
          <summary className="inline cursor-pointer select-none font-medium text-accent underline decoration-accent/30 underline-offset-2 hover:decoration-accent">
            Read the passage
          </summary>
          <p className="mt-2 max-h-64 overflow-y-auto whitespace-pre-line border-l-2 border-line-strong pl-3 font-display text-[13.5px] leading-relaxed text-ink-2">
            {e.text}
          </p>
        </details>
      )}
      {!compact && e.sourceUrl && (
        <a href={e.sourceUrl} target="_blank" rel="noopener noreferrer"
          className="mt-1 inline-block text-[12.5px] font-medium text-accent underline decoration-accent/30 underline-offset-2 hover:decoration-accent">
          Open the original<span className="sr-only"> (opens in a new tab)</span>
        </a>
      )}
    </article>
  );
}
