// Extraction: locked local artifact → text per page. Never fetches anything: input is a file already in
// corpus/archive/. PDFs use the embedded text layer; pages without one (scans) fall back to OCR.
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import * as cheerio from 'cheerio';
import { extractText, getDocumentProxy } from 'unpdf';

const run = promisify(execFile);

export type Page = { page: number | null; text: string; ocr: boolean; confidence?: number };
export type Extracted = { pages: Page[]; method: 'pdf-text' | 'pdf-ocr' | 'pdf-mixed' | 'html' | 'image-ocr'; ocrPages: number };

/** A page with fewer characters than this has no usable text layer. */
const MIN_PAGE_CHARS = 120;
/** v2: 300 dpi greyscale, with a cleaned black-and-white retry for weak pages. v1 (200 dpi) entries are still read
 *  when no v2 exists, so the bump never forces a full re-OCR; scripts/ocr-upgrade.ts re-reads the weak ones. */
const CACHE_VERSION = 2;
const OCR_DPI = '300';
/** Below this confidence a page is read again from a median-filtered, thresholded image: photocopy shading and
 *  halftone margins otherwise read as stray characters (GPPB circulars of 1992–2011). */
export const CLEAN_RETRY_BELOW = 85;

type Worker = { recognize: (img: string | Buffer) => Promise<{ data: { text: string; confidence: number } }>; terminate: () => Promise<unknown> };
let worker: Worker | undefined;

async function getWorker(cacheDir: string): Promise<Worker> {
  if (!worker) {
    const { createWorker } = await import('tesseract.js');
    await fs.mkdir(cacheDir, { recursive: true });
    worker = (await createWorker('eng', 1, { cachePath: cacheDir })) as unknown as Worker;
  }
  return worker;
}

export async function closeExtractors() {
  await worker?.terminate();
  worker = undefined;
}

/** Below this confidence the page may be scanned sideways or upside down (landscape tables, annexes), so it is also
 *  read at 90/180/270 degrees. A turned reading wins only by ROTATE_MARGIN: smaller gains are noise read as noise. */
export const ROTATE_RETRY_BELOW = 70;
const ROTATE_MARGIN = 15;

/** Reads an image; a weak reading is retried on a cleaned copy and, if still weak, turned. The best reading wins. */
export async function recognizeBest(img: string | Buffer, cacheDir: string): Promise<{ text: string; confidence: number }> {
  const w = await getWorker(cacheDir);
  const { default: sharp } = await import('sharp');
  const read = async (deg: number) => {
    const turned = deg ? await sharp(img).rotate(deg).png().toBuffer() : img;
    const { data } = await w.recognize(turned);
    if (data.confidence >= CLEAN_RETRY_BELOW) return data;
    const { data: retry } = await w.recognize(await sharp(turned).greyscale().median(3).threshold(140).png().toBuffer());
    return retry.confidence > data.confidence ? retry : data;
  };
  let best = await read(0);
  const upright = best.confidence;
  if (upright < ROTATE_RETRY_BELOW) {
    for (const deg of [90, 180, 270]) {
      const r = await read(deg);
      if (r.confidence >= upright + ROTATE_MARGIN && r.confidence > best.confidence) best = r;
    }
  }
  return { text: best.text, confidence: best.confidence };
}

export async function ocrPage(pdfPath: string, page: number, cacheDir: string): Promise<{ text: string; confidence: number }> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'bid-ocr-'));
  try {
    // Requires poppler-utils (pdftoppm) on the maintainer machine. Ingestion-only; never runs on Vercel.
    await run('pdftoppm', ['-r', OCR_DPI, '-gray', '-png', '-f', String(page), '-l', String(page), pdfPath, path.join(tmp, 'p')]);
    const [png] = await fs.readdir(tmp);
    if (!png) throw new Error(`pdftoppm produced no image for page ${page}`);
    return await recognizeBest(path.join(tmp, png), cacheDir);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

/** A text layer that splits words into letters ("i n t h e"), as some Distiller-made PDFs do, is unusable. */
export function isLetterSpaced(text: string): boolean {
  const tokens = text.split(/\s+/).filter(Boolean);
  if (tokens.length < 40) return false;
  return tokens.filter(t => /^\p{L}$/u.test(t)).length / tokens.length > 0.3;
}

async function extractPdf(file: string, tessCache: string): Promise<Extracted> {
  const pdf = await getDocumentProxy(new Uint8Array(await fs.readFile(file)));
  const { text } = await extractText(pdf, { mergePages: false });
  const pages: Page[] = [];
  let ocrPages = 0;
  for (const [i, t] of (text as string[]).entries()) {
    const spaced = isLetterSpaced(t);
    if (t.trim().length >= MIN_PAGE_CHARS && !spaced) { pages.push({ page: i + 1, text: t, ocr: false }); continue; }
    const o = await ocrPage(file, i + 1, tessCache);
    ocrPages++;
    // Keep whichever is longer: a near-empty page (a signature block, a divider) may OCR to nothing. A letter-spaced
    // layer is always longer than its OCR, so there the OCR wins whenever it read a real page.
    const useOcr = spaced ? o.text.trim().length >= MIN_PAGE_CHARS : o.text.trim().length > t.trim().length;
    pages.push(useOcr
      ? { page: i + 1, text: o.text, ocr: true, confidence: o.confidence }
      : { page: i + 1, text: t, ocr: false });
  }
  const method = ocrPages === 0 ? 'pdf-text' : ocrPages === pages.length ? 'pdf-ocr' : 'pdf-mixed';
  return { pages, method, ocrPages };
}

/** HTML → text of the content container only, so navigation menus are never indexed as law. */
export function htmlToText(buf: Buffer): string {
  const charset = /charset=["']?([\w-]+)/i.exec(buf.subarray(0, 2000).toString('latin1'))?.[1] ?? 'utf-8';
  const $ = cheerio.load(new TextDecoder(charset).decode(buf));
  $('script,style,noscript,nav,form,iframe,header,footer,aside').remove();
  $('[class*="share"],[class*="social"],[class*="sidebar"],[class*="breadcrumb"]').remove();
  $('br').replaceWith('\n');
  $('p,div,li,tr,td,h1,h2,h3,h4,h5,h6,blockquote').each((_, el) => { $(el).append('\n'); });
  const container = ['.entry-content', 'article', 'main', '#content', 'body'].find(s => $(s).first().text().trim().length > 200) ?? 'body';
  return $(container).first().text()
    .replace(/[ \t ]+/g, ' ')
    .split('\n').map(l => l.trim())
    .filter(l => l && !/^(Facebook\d*Tweet\d*|#WeMakeThingsHappen|Share this|Posted in\b)/i.test(l))
    .join('\n');
}

export async function extractArtifact(
  file: string,
  opts: { contentType: string; sha256: string; cacheDir: string },
): Promise<Extracted> {
  const cached = await readCachedExtraction(opts.cacheDir, opts.sha256);
  if (cached) return cached;

  let out: Extracted;
  if (opts.contentType === 'application/pdf') out = await extractPdf(file, path.join(opts.cacheDir, 'tessdata'));
  else if (opts.contentType.startsWith('image/')) {
    // A scanned page posted as a picture (some executive issuances are JPGs).
    const o = await recognizeBest(file, path.join(opts.cacheDir, 'tessdata'));
    out = { pages: [{ page: 1, text: o.text, ocr: true, confidence: o.confidence }], method: 'image-ocr', ocrPages: 1 };
  }
  else if (opts.contentType.includes('html')) out = { pages: [{ page: null, text: htmlToText(await fs.readFile(file)), ocr: false }], method: 'html', ocrPages: 0 };
  else throw new Error(`Unsupported content type ${opts.contentType} for ${file}`);

  await writeCachedExtraction(opts.cacheDir, opts.sha256, out);
  return out;
}

/** Newest cache entry for an artifact: v2 if present, else the v1 (200 dpi) entry. Never overwritten by a lower version. */
export async function readCachedExtraction(cacheDir: string, sha256: string): Promise<Extracted | null> {
  for (let v = CACHE_VERSION; v >= 1; v--) {
    try { return JSON.parse(await fs.readFile(path.join(cacheDir, `${sha256}.v${v}.json`), 'utf8')) as Extracted; } catch { /* next */ }
  }
  return null;
}

// Keyed by artifact hash: changed bytes → new hash → fresh extraction.
export async function writeCachedExtraction(cacheDir: string, sha256: string, out: Extracted) {
  await fs.mkdir(cacheDir, { recursive: true });
  await fs.writeFile(path.join(cacheDir, `${sha256}.v${CACHE_VERSION}.json`), JSON.stringify(out));
}
