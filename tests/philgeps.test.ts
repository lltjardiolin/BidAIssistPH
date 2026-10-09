import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { hiddenFields, noticeUrl, parseAmount, parseDate, parseDateTime, parseDetail, parseListing, toCategory, toStatus } from '../lib/philgeps';

const fixture = (f: string) => fs.readFileSync(path.join(import.meta.dirname, 'fixtures', f), 'utf8');

describe('PhilGEPS listing page', () => {
  const listing = parseListing(fixture('philgeps-search.html'));

  it('reads every notice on the page', () => {
    expect(listing.rows).toHaveLength(20);
    expect(listing.total).toBe(11083);
    expect(listing.pages).toBe(555);
  });

  it('reads reference number, dates, title, category and entity', () => {
    expect(listing.rows[1]).toEqual({
      refNo: '13217328', publishedAt: '2026-09-28', closingAt: '2026-10-12T10:00:00+08:00',
      title: expect.stringContaining('Georesistivity Test'), businessCategory: 'Surveying Services',
      procuringEntity: 'MUNICIPALITY OF TUMAUINI, ISABELA',
    });
  });

  it('is sorted newest first, which the sync relies on to stop early', () => {
    const dates = listing.rows.map(r => r.publishedAt);
    expect([...dates].sort().reverse()).toEqual(dates);
  });

  it('finds the form fields needed to turn the page', () => {
    expect(Object.keys(hiddenFields(fixture('philgeps-search.html')))).toEqual(expect.arrayContaining(['__VIEWSTATE', '__EVENTVALIDATION']));
  });
});

describe('PhilGEPS notice page', () => {
  const d = parseDetail(fixture('philgeps-detail.html'));

  it('reads the labelled fields', () => {
    expect(d).toMatchObject({
      refNo: '13217328', procuringEntity: 'MUNICIPALITY OF TUMAUINI, ISABELA', areaOfDelivery: 'Isabela', mode: 'Public Bidding',
      classification: 'Consulting Services', businessCategory: 'Surveying Services', abc: 810000, status: 'Active',
      publishedAt: '2026-09-28', closingAt: '2026-10-12T10:00:00+08:00',
    });
  });

  it('does not carry personal details', () => {
    expect(Object.keys(d!)).not.toEqual(expect.arrayContaining(['contactPerson', 'createdBy']));
  });

  it('returns nothing for a page that is not a notice', () => {
    expect(parseDetail('<html><body>Server Error</body></html>')).toBeNull();
    expect(parseDetail(fixture('philgeps-search.html'))).toBeNull();
  });
});

describe('field parsing', () => {
  it('reads day-first dates and Philippine time', () => {
    expect(parseDate('01/10/2026')).toBe('2026-10-01');
    expect(parseDateTime('01/10/2026 05:00 PM')).toBe('2026-10-01T17:00:00+08:00');
    expect(parseDateTime('01/10/2026 12:00 AM')).toBe('2026-10-01T00:00:00+08:00');
    expect(parseDateTime('01/10/2026 12:30 PM')).toBe('2026-10-01T12:30:00+08:00');
    expect(parseDate('soon')).toBeNull();
  });

  it('reads amounts and ignores empty ones', () => {
    expect(parseAmount('810,000.00')).toBe(810000);
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('0.00')).toBeNull();
  });

  it('maps classification and status', () => {
    expect(toCategory('Consulting Services')).toBe('Consulting');
    expect(toCategory('Civil Works')).toBe('Infrastructure');
    expect(toCategory('Goods')).toBe('Goods');
    expect(toStatus('Active')).toBe('OPEN');
    expect(toStatus('Cancelled')).toBe('CANCELLED');
  });

  it('links every notice to its original posting', () => {
    expect(noticeUrl('13217328')).toBe('https://notices.philgeps.gov.ph/GEPS/Tender/SplashBidNoticeAbstractUI.aspx?menuIndex=3&refID=13217328&Result=3');
  });
});
