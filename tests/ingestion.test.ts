import { describe, expect, it } from 'vitest';
import { chunkSections } from '../ingestion/chunk';
import { htmlToText } from '../ingestion/extract';
import { normalize } from '../ingestion/normalize';
import { matchHeading, sectionize } from '../ingestion/sectionize';

const page = (n: number, text: string) => ({ page: n, text, ocr: false });

describe('normalize', () => {
  it('removes page numbers and running headers, keeps page attribution', () => {
    const topics = ['planning', 'posting', 'eligibility', 'evaluation', 'award'];
    const body = (n: number) => Array.from({ length: 8 }, (_, i) => `${n}.${i + 1} Rules on ${topics[n - 1]}, item ${'abcdefgh'[i]}.`);
    const pages = [1, 2, 3, 4, 5].map(n => page(n, ['IRR of RA 12009', ...body(n), 'GPPB Technical Support Office', String(n)].join('\n')));
    const lines = normalize(pages);
    expect(lines.map(l => l.text)).toEqual([1, 2, 3, 4, 5].flatMap(body));
    expect(lines.filter(l => l.text.startsWith('3.')).every(l => l.page === 3)).toBe(true);
  });

  it('never strips the body of short pages that look alike', () => {
    const pages = [1, 2, 3, 4, 5, 6].map(n => page(n, `Annex ${n}\nForm ${n} is prescribed.`));
    expect(normalize(pages)).toHaveLength(12);
  });

  it('repairs hyphenation across lines but keeps real compounds', () => {
    expect(normalize([page(1, 'the procure-\nment process')]).map(l => l.text)).toEqual(['the procurement', 'process']);
    expect(normalize([page(1, 'a government-\nowned corporation')]).map(l => l.text)).toEqual(['a government-', 'owned corporation']);
  });

  it('drops table-of-contents entries', () => {
    expect(normalize([page(1, 'Section 1. Short Title ............ 10\nSection 1. Short Title')]).map(l => l.text)).toEqual(['Section 1. Short Title']);
  });
});

describe('sectionize', () => {
  it('recognises statute and guideline headings', () => {
    expect(matchHeading('Section 26. Modes of Procurement')).toMatchObject({ level: 2, section: 'Sec. 26', title: 'Modes of Procurement' });
    expect(matchHeading('Section 1. Short Title. - This Act shall be known as the "NGPA".')).toMatchObject({ section: 'Sec. 1', title: 'Short Title' });
    expect(matchHeading('RULE IV')).toMatchObject({ level: 1, label: 'Rule IV', takesTitleLine: true });
    expect(matchHeading('4.0 DOCUMENTARY REQUIREMENTS')).toMatchObject({ level: 2, section: 'Item 4' });
  });

  it('does not mistake running text for a heading', () => {
    expect(matchHeading('Section 32.1 of the IRR provides that the Procuring Entity')).toBeNull();
    expect(matchHeading('Section 32 of the IRR allows Direct Acquisition')).toBeNull();
    expect(matchHeading('WHEREAS, Republic Act No. 12009 took effect')).toBeNull();
  });

  it('builds a Rule › Section path and resets the section under a new rule', () => {
    const lines = normalize([page(40, [
      'Section 25. Maintenance, Update, and Backup', '25.1 The PhilGEPS shall undertake periodic maintenance and upgrading of the system.',
      'RULE IV', 'MODES OF PROCUREMENT',
      'Section 26. Modes of Procurement', '26.1 The Procuring Entity shall adopt any of the following modes of procurement.',
    ].join('\n'))]);
    const s = sectionize(lines);
    expect(s.map(x => x.section)).toEqual(['Sec. 25', 'Sec. 26']);
    expect(s[1].path).toEqual(['Rule IV — Modes of Procurement', 'Sec. 26 — Modes of Procurement']);
    expect(s[1].lines[0].text).toBe('RULE IV');
  });
});

describe('chunkSections', () => {
  const long = Array.from({ length: 120 }, (_, i) => ({ text: `${i + 1}. The procuring entity shall comply with requirement number ${i + 1}.`, page: 1 + Math.floor(i / 30) }));
  const section = { path: ['Rule I'], section: 'Sec. 1', heading: 'Scope', page: 1, lines: long };

  it('keeps a short section whole', () => {
    const c = chunkSections([{ ...section, lines: long.slice(0, 5) }], { maxTokens: 900, overlapTokens: 150, mode: 'section' });
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ section: 'Sec. 1', part: 1, parts: 1 });
  });

  it('splits a long section within the size limit, with overlap and page tracking', () => {
    const c = chunkSections([section], { maxTokens: 300, overlapTokens: 50, mode: 'section' });
    expect(c.length).toBeGreaterThan(3);
    for (const ch of c) expect(ch.text.length).toBeLessThanOrEqual(1200);
    // Overlap: each chunk opens with lines that closed the previous one, within the overlap budget.
    for (let i = 1; i < c.length; i++) {
      const opening = c[i].text.split('\n')[0];
      const tail = c[i - 1].text.slice(-200);
      expect(tail).toContain(opening);
    }
    expect(c.at(-1)!.page).toBeGreaterThan(c[0].page!);
    expect(c.every(ch => ch.section === 'Sec. 1')).toBe(true);
  });

  it('never loses text', () => {
    const c = chunkSections([section], { maxTokens: 300, overlapTokens: 50, mode: 'section' });
    const all = c.map(ch => ch.text).join('\n');
    for (const l of long) expect(all).toContain(l.text);
  });
});

describe('htmlToText', () => {
  it('indexes the content container only, never navigation or share widgets', () => {
    const html = `<html><head><meta charset="utf-8"><title>x</title></head><body>
      <nav><a href="/">Home</a><a href="/resolutions">Resolutions</a></nav>
      <div class="entry-content"><p>The 1st Edition has been withdrawn and should no longer be used as reference. ${'Stakeholders are advised accordingly. '.repeat(8)}</p>
      <p>#WeMakeThingsHappen</p><div class="social-share">Facebook0Tweet0</div></div>
      <footer>Contact us</footer></body></html>`;
    const t = htmlToText(Buffer.from(html));
    expect(t).toContain('has been withdrawn');
    expect(t).not.toMatch(/Home|Resolutions|Contact us|WeMakeThingsHappen|Facebook/);
  });
});
