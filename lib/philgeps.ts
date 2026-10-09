// Parsers for the public PhilGEPS "Open Opportunities" pages. Pure functions over HTML, tested against saved
// pages. No language model is involved: every value is read from a labelled field on the page.
import crypto from 'node:crypto';
import * as cheerio from 'cheerio';

export const PHILGEPS_BASE = 'https://notices.philgeps.gov.ph/GEPS/Tender/';
export const LISTING_URL = `${PHILGEPS_BASE}SplashOpenOpportunitiesUI.aspx?ClickFrom=OpenOpp&menuIndex=3`;
export const noticeUrl = (refNo: string) => `${PHILGEPS_BASE}SplashBidNoticeAbstractUI.aspx?menuIndex=3&refID=${refNo}&Result=3`;

export type ListingRow = { refNo: string; title: string; publishedAt: string; closingAt: string; businessCategory: string | null; procuringEntity: string | null };
export type NoticeDetail = {
  refNo: string; title: string; procuringEntity: string; areaOfDelivery: string | null; mode: string; classification: string;
  businessCategory: string | null; abc: number | null; status: string; publishedAt: string; closingAt: string;
};

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

/** "28/09/2026" → "2026-09-28". PhilGEPS writes dates day first. */
export function parseDate(s: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s.trim());
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
}

/** "12/10/2026 10:00 AM" → "2026-10-12T10:00:00+08:00". Times on PhilGEPS are Philippine time. */
export function parseDateTime(s: string): string | null {
  const date = parseDate(s);
  if (!date) return null;
  const t = /(\d{1,2}):(\d{2})\s*(AM|PM)/i.exec(s);
  if (!t) return `${date}T23:59:00+08:00`;
  let h = Number(t[1]) % 12;
  if (t[3].toUpperCase() === 'PM') h += 12;
  return `${date}T${String(h).padStart(2, '0')}:${t[2]}:00+08:00`;
}

export const parseAmount = (s: string): number | null => {
  const n = Number(s.replace(/[^0-9.]/g, ''));
  return s.trim() && Number.isFinite(n) && n > 0 ? n : null;
};

export function hiddenFields(html: string): Record<string, string> {
  const $ = cheerio.load(html);
  const out: Record<string, string> = {};
  $('input[type=hidden]').each((_, el) => { const n = $(el).attr('name'); if (n) out[n] = $(el).attr('value') ?? ''; });
  return out;
}

export function parseListing(html: string): { rows: ListingRow[]; total: number | null; pages: number } {
  const $ = cheerio.load(html);
  const rows: ListingRow[] = [];
  $('a[href*="SplashBidNoticeAbstractUI.aspx"]').each((_, a) => {
    const refNo = /refID=(\d+)/.exec($(a).attr('href') ?? '')?.[1];
    const cells = $(a).closest('tr').children('td');
    const publishedAt = parseDate(clean(cells.eq(1).text()));
    const closingAt = parseDateTime(clean(cells.eq(2).text()));
    if (!refNo || !publishedAt || !closingAt) return;
    // "<title> , <business category> ,<PROCURING ENTITY>"
    const tail = clean($(a).parent().find('span[id$="lblOrgAndBusCat"]').text()).replace(/^,\s*/, '');
    const cut = tail.indexOf(' ,');
    rows.push({
      refNo, title: clean($(a).text()), publishedAt, closingAt,
      businessCategory: cut >= 0 ? clean(tail.slice(0, cut)) || null : null,
      procuringEntity: cut >= 0 ? clean(tail.slice(cut + 2)) || null : clean(tail) || null,
    });
  });
  const total = /([\d,]+)\s*opportunities found/i.exec($.root().text().replace(/ /g, ' '))?.[1];
  return { rows, total: total ? Number(total.replace(/,/g, '')) : null, pages: $('select[name$="pageDropDownList"] option').length };
}

export function parseDetail(html: string): NoticeDetail | null {
  const $ = cheerio.load(html);
  const f = (id: string) => clean($(`#${id}`).text());
  const refNo = f('lblDisplayReferenceNo');
  const publishedAt = parseDate(f('lblDisplayDatePublish'));
  const closingAt = parseDateTime(f('lblDisplayCloseDateTime'));
  if (!/^\d+$/.test(refNo) || !publishedAt || !closingAt || !f('lblDisplayTitle')) return null;
  return {
    refNo, title: f('lblDisplayTitle'), procuringEntity: f('lblDisplayProcuringEntity'), areaOfDelivery: f('lblDisplayAOD') || null,
    mode: f('lblDisplayProcureMode') || 'Not stated', classification: f('lblDisplayClass'), businessCategory: f('lblDisplayCategory') || null,
    abc: parseAmount(f('lblDisplayBudget')), status: f('lblDisplayStatus') || 'Active', publishedAt, closingAt,
  };
}

/** PhilGEPS classification → the three categories used in the app. */
export function toCategory(classification: string): 'Goods' | 'Infrastructure' | 'Consulting' {
  if (/consult/i.test(classification)) return 'Consulting';
  if (/civil|infra|works/i.test(classification)) return 'Infrastructure';
  return 'Goods';
}

export function toStatus(status: string): 'OPEN' | 'CLOSED' | 'POSTPONED' | 'CANCELLED' | 'AWARDED' {
  if (/cancel/i.test(status)) return 'CANCELLED';
  if (/postpon/i.test(status)) return 'POSTPONED';
  if (/award/i.test(status)) return 'AWARDED';
  if (/clos|fail|expire/i.test(status)) return 'CLOSED';
  return 'OPEN';
}

export const hashOf = (d: NoticeDetail) => crypto.createHash('sha256').update(JSON.stringify(d)).digest('hex');
