// Sectionizer: Part › Rule/Article/Annex › Section. Headings are detected per line, so a provision is
// never split from the heading that names it.
import type { Line } from './normalize';

export type Section = {
  path: string[];            // ["Rule IV — Modes of Procurement", "Sec. 26 — Modes of Procurement"]
  section: string | null;    // "Sec. 26"
  heading: string | null;    // "Modes of Procurement"
  page: number | null;
  lines: Line[];
};

type Heading = { level: 0 | 1 | 2; label: string; title: string | null; section: string | null; takesTitleLine: boolean };

const CAPS_TITLE = /^[A-Z][A-Z0-9 ,.'’&/()\-–:]{2,90}$/;
const titleCase = (s: string) => s.toLowerCase().replace(/(^|[\s\-/(])([a-z])/g, (_, a, b) => a + b.toUpperCase())
  .replace(/\b(Of|And|The|In|On|For|To|Or|By|With|A|An)\b/g, m => m.toLowerCase()).replace(/^./, c => c.toUpperCase());

export function matchHeading(text: string): Heading | null {
  let m: RegExpExecArray | null;
  if ((m = /^(PART|BOOK|VOLUME)\s+([IVXLC]+|\d+)\b[.:\s–-]*(.*)$/.exec(text)) && text.length <= 100)
    return { level: 0, label: `${titleCase(m[1])} ${m[2]}`, title: m[3] ? titleCase(m[3]) : null, section: null, takesTitleLine: !m[3] };
  if ((m = /^(RULE|CHAPTER|ARTICLE|TITLE)\s+([IVXLC]+|\d+)\b[.:\s–-]*(.*)$/.exec(text)) && text.length <= 100)
    return { level: 1, label: `${titleCase(m[1])} ${m[2]}`, title: m[3] ? titleCase(m[3]) : null, section: null, takesTitleLine: !m[3] };
  if ((m = /^(ANNEX|APPENDIX)\s+["“]?([A-Z]|\d{1,2})["”]?\b[.:\s–-]*(.*)$/.exec(text)) && text.length <= 100)
    return { level: 1, label: `${titleCase(m[1])} ${m[2]}`, title: m[3] ? titleCase(m[3]) : null, section: null, takesTitleLine: !m[3] };
  // "Section 26. Modes of Procurement" / "SEC. 4. Scope" — the period after the number separates it from
  // running text such as "Section 32.1 of the IRR".
  if ((m = /^(?:Section|SECTION|Sec\.|SEC\.)\s+(\d{1,3}[A-Za-z]?)\.(?!\d)\s*(.*)$/.exec(text))) {
    const title = m[2].split(/\.\s*[-–—]|\s[-–—]\s/)[0].replace(/[.\s]+$/, '');
    if (!title || /^[A-Z"“]/.test(title))
      return { level: 2, label: `Sec. ${m[1]}`, title: title && title.length <= 120 ? title : null, section: `Sec. ${m[1]}`, takesTitleLine: false };
  }
  // Circular/guideline style: "1.0 PURPOSE", "4. GENERAL GUIDELINES"
  if ((m = /^(\d{1,2})\.(?:0)?\s+([A-Z][A-Z ,&/()\-–]{3,80})$/.exec(text)))
    return { level: 2, label: `Item ${m[1]}`, title: titleCase(m[2]), section: `Item ${m[1]}`, takesTitleLine: false };
  if (/^(WHEREAS|NOW,? THEREFORE)\b/.test(text)) return null;
  return null;
}

export function sectionize(lines: Line[]): Section[] {
  const sections: Section[] = [];
  const stack: Array<string | null> = [null, null, null];
  let cur: Section = { path: [], section: null, heading: null, page: lines[0]?.page ?? null, lines: [] };
  const push = () => { if (cur.lines.length) sections.push(cur); };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const h = matchHeading(line.text);
    if (!h) { cur.lines.push(line); continue; }

    let title = h.title;
    const headingLines = [line];
    // "RULE IV" followed by its title on the next line ("MODES OF PROCUREMENT").
    const next = lines[i + 1];
    if (h.takesTitleLine && next && CAPS_TITLE.test(next.text) && !matchHeading(next.text)) {
      title = titleCase(next.text);
      headingLines.push(next);
      i++;
    }
    push();
    const name = title ? `${h.label} — ${title}` : h.label;
    stack[h.level] = name;
    for (let l = h.level + 1; l < stack.length; l++) stack[l] = null;
    cur = {
      path: stack.filter((s): s is string => !!s),
      section: h.section, heading: title, page: line.page,
      lines: [...headingLines],
    };
  }
  push();

  // A heading with no body of its own ("RULE IV / MODES OF PROCUREMENT") is folded into what follows.
  const out: Section[] = [];
  let carry: Line[] = [];
  for (const s of sections) {
    const body = s.lines.map(l => l.text).join(' ');
    if (body.length < 80 && s.section === null && s.path.length) { carry.push(...s.lines); continue; }
    out.push(carry.length ? { ...s, page: carry[0].page ?? s.page, lines: [...carry, ...s.lines] } : s);
    carry = [];
  }
  if (carry.length) {
    if (out.length) out[out.length - 1].lines.push(...carry);
    else out.push({ path: [], section: null, heading: null, page: carry[0].page, lines: carry });
  }
  return out;
}
