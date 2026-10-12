import { describe, expect, it } from 'vitest';
import { applyEvidencePolicy, type Evidence } from '../lib/evidence-policy';

const ev = (o: Partial<Evidence> & { id: string }): Evidence => ({
  documentId: o.id, status: 'CURRENT', framework: 'RA12009', authorityLevel: 2, text: 't', ...o,
});
const WITHDRAWN = ev({ id: 'w', documentId: 'IRR-2026', status: 'WITHDRAWN', withdrawnBy: 'ADV-09' });
const ADVISORY = ev({ id: 'a', documentId: 'ADV-09', authorityLevel: 3 });

describe('applyEvidencePolicy', () => {
  it('abstains on zero evidence', () => {
    expect(applyEvidencePolicy([])).toMatchObject({ abstain: true, reason: 'no-eligible-evidence' });
  });

  it('drops withdrawn evidence whose replacement was not retrieved', () => {
    const r = applyEvidencePolicy([WITHDRAWN, ev({ id: 'c', documentId: 'IRR-2025' })]);
    expect(r.abstain).toBe(false);
    expect(r.eligible.map(e => e.id)).toEqual(['c']);
  });

  it('abstains when only an orphaned withdrawn block was retrieved', () => {
    expect(applyEvidencePolicy([WITHDRAWN])).toMatchObject({ abstain: true, reason: 'no-eligible-evidence' });
  });

  it('keeps withdrawn evidence next to its withdrawal record, labelled VERSION_ONLY', () => {
    const r = applyEvidencePolicy([WITHDRAWN, ADVISORY]);
    expect(r.abstain).toBe(false);
    if (r.abstain) return;
    expect(r.labels).toEqual({ w: 'VERSION_ONLY', a: 'CURRENT_RULE' });
    expect(r.flags.hasVersionEvidence).toBe(true);
  });

  it('never lets a withdrawn block be labelled as the current rule', () => {
    const r = applyEvidencePolicy([WITHDRAWN, ADVISORY]);
    if (r.abstain) throw new Error('unexpected abstention');
    for (const e of r.eligible) if (e.status === 'WITHDRAWN') expect(r.labels[e.id]).not.toBe('CURRENT_RULE');
  });

  it('abstains when every surviving block is version-only', () => {
    const a = ev({ id: 's1', documentId: 'A', status: 'SUPERSEDED', supersededBy: 'B' });
    const b = ev({ id: 's2', documentId: 'B', status: 'SUPERSEDED' });
    expect(applyEvidencePolicy([a, b])).toMatchObject({ abstain: true, reason: 'only-version-evidence' });
  });

  it('labels bills, opinions and historical documents', () => {
    const r = applyEvidencePolicy([
      ev({ id: 'bill', status: 'PROPOSED', authorityLevel: 1 }),
      ev({ id: 'npm', status: 'REFERENCE', authorityLevel: 4 }),
      ev({ id: 'old', status: 'HISTORICAL', framework: 'RA9184', authorityLevel: 3 }),
      ev({ id: 'oldnpm', status: 'HISTORICAL', framework: 'RA9184', authorityLevel: 4 }),
    ]);
    if (r.abstain) throw new Error('unexpected abstention');
    expect(r.labels).toEqual({ bill: 'PROPOSAL_ONLY', npm: 'INTERPRETIVE_ONLY', old: 'HISTORICAL_ONLY', oldnpm: 'HISTORICAL_OPINION' });
    expect(r.flags).toMatchObject({ hasProposal: true, hasOpinion: true, hasHistoricalOpinion: true });
  });

  it('flags mixed frameworks instead of abstaining, and not at all when comparing', () => {
    const mixed = [ev({ id: 'new' }), ev({ id: 'old', status: 'HISTORICAL', framework: 'RA9184' })];
    const plain = applyEvidencePolicy(mixed);
    const compare = applyEvidencePolicy(mixed, { compare: true });
    if (plain.abstain || compare.abstain) throw new Error('unexpected abstention');
    expect(plain.flags.mixedFrameworks).toBe(true);
    expect(compare.flags.mixedFrameworks).toBe(false);
  });
});
