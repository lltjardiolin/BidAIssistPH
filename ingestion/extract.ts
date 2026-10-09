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
export type Extracted = { pages: Page[]; method: 'pdf-text' | 'pdf-ocr' | 'pdf-mixed' | 'html'; ocrPages: number };

/** A page with fewer characters than this has no usable text layer. */
const MIN_PAGE_CHARS = 120;
const CACHE_VERSION = 1;

type Worker = { recognize: (img: string) => Promise<{ data: { text: string; confidence: number } }>; terminate: () => Promise<unknown> };
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

async function ocrPage(pdfPath: string, page: number, cacheDir: string): Promise<{ text: string; confidence: number }> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'bid-ocr-'));
  try {
    // Requires poppler-utils (pdftoppm) on the maintainer machine. Ingestion-only; never runs on Vercel.
    await run('pdftoppm', ['-r', '200', '-png', '-f', String(page), '-l', String(page), pdfPath, path.join(tmp, 'p')]);
    const [png] = await fs.readdir(tmp);
    if (!png) throw new Error(`pdftoppm produced no image for page ${page}`);
    const { data } = await (await getWorker(cacheDir)).recognize(path.join(tmp, png));
    return { text: data.text, confidence: data.confidence };
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

async function extractPdf(file: string, tessCache: string): Promise<Extracted> {
  const pdf = await getDocumentProxy(new Uint8Array(await fs.readFile(file)));
  const { text } = await extractText(pdf, { mergePages: false });
  const pages: Page[] = [];
  let ocrPages = 0;
  for (const [i, t] of (text as string[]).entries()) {
    if (t.trim().length >= MIN_PAGE_CHARS) { pages.push({ page: i + 1, text: t, ocr: false }); continue; }
    const o = await ocrPage(file, i + 1, tessCache);
    ocrPages++;
    // Keep whichever is longer: a near-empty page (a signature block, a divider) may OCR to nothing.
    pages.push(o.text.trim().length > t.trim().length
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
  const cacheFile = path.join(opts.cacheDir, `${opts.sha256}.v${CACHE_VERSION}.json`);
  try { return JSON.parse(await fs.readFile(cacheFile, 'utf8')) as Extracted; } catch { /* not cached */ }

  let out: Extracted;
  if (opts.contentType === 'application/pdf') out = await extractPdf(file, path.join(opts.cacheDir, 'tessdata'));
  else if (opts.contentType.includes('html')) out = { pages: [{ page: null, text: htmlToText(await fs.readFile(file)), ocr: false }], method: 'html', ocrPages: 0 };
  else throw new Error(`Unsupported content type ${opts.contentType} for ${file}`);

  // Keyed by artifact hash: changed bytes → new hash → fresh extraction.
  await fs.mkdir(opts.cacheDir, { recursive: true });
  await fs.writeFile(cacheFile, JSON.stringify(out));
  return out;
}
