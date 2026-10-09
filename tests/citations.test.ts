import { describe, expect, it } from 'vitest';
import { checkCitations, normalizeCitations } from '../lib/citations';
import { ABSTAIN_MESSAGE } from '../lib/evidence-policy';

describe('checkCitations', () => {
  it('passes a fully cited answer', () => {
    const c = checkCitations('The IRR took effect on 25 Feb 2025 [E1]. The withdrawn edition must not be cited [E2].', 2);
    expect(c).toMatchObject({ cited: [1, 2], invalid: [], uncited: 0, partiallyVerified: false });
  });

  it('flags a citation that was never retrieved', () => {
    const c = checkCitations('The rule requires three quotations [E7].', 3);
    expect(c.invalid).toEqual([7]);
    expect(c.partiallyVerified).toBe(true);
  });

  it('flags answers where more than 20% of claims are uncited', () => {
    const c = checkCitations('The BAC shall post the notice within 7 days. The threshold is required by Section 5. The forms are mandatory [E1].', 2);
    expect(c.claims).toBe(3);
    expect(c.uncited).toBe(2);
    expect(c.partiallyVerified).toBe(true);
  });

  it('marks a claim-bearing answer with no valid citation as unverified', () => {
    expect(checkCitations('The law requires competitive bidding for all goods.', 4)).toMatchObject({ unverified: true, partiallyVerified: true });
    expect(checkCitations('Procurement must halt during the election period.', 7)).toMatchObject({ unverified: true });
    expect(checkCitations('The rule requires three quotations [E9].', 3)).toMatchObject({ unverified: true, invalid: [9] });
    expect(checkCitations('The IRR took effect on 25 Feb 2025 [E1].', 2)).toMatchObject({ unverified: false, partiallyVerified: false });
  });

  it('does not split on abbreviations such as "Sec." or "No."', () => {
    const c = checkCitations('Under Sec. 113 of RA No. 12009, ongoing procurement shall continue under RA 9184 [E1].', 1);
    expect(c.claims).toBe(1);
    expect(c.uncited).toBe(0);
  });

  it('treats the abstention sentence as verified', () => {
    expect(checkCitations(ABSTAIN_MESSAGE, 0)).toMatchObject({ abstained: true, partiallyVerified: false });
  });
});

describe('normalizeCitations', () => {
  it.each([
    ['withdrawn (E1).', 'withdrawn [E1].'],
    ['effective 25 Feb 2025 (E1 and E2).', 'effective 25 Feb 2025 [E1] [E2].'],
    ['as stated [E1, E3]', 'as stated [E1] [E3]'],
    ['already fine [E2][E3]', 'already fine [E2][E3]'],
    ['Section E1 of the form (see E-filing)', 'Section E1 of the form (see E-filing)'],
  ])('%s', (input, expected) => {
    expect(normalizeCitations(input)).toBe(expected);
  });

  it('lets a parenthesised citation count as a citation', () => {
    expect(checkCitations('The March 31, 2026 IRR has been withdrawn (E1).', 4)).toMatchObject({ cited: [1], unverified: false });
  });
});
