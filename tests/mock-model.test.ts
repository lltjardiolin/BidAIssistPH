import { describe, expect, it } from 'vitest';
import { checkCitations } from '../lib/citations';
import { ABSTAIN_MESSAGE } from '../lib/evidence-policy';
import { composeExtractiveAnswer } from '../lib/mock-model';
import { formatEvidenceForModel } from '../lib/retrieval';
import type { Evidence, RetrievalResult } from '../lib/types';

const e = (o: Partial<Evidence>): Evidence => ({
  n: 1, id: 'c1', documentId: 'D', reference: 'GPPB-TSO Public Advisory No. 09-2026 — Withdrawal of IRR 1st Edition', status: 'CURRENT',
  framework: 'RA12009', authority: 3, kind: 'advisory', label: 'CURRENT_RULE', section: null, page: null, issuingBody: 'GPPB-TSO',
  dateLabel: 'issued 31 Jul 2026', note: null, sourceUrl: null, companion: false,
  text: 'The 1st Edition previously issued by the GPPB-TSO has been withdrawn and should no longer be used as reference.', ...o,
});
const result = (evidence: Evidence[]): RetrievalResult => ({
  abstain: false, reason: null, scope: 'all', corpusVersion: '2026-09-28', evidence,
  flags: { mixedFrameworks: false, hasProposal: false, hasOpinion: false, hasHistoricalOpinion: false, hasVersionEvidence: true },
});

describe('evidence blocks → mock answer', () => {
  it('round-trips the model-facing format and cites every quote', () => {
    const blocks = formatEvidenceForModel(result([
      e({}),
      e({ n: 2, id: 'c2', reference: 'IRR of RA 12009 (1st Edition, as of 31 March 2026)', status: 'WITHDRAWN', label: 'VERSION_ONLY',
        note: 'Withdrawn by GPPB-TSO Public Advisory No. 09-2026 on 31 Jul 2026.', text: 'Section 1. This IRR is promulgated pursuant to Section 112 of the Act.' }),
    ]));
    expect(blocks).toContain('STATUS: WITHDRAWN');
    expect(blocks).toContain('USE AS: VERSION_ONLY');
    const answer = composeExtractiveAnswer(blocks);
    expect(answer).toContain('[E1]');
    expect(answer).toMatch(/1st Edition.* is withdrawn and must not be cited as the current rule.*\[E2\]/);
    expect(checkCitations(answer, 2)).toMatchObject({ cited: [1, 2], invalid: [] });
  });

  it('abstains when the gate returned no eligible evidence', () => {
    const blocks = formatEvidenceForModel({ abstain: true, reason: 'no-eligible-evidence', scope: 'bills', corpusVersion: 'x', flags: null, evidence: [] });
    expect(blocks).toContain('All data');
    expect(composeExtractiveAnswer(blocks)).toBe(ABSTAIN_MESSAGE);
  });
});
