import type { Status } from '@/lib/evidence-policy';
import type { Evidence } from '@/lib/types';

type Callout = { status: Status; title: string; body: string };

/** One notice per answer, for the most consequential status among its sources. */
export function pickCallout(evidence: Evidence[], mixedFrameworks: boolean): Callout | null {
  const first = (s: Status) => evidence.find(e => e.status === s);
  const name = (e: Evidence) => e.reference.split(' — ')[0];
  const withdrawn = first('WITHDRAWN');
  if (withdrawn) return { status: 'WITHDRAWN', title: 'A withdrawn document', body: `${name(withdrawn)} has been withdrawn. ${withdrawn.note ?? 'It must not be cited as the current rule.'}` };
  const superseded = first('SUPERSEDED');
  if (superseded) return { status: 'SUPERSEDED', title: 'A superseded document', body: `${name(superseded)} has been superseded. ${superseded.note ?? ''}`.trim() };
  const proposed = first('PROPOSED');
  if (proposed) return { status: 'PROPOSED', title: 'A bill, not a law', body: `${name(proposed)} is a proposal. It is not law unless an enactment record exists.` };
  const ranked = evidence.filter(e => !e.companion);
  if (ranked.length && ranked.every(e => e.status === 'HISTORICAL'))
    return { status: 'HISTORICAL', title: 'The earlier framework', body: 'These sources are from the RA 9184 era. RA 12009 is the current law; RA 9184 rules apply only where the transitory provisions say so.' };
  if (mixedFrameworks || (evidence.some(e => e.framework === 'RA9184') && evidence.some(e => e.framework === 'RA12009')))
    return { status: 'HISTORICAL', title: 'Two frameworks', body: 'This answer draws on RA 9184, which is historical, and RA 12009, which is current. Each note in the margin says which.' };
  if (ranked.length && ranked.every(e => e.label === 'INTERPRETIVE_ONLY'))
    return { status: 'REFERENCE', title: 'Opinions only', body: 'These are GPPB-TSO opinions or explanations. They show how the office has read the rules; they are not Board policy.' };
  return null;
}

const INK: Record<Status, string> = {
  CURRENT: 'border-status-current-fg', HISTORICAL: 'border-status-historical-fg', WITHDRAWN: 'border-status-withdrawn-fg',
  SUPERSEDED: 'border-status-superseded-fg', PROPOSED: 'border-status-proposed-fg', REFERENCE: 'border-status-reference-fg',
};

export function StatusCallout({ evidence, mixedFrameworks }: { evidence: Evidence[]; mixedFrameworks: boolean }) {
  const c = pickCallout(evidence, mixedFrameworks);
  if (!c) return null;
  return (
    <p role="note" className={`mb-5 max-w-[68ch] border-l-[3px] py-0.5 pl-4 text-[14.5px] leading-snug text-ink ${INK[c.status]}`}>
      <strong className="font-semibold">{c.title}.</strong> {c.body}
    </p>
  );
}
