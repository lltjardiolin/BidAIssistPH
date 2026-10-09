import { describe, expect, it } from 'vitest';
import { docsById } from '../lib/manifest';
import { MODES, activeElectionRule, effectiveStatus, feed, inElectionWindow, lensMode, notices, ruleLens, toView } from '../lib/opportunities';

const TODAY = '2026-09-28T00:00:00Z';

describe('notices', () => {
  it('OP-01: a notice either links to its original posting or is marked as a sample', () => {
    for (const n of notices) expect(n.sourceUrl !== null || n.sample, n.refNo).toBe(true);
  });

  it('sample notices cannot be mistaken for real postings', () => {
    if (feed.kind !== 'sample') return;
    for (const n of notices) {
      expect(n.refNo).toMatch(/^SAMPLE-/);
      expect(n.title).toMatch(/^Sample:/);
      expect(n.procuringEntity).toContain('(fictional)');
      expect(n.sourceUrl).toBeNull();
    }
  });

  it('shows a notice as closed once its closing date has passed', () => {
    expect(effectiveStatus({ status: 'OPEN', closingAt: '2026-09-26' }, TODAY)).toBe('CLOSED');
    expect(effectiveStatus({ status: 'OPEN', closingAt: '2026-09-28' }, TODAY)).toBe('OPEN');
    expect(effectiveStatus({ status: 'CANCELLED', closingAt: '2026-09-01' }, TODAY)).toBe('CANCELLED');
  });
});

describe('Rule Lens', () => {
  it('OP-02: governing rules are CURRENT or REFERENCE documents that are in the index', () => {
    for (const mode of MODES) {
      for (const r of ruleLens({ mode, closingAt: '2026-10-20' }, TODAY)) {
        const d = docsById.get(r.documentId)!;
        expect(d.ingest, r.documentId).not.toBe(false);
        expect(['WITHDRAWN', 'SUPERSEDED', 'PROPOSED']).not.toContain(d.status);
        if (r.role === 'governing') expect(['CURRENT', 'REFERENCE'], `${mode}: ${r.documentId}`).toContain(d.status);
      }
    }
  });

  it('OP-04: Res. 27-2019 is never a governing rule for a framework agreement', () => {
    const rows = ruleLens({ mode: 'Framework Agreement', closingAt: '2026-12-01' }, TODAY);
    expect(rows.find(r => r.documentId === 'GPPB-RES-12-2026')).toMatchObject({ role: 'governing', badge: 'BOARD' });
    expect(rows.find(r => r.documentId === 'GPPB-RES-27-2019')).toMatchObject({ role: 'context', badge: 'HISTORICAL' });
  });

  it('labels GPPB-TSO opinions as opinions', () => {
    const npm = ruleLens({ mode: 'Negotiated Procurement', closingAt: '2026-12-01' }, TODAY).find(r => r.documentId === 'GPPB-NPM-025-2026');
    expect(npm).toMatchObject({ badge: 'OPINION' });
    expect(npm?.note).toContain('not Board policy');
  });

  it('always starts from the current IRR, never the withdrawn edition', () => {
    for (const mode of [...MODES, 'Some Unknown Mode']) {
      const rows = ruleLens({ mode, closingAt: '2026-12-01' }, TODAY);
      expect(rows[0].documentId).toBe('RA12009-IRR-2025');
      expect(rows.map(r => r.documentId)).not.toContain('RA12009-IRR-2026-03-31-WITHDRAWN');
    }
  });
});

describe('OP-03: election period', () => {
  it('flags notices closing inside the period stated in Circular No. 09-2026', () => {
    expect(inElectionWindow({ closingAt: '2026-10-02' }, TODAY)).toBe(false);
    expect(inElectionWindow({ closingAt: '2026-10-03' }, TODAY)).toBe(true);
    expect(inElectionWindow({ closingAt: '2026-11-09' }, TODAY)).toBe(true);
    expect(inElectionWindow({ closingAt: '2026-11-10' }, TODAY)).toBe(false);
  });

  it('adds the circular to the lens only for those notices', () => {
    const ids = (closingAt: string) => ruleLens({ mode: 'Competitive Bidding', closingAt }, TODAY).map(r => r.documentId);
    expect(ids('2026-10-14')).toContain('GPPB-RES-20-2026');
    expect(ids('2026-11-16')).not.toContain('GPPB-RES-20-2026');
  });

  it('disappears once the circular has expired', () => {
    expect(activeElectionRule('2026-11-09T12:00:00Z')?.id).toBe('GPPB-RES-20-2026');
    expect(activeElectionRule('2026-11-10T00:00:00Z')).toBeNull();
    expect(inElectionWindow({ closingAt: '2026-10-14' }, '2026-11-10T00:00:00Z')).toBe(false);
  });
});

describe('Ask about this notice', () => {
  it('opens Research with a question about the mode, in the full-corpus scope', () => {
    const v = toView(notices[0], TODAY);
    const url = new URL(v.askUrl, 'http://x');
    expect(url.pathname).toBe('/');
    expect(url.searchParams.get('scope')).toBe('all');
    expect(url.searchParams.get('q')).toContain(v.lensMode);
  });
});

describe('PhilGEPS mode wording', () => {
  it.each([
    ['Public Bidding', 'Competitive Bidding'],
    ['Negotiated Procurement - Small Value Procurement (Sec. 53.9)', 'Small Value Procurement'],
    ['Negotiated Procurement - Two Failed Biddings (Sec. 53.1)', 'Negotiated Procurement'],
    ['Direct Contracting', 'Direct Contracting'],
    ['Limited Source Bidding', 'Limited Source Bidding'],
    ['Shopping', 'Other'],
    ['Not stated', 'Other'],
  ])('%s → %s', (philgeps, irr) => expect(lensMode(philgeps)).toBe(irr));

  it('does not claim a rule for a mode the IRR of RA 12009 does not name', () => {
    const rows = ruleLens({ mode: 'Shopping', closingAt: '2026-12-01' }, TODAY);
    expect(rows[0]).toMatchObject({ documentId: 'RA12009-IRR-2025', detail: 'Sec. 26 — Modes of Procurement' });
    expect(rows[0].note).toContain('not a heading in the IRR');
  });

  it('points every notice to the transitory circular, since PhilGEPS still uses RA 9184 section numbers', () => {
    for (const mode of ['Public Bidding', 'Shopping', 'Negotiated Procurement - Small Value Procurement (Sec. 53.9)'])
      expect(ruleLens({ mode, closingAt: '2026-12-01' }, TODAY).map(r => r.documentId)).toContain('GPPB-RES-05-2025');
  });
});
