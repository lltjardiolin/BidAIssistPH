// Chunker (PDR B6): section-aware by default; long sections are split at line boundaries with overlap.
// CHUNK_MODE=fixed ignores section boundaries — used only for evaluation experiments A and B.
import type { Line } from './normalize';
import type { Section } from './sectionize';

export type Chunk = {
  path: string[];
  section: string | null;
  heading: string | null;
  page: number | null;
  text: string;
  part: number;   // 1-based part within a long section
  parts: number;
};

export type ChunkOptions = { maxTokens: number; overlapTokens: number; mode: 'section' | 'fixed' };

export const chunkOptionsFromEnv = (): ChunkOptions => ({
  maxTokens: Number(process.env.CHUNK_MAX_TOKENS || 900),
  overlapTokens: Number(process.env.CHUNK_OVERLAP_TOKENS || 150),
  mode: process.env.CHUNK_MODE === 'fixed' ? 'fixed' : 'section',
});

/** ~4 characters per token for English legal text; good enough to size chunks. */
export const estimateTokens = (s: string) => Math.ceil(s.length / 4);

function split(lines: Line[], o: ChunkOptions): Array<{ text: string; page: number | null }> {
  const max = o.maxTokens * 4;
  const overlap = o.overlapTokens * 4;
  // A single line longer than the limit (HTML paragraphs, OCR without line breaks) is cut at sentence ends.
  const units: Line[] = lines.flatMap(l => {
    if (l.text.length <= max) return [l];
    const parts = l.text.match(new RegExp(`.{1,${max}}(?:[.;:]\\s|\\s|$)`, 'gs')) ?? [l.text];
    return parts.map(text => ({ text: text.trim(), page: l.page }));
  });

  const out: Array<{ text: string; page: number | null }> = [];
  let buf: Line[] = [];
  let size = 0;
  for (const u of units) {
    if (size + u.text.length + 1 > max && buf.length) {
      out.push({ text: buf.map(b => b.text).join('\n'), page: buf[0].page });
      const keep: Line[] = [];
      let kept = 0;
      for (let i = buf.length - 1; i >= 0 && kept + buf[i].text.length <= overlap; i--) { keep.unshift(buf[i]); kept += buf[i].text.length + 1; }
      buf = keep;
      size = kept;
    }
    buf.push(u);
    size += u.text.length + 1;
  }
  if (buf.length) out.push({ text: buf.map(b => b.text).join('\n'), page: buf[0].page });
  return out;
}

export function chunkSections(sections: Section[], o: ChunkOptions = chunkOptionsFromEnv()): Chunk[] {
  if (o.mode === 'fixed') {
    const pieces = split(sections.flatMap(s => s.lines), o);
    return pieces.map((p, i) => ({ path: [], section: null, heading: null, page: p.page, text: p.text, part: i + 1, parts: pieces.length }));
  }
  return sections.flatMap(s => {
    const pieces = split(s.lines, o).filter(p => p.text.trim().length >= 40);
    return pieces.map((p, i) => ({ path: s.path, section: s.section, heading: s.heading, page: p.page, text: p.text, part: i + 1, parts: pieces.length }));
  });
}
