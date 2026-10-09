import type { Status } from '@/lib/evidence-policy';

/** A document's status, as a rubber stamp. The word is always there; the colour only repeats it. */
export function Stamp({ status, flat = false, fresh = false }: { status: Status; flat?: boolean; fresh?: boolean }) {
  return (
    <span className="stamp" data-status={status} data-flat={flat ? '' : undefined} data-fresh={fresh ? '' : undefined}>
      {status}
    </span>
  );
}

/** In tables and lists the stamp sits straight. */
export function StatusBadge({ status }: { status: Status }) {
  return <Stamp status={status} flat />;
}
