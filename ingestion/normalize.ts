// Normalization: strip running headers/footers and page numbers, repair hyphenation, keep page numbers.
import type { Page } from './extract';

export type Line = { text: string; page: number | null };

const PAGE_NUMBER = /^(?:page\s+)?\d{1,4}(?:\s*(?:of|\/)\s*\d{1,4})?$/i;
/** Table-of-contents entry: "Section 1. Short Title ........ 10". Indexing these creates empty sections. */
const TOC_ENTRY = /(?:\.\s?){4,}\s*\d{1,4}$/;
const MIN_LINES_FOR_EDGES = 8;
const key = (s: string) => s.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();

export function normalize(pages: Page[]): Line[] {
  const perPage = pages.map(p => ({
    page: p.page,
    lines: p.text.split('\n').map(l => l.replace(/[ \t ]+/g, ' ').trim()).filter(l => l && !TOC_ENTRY.test(l)),
  }));

  // A line that opens or closes at least 40% of the pages is a running header/footer. Only pages long enough
  // to have a body between their edges are counted, so short pages can never lose their content.
  const edge = new Map<string, number>();
  const full = perPage.filter(p => p.lines.length >= MIN_LINES_FOR_EDGES);
  if (full.length >= 5) {
    for (const p of full) {
      const seen = new Set([...p.lines.slice(0, 2), ...p.lines.slice(-2)].map(key));
      for (const k of seen) edge.set(k, (edge.get(k) ?? 0) + 1);
    }
  }
  const repeated = new Set([...edge].filter(([k, n]) => k.length > 3 && n >= full.length * 0.4).map(([k]) => k));

  const out: Line[] = [];
  for (const p of perPage) {
    p.lines.forEach((text, i) => {
      const atEdge = i < 2 || i >= p.lines.length - 2;
      if (atEdge && PAGE_NUMBER.test(text)) return;
      if (atEdge && p.lines.length >= MIN_LINES_FOR_EDGES && repeated.has(key(text))) return;
      const prev = out[out.length - 1];
      // "procure-\nment" → "procurement"; keeps real compounds such as "government-\nowned" hyphenated.
      if (prev && /[a-z]{2}-$/.test(prev.text) && /^[a-z]/.test(text) && !/\b(non|co|pre|self|re|government|and\/or)-$/i.test(prev.text)) {
        const [head, ...rest] = text.split(' ');
        prev.text = prev.text.slice(0, -1) + head;
        if (rest.length) out.push({ text: rest.join(' '), page: p.page });
        return;
      }
      out.push({ text, page: p.page });
    });
  }
  return out;
}
