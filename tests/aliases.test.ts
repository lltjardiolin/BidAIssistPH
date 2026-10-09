import { describe, expect, it } from 'vitest';
import { extractTokens, normalizeAliases } from '../lib/aliases';

describe('extractTokens', () => {
  it.each([
    ['HB 7917', 'HB07917'], ['HB 07917', 'HB07917'], ['House Bill No. 7917', 'HB07917'], ['HB No. 07917', 'HB07917'],
    ['R.A. 12009', 'RA12009'], ['RA12009', 'RA12009'], ['Republic Act No. 12009', 'RA12009'], ['RA No. 9184', 'RA9184'],
    ['Resolution No. 10-2026', 'RES-10-2026'], ['Res 10-2026', 'RES-10-2026'], ['Res. 3-2025', 'RES-03-2025'],
    ['Circular No. 06-2026', 'CIRC-06-2026'], ['Circ. 6-2026', 'CIRC-06-2026'],
    ['Public Advisory No. 09-2026', 'ADV-09-2026'], ['Adv. 09-2026', 'ADV-09-2026'],
    ['NPM No. 019-2026', 'NPM-019-2026'], ['NPM 19-2026', 'NPM-019-2026'],
    ['Sec. 113', 'SEC113'], ['Section 113', 'SEC113'], ['Section 32.1', 'SEC32'], ['Rule IV', 'RULE-IV'],
  ])('%s → %s', (input, token) => {
    expect(extractTokens(input)).toContain(token);
  });

  it('does not read a resolution number as a section or an act', () => {
    expect(extractTokens('GPPB Resolution No. 10-2026')).toEqual(['RES-10-2026']);
  });

  it('extracts every identifier in a sentence', () => {
    expect(extractTokens('Under Sec. 113 of RA 12009, as clarified by Circular No. 01-2025').sort())
      .toEqual(['CIRC-01-2025', 'RA12009', 'SEC113']);
  });
});

describe('normalizeAliases', () => {
  it('resolves every spelling of HB 07917 to the same document (FR-06)', () => {
    for (const q of ['Is HB 7917 law?', 'Is HB 07917 law?', 'House Bill No. 7917 status', 'HB No. 07917'])
      expect(normalizeAliases(q).ids).toContain('HB07917');
  });

  it('resolves phrase aliases', () => {
    expect(normalizeAliases('What is the NGPA?').ids).toContain('RA12009');
    expect(normalizeAliases('what is the new government procurement act').ids).toContain('RA12009');
    expect(normalizeAliases('Should we still use the March 2026 IRR?').ids).toContain('RA12009-IRR-2026-03-31-WITHDRAWN');
    expect(normalizeAliases('framework agreement guidelines').ids).toContain('GPPB-RES-12-2026');
  });

  it('recognises the withdrawn edition however the date is written', () => {
    for (const q of ['Is the March 31, 2026 IRR still valid?', 'Is the 31 March 2026 IRR current?', 'Was the Mar. 31, 2026 IRR withdrawn?',
      'Can I cite the IRR 1st Edition?', 'What should I cite instead of the March 2026 IRR?'])
      expect(normalizeAliases(q).ids, q).toContain('RA12009-IRR-2026-03-31-WITHDRAWN');
  });

  it('does not treat other dates as the withdrawn edition', () => {
    expect(normalizeAliases('When did the IRR take effect in February 2025?').ids).not.toContain('RA12009-IRR-2026-03-31-WITHDRAWN');
  });

  it('maps a circular to the resolution that issued it', () => {
    expect(normalizeAliases('What does Circular No. 06-2026 require?').ids).toEqual(['GPPB-RES-10-2026']);
    expect(normalizeAliases('Circ. 04-2026 tie-breaking').ids).toContain('GPPB-RES-08-2026');
  });

  it('maps an opinion number to its own document', () => {
    expect(normalizeAliases('NPM 19-2026').ids).toEqual(['GPPB-NPM-019-2026']);
  });

  it('does not match alias phrases inside other words', () => {
    expect(normalizeAliases('What is the programme budget?').ids).toEqual([]);
  });

  it('keeps section tokens for reranking', () => {
    expect(normalizeAliases('What does Sec. 113 of RA 12009 say?')).toMatchObject({ sections: ['SEC113'], ids: ['RA12009'] });
  });
});
