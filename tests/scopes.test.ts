import { describe, expect, it } from 'vitest';
import { manifest } from '../lib/manifest';
import { inScope, scopeCounts } from '../lib/scope-counts';
import { SCOPE_KEYS, scopeFilter } from '../lib/scopes';
import { lexicalText } from '../lib/retrieval';

describe('scopes', () => {
  it('excludes withdrawn and superseded documents from every tab except their own (D2)', () => {
    const nonDefault = manifest.documents.filter(d => d.status === 'WITHDRAWN' || d.status === 'SUPERSEDED');
    expect(nonDefault.length).toBeGreaterThan(0);
    for (const d of nonDefault) {
      expect(d.index_default).toBe(false);
      for (const k of SCOPE_KEYS) expect(inScope(d, k)).toBe(k === 'versions');
    }
  });

  it('builds SQL with the default-pool guard and correctly numbered parameters', () => {
    expect(scopeFilter('all', 5)).toEqual({
      sql: 'c.index_default = true and c.status = any($5::text[])',
      params: [['CURRENT', 'HISTORICAL', 'REFERENCE', 'PROPOSED']],
    });
    expect(scopeFilter('issuances', 5).sql).toBe('c.index_default = true and c.doc_type = any($5::text[]) and c.framework = $6');
    expect(scopeFilter('versions', 5).sql).not.toContain('index_default');
  });

  it('counts only indexed documents', () => {
    expect(scopeCounts.ngpa).toBe(2);
    expect(scopeCounts.versions).toBe(1);
    expect(scopeCounts.opinions).toBeGreaterThanOrEqual(30);
    expect(scopeCounts.all).toBeGreaterThan(scopeCounts.issuances);
  });
});

describe('lexicalText', () => {
  it('drops English and Filipino function words, keeps identifiers', () => {
    expect(lexicalText('What are the documents for negotiated procurement?')).toBe('documents negotiated procurement');
    expect(lexicalText('Ano ang mga dokumento para sa negotiated procurement?')).toBe('dokumento negotiated procurement');
    expect(lexicalText('Is Res. 10-2026 current?')).toBe('res. 10-2026 current');
  });
});

describe('query helpers', () => {
  it('appends the terms the issuances use, for Filipino and everyday English', async () => {
    const { expandQuery } = await import('../lib/retrieval');
    expect(expandQuery('Ano ang mga dokumento para sa negotiated procurement?')).toContain('documents documentary requirements');
    expect(expandQuery('What documents do I need?')).toBe('What documents do I need? (documentary requirements)');
    expect(expandQuery('What are the modes of procurement?')).toBe('What are the modes of procurement?');
    expect(expandQuery('What are the documentary requirements?')).toBe('What are the documentary requirements?');
  });

  it('scores title overlap by stem', async () => {
    const { titleOverlap } = await import('../lib/retrieval');
    expect(titleOverlap('documents for negotiated procurement', 'Documentary requirements for specific modes › Negotiated Procurement')).toBe(1);
    expect(titleOverlap('framework agreement guidelines', 'Beneficial Ownership Information Registry')).toBe(0);
  });
});

describe('rate limit client address', () => {
  it('counts from the right so a forged X-Forwarded-For cannot dodge the limit', async () => {
    const { clientIp } = await import('../lib/rate-limit');
    expect(clientIp(new Headers({ 'x-forwarded-for': '203.0.113.9' }))).toBe('203.0.113.9');
    expect(clientIp(new Headers({ 'x-forwarded-for': '1.1.1.1, 8.8.8.8, 203.0.113.9' }))).toBe('203.0.113.9');
    expect(clientIp(new Headers({ 'x-real-ip': '203.0.113.9' }))).toBe('203.0.113.9');
    expect(clientIp(new Headers())).toBe('unknown');
  });
});

describe('focusPassage', () => {
  const text = [
    'Item 1 — Purpose. This circular sets out general matters.',
    'Item 2 — Coverage. It applies to all procuring entities.',
    'Item 3 — Definitions. Terms have the meanings given in the IRR.',
    'Item 4 — Negotiated procurement requires the following documents: mayor\'s permit and PhilGEPS registration.',
    'Item 5 — Effectivity. This takes effect fifteen days after publication.',
  ].join('\n');

  it('returns the whole passage when it fits or when no limit is set', async () => {
    const { focusPassage } = await import('../lib/retrieval');
    expect(focusPassage(text, 'documents', 0)).toBe(text);
    expect(focusPassage(text, 'documents', 10_000)).toBe(text);
  });

  it('keeps the lines that match the question, verbatim, and marks what was left out', async () => {
    const { focusPassage } = await import('../lib/retrieval');
    const out = focusPassage(text, 'What documents are required for negotiated procurement?', 200);
    expect(out).toContain('Negotiated procurement requires the following documents');
    expect(out.length).toBeLessThanOrEqual(210);
    expect(out.startsWith('… ')).toBe(true);
    for (const line of out.replace(/^… /, '').replace(/ …$/, '').split('\n')) expect(text).toContain(line);
  });
});
