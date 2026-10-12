// Maintainer-only. Reads GPPB's public index pages and appends every issuance not yet in the manifest:
// non-policy matter opinions, policy matter opinions, resolutions, circulars and public advisories.
// Existing entries are never changed; a document already present (same id or same URL) is skipped.
//
// Usage: node scripts/catalog-gppb.mjs [--dry-run]
// Then:  node scripts/download-corpus.mjs <new ids>   (the ids are written to storage/logs/catalog-new-ids.txt)
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cheerio from 'cheerio';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = path.join(ROOT, 'corpus', 'manifest.json');
const DRY = process.argv.includes('--dry-run');
const BASE = 'https://www.gppb.gov.ph';
const TODAY = new Date().toISOString().slice(0, 10);
// RA 12009 took effect on 13 August 2024 and its IRR on 25 February 2025; issuances from 2025 on are NGPA-era.
const NGPA_FROM = '2025-01-01';

const manifest = JSON.parse(await fs.readFile(MANIFEST, 'utf8'));
const ids = new Set(manifest.documents.map(d => d.id));
const urls = new Set();
const aliases = new Set();
for (const d of manifest.documents) {
  for (const v of Object.values(d)) {
    if (typeof v === 'string' && v.startsWith('http')) urls.add(norm(v));
    else if (Array.isArray(v)) v.forEach(x => typeof x === 'string' && x.startsWith('http') && urls.add(norm(x)));
    else if (v && typeof v === 'object') Object.values(v).forEach(x => typeof x === 'string' && x.startsWith('http') && urls.add(norm(x)));
  }
  (d.aliases ?? []).forEach(a => aliases.add(a.toLowerCase()));
}

function norm(u) { return u.replace(/^http:/, 'https:').replace(/\/$/, '').toLowerCase(); }
// Some index rows still point at the retired beta.gppb.gov.ph host; the same files are served from www.
const abs = u => new URL(u, BASE).href.replace('://beta.gppb.gov.ph/', '://www.gppb.gov.ph/');
// NFKC turns decorative Unicode (e.g. mathematical bold letters in post titles) into plain, searchable text.
const clean = s => s.normalize('NFKC').replace(/\s+/g, ' ').trim();
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function get(url) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': 'BidAIssistPH-CorpusBuilder/1.1 (maintainer corpus build)' } });
      if (r.ok) return cheerio.load(await r.text());
      if (r.status === 404) return null;
    } catch { /* retry */ }
    await sleep(2000 * (i + 1));
  }
  throw new Error(`Could not fetch ${url}`);
}

const MONTHS = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };
/** "14 August 2026", "August 14, 2026", "03/20/2015" → "2026-08-14"; anything else → null. */
function isoDate(s) {
  if (!s) return null;
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s.trim());
  if (m) return m[0];
  m = /(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/.exec(s);
  if (m && MONTHS[m[2].toLowerCase()]) return `${m[3]}-${String(MONTHS[m[2].toLowerCase()]).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = /([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/.exec(s);
  if (m && MONTHS[m[1].toLowerCase()]) return `${m[3]}-${String(MONTHS[m[1].toLowerCase()]).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  m = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  return null;
}

const mentionsNgpa = s => /12009|New Government Procurement Act|\bNGPA\b/i.test(s);
function framework(date, year, text) {
  if (mentionsNgpa(text)) return 'RA12009';
  if (date) return date >= NGPA_FROM ? 'RA12009' : 'RA9184';
  return Number(year) >= 2025 ? 'RA12009' : 'RA9184';
}

const added = [];
const originalIds = new Set(ids);
/** A second document listed under the same number (e.g. NPM 037-2004 and 037-2004-B) gets the next letter. */
function uniqueId(id) {
  if (!ids.has(id) || originalIds.has(id)) return id;
  for (const suffix of 'BCDEFGH') if (!ids.has(`${id}-${suffix}`)) return `${id}-${suffix}`;
  return id;
}
const skipped = { id: 0, url: 0 };
function add(doc, sourceUrls) {
  doc.id = uniqueId(doc.id);
  if (ids.has(doc.id)) { skipped.id++; return; }
  if (sourceUrls.some(u => urls.has(norm(u)))) { skipped.url++; return; }
  doc.aliases = [...new Set(doc.aliases)].filter(a => !aliases.has(a.toLowerCase()));
  doc.aliases.forEach(a => aliases.add(a.toLowerCase()));
  sourceUrls.forEach(u => urls.add(norm(u)));
  ids.add(doc.id);
  added.push(doc);
}

function rows($) {
  return $('tr').toArray().map(tr => ({
    cells: $(tr).find('td').toArray().map(td => clean($(td).text())),
    links: $(tr).find('a[href]').toArray().map(a => abs($(a).attr('href'))),
  })).filter(r => r.cells.length >= 2);
}

// ---- Non-policy matter opinions (GPPB-TSO) -------------------------------------------------------------
{
  const $ = await get(`${BASE}/non-policy-matter/`);
  for (const r of rows($)) {
    const pdf = r.links.find(l => /\.pdf($|\?)/i.test(l));
    const m = /NPM\s*No\.?\s*0*(\d+)\s*-?\s*([A-Z]?)\s*-\s*(\d{4})/i.exec(r.cells[0]);
    if (!pdf || !m) continue;
    const num = m[1].padStart(3, '0') + m[2].toUpperCase(), year = m[3];
    const fw = framework(null, year, `${r.cells[1]}`);
    const applicability = r.cells[3] || null;
    add({
      id: `GPPB-NPM-${num}-${year}`,
      reference: `GPPB-TSO NPM No. ${num}-${year} — ${r.cells[1]}`,
      aliases: [`NPM ${num}-${year}`, `NPM No. ${num}-${year}`, `NPM ${Number(m[1])}${m[2].toUpperCase()}-${year}`],
      type: 'opinion', framework: fw, status: fw === 'RA12009' ? 'REFERENCE' : 'HISTORICAL',
      authority_level: 4, issuing_body: 'GPPB-TSO',
      date_approved: null, date_published: null, effective_date: null,
      source_url: pdf,
      verification: `index-listed (GPPB non-policy-matter page, catalogued ${TODAY})`,
      requesting_entity: r.cells[2] && r.cells[2] !== '–' ? r.cells[2] : null,
      applicability,
      parent_id: year === '2026' ? 'GPPB-NPM-2026' : undefined,
      ingest: true, ingest_fields: ['source_url'],
    }, [pdf]);
  }
}

// ---- Policy matter opinions (GPPB Board), one HTML page each -------------------------------------------
{
  const $ = await get(`${BASE}/policy-matter/`);
  for (const r of rows($)) {
    const m = /PM\s*No\.?\s*0*(\d+)\s*-\s*(\d{4})/i.exec(r.cells[0]);
    const page = r.links.find(l => l.startsWith(BASE)) ?? null;
    if (!m) continue;
    const num = m[1].padStart(3, '0'), year = m[2];
    let posted = null;
    if (page) {
      const $p = await get(page);
      posted = $p ? isoDate(clean($p('.entry-meta, .posted-on, time').first().text()) || clean($p('body').text()).match(/Posted on ([A-Za-z]+ \d{1,2}, \d{4})/)?.[1]) : null;
      await sleep(750);
    }
    add({
      id: `GPPB-PM-${num}-${year}`,
      reference: `GPPB Policy Matter Opinion No. ${num}-${year} — ${r.cells[1]}`,
      aliases: [`PM ${num}-${year}`, `PM No. ${num}-${year}`],
      type: 'opinion', framework: framework(posted, year, r.cells[1]), status: 'HISTORICAL',
      authority_level: 3, issuing_body: 'GPPB',
      date_approved: null, date_published: posted, effective_date: null,
      source_url: page,
      verification: `index-listed (GPPB policy-matter page, catalogued ${TODAY})`,
      requesting_entity: r.cells[2] || null,
      ingest: !!page, ...(page ? { ingest_fields: ['source_url'] } : { ingest_blocker: 'no page linked from the policy-matter index' }),
    }, page ? [page] : []);
  }
}

// ---- Resolutions and circulars --------------------------------------------------------------------------
for (const [kind, url, prefix, label] of [
  ['resolution', `${BASE}/resolutions/`, 'GPPB-RES', 'GPPB Resolution No.'],
  ['circular', `${BASE}/circulars/`, 'GPPB-CIRC', 'GPPB Circular No.'],
]) {
  const $ = await get(url);
  for (const r of rows($)) {
    const m = /No\.?\s*0*(\d+)\s*-\s*(\d{4})/i.exec(r.cells[0]);
    const pdfs = [...new Set(r.links.filter(l => /\.pdf($|\?)/i.test(l)))];
    if (!m || !pdfs.length) continue;
    const num = m[1].padStart(2, '0'), year = m[2];
    const approved = isoDate(r.cells[2]), published = isoDate(r.cells[3]);
    const fw = framework(approved ?? published, year, r.cells[1]);
    const doc = {
      id: `${prefix}-${num}-${year}`,
      reference: `${label} ${num}-${year} — ${r.cells[1]}`,
      aliases: kind === 'resolution' ? [`Resolution No. ${num}-${year}`, `GPPB Resolution No. ${num}-${year}`, `Res. ${num}-${year}`]
        : [`Circular No. ${num}-${year}`, `GPPB Circular No. ${num}-${year}`],
      type: kind, framework: fw, status: fw === 'RA12009' ? 'CURRENT' : 'HISTORICAL',
      authority_level: 3, issuing_body: 'GPPB',
      date_approved: approved, date_published: published, effective_date: null,
      source_url: pdfs[0],
      verification: `index-listed (GPPB ${kind}s page, catalogued ${TODAY})${fw === 'RA12009' ? '; status not reviewed' : ''}`,
      ingest: true, ingest_fields: ['source_url', 'annex_urls'],
    };
    if (pdfs.length > 1) doc.annex_urls = pdfs.slice(1);
    add(doc, pdfs);
  }
}

// ---- Public advisories (blog category, paginated) -------------------------------------------------------
{
  const posts = [];
  for (let page = 1; page < 50; page++) {
    const $ = await get(page === 1 ? `${BASE}/category/advisories/` : `${BASE}/category/advisories/page/${page}/`);
    if (!$) break;
    const found = $('.entry-title a[href]').toArray().map(a => ({ title: clean($(a).text()), url: abs($(a).attr('href')) }));
    if (!found.length) break;
    posts.push(...found);
    await sleep(750);
  }
  for (const p of posts) {
    const m = /Advisory No\.?\s*0*(\d+)\s*-\s*(\d{4})/i.exec(p.title);
    const slug = p.url.replace(/\/$/, '').split('/').pop();
    const $ = await get(p.url);
    await sleep(750);
    const date = $ ? isoDate(clean($('time').first().attr('datetime') ?? $('time').first().text())) : null;
    // Numbered advisories are titled only by their number; the subject is the first line of the post.
    const firstLine = $ ? $('.entry-content').find('h1,h2,h3,h4,p,strong').toArray().map(e => clean($(e).text())).find(t => t.length > 3) ?? '' : '';
    const subject = [...(m && firstLine ? firstLine : p.title)].slice(0, 160).join('');
    const year = m?.[2] ?? date?.slice(0, 4) ?? '';
    const fw = framework(date, year, p.title);
    add({
      id: m ? `GPPB-ADV-${m[1].padStart(2, '0')}-${m[2]}` : `GPPB-ADV-${slug}`.slice(0, 80),
      reference: m ? `GPPB-TSO Public Advisory No. ${m[1].padStart(2, '0')}-${m[2]} — ${subject}` : `GPPB-TSO Advisory — ${subject}`,
      aliases: m ? [`Public Advisory No. ${m[1].padStart(2, '0')}-${m[2]}`, `Advisory No. ${m[1].padStart(2, '0')}-${m[2]}`] : [],
      type: 'advisory', framework: fw, status: fw === 'RA12009' ? 'CURRENT' : 'HISTORICAL',
      authority_level: 3, issuing_body: 'GPPB-TSO',
      date_approved: null, date_published: date, effective_date: null,
      source_url: p.url,
      verification: `index-listed (GPPB advisories category, catalogued ${TODAY})${fw === 'RA12009' ? '; status not reviewed' : ''}`,
      ingest: true, ingest_fields: ['source_url'],
    }, [p.url]);
  }
}

// ---- Executive issuances (Office of the President) and other agencies' issuances GPPB lists ------------
for (const [url, type, prefix] of [
  [`${BASE}/executive-issuances/`, 'executive_issuance', 'OP'],
  [`${BASE}/administrative-issuances/`, 'agency_issuance', 'AGENCY'],
]) {
  const $ = await get(url);
  for (const r of rows($)) {
    const files = [...new Set(r.links.filter(l => /\.(pdf|jpe?g|png)($|\?)/i.test(l)))];
    if (!r.cells[0] || !files.length) continue;
    const date = isoDate(r.cells[0]);
    // "Administrative Order No. 17 July 28, 2011" → "Administrative Order No. 17"
    const name = clean(r.cells[0].replace(/\[.*?\]|\(.*?\)/g, '').replace(/\s*[A-Z][a-z]+\.? \d{1,2},? \d{4}.*$/, ''));
    // A row whose first column is only a date is named by its title instead.
    const label = name || clean(r.cells[1]).split(/[(,]/)[0].slice(0, 80);
    const slug = label.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
    const body = type === 'executive_issuance' ? 'Office of the President'
      : /Revenue/i.test(name) ? 'Bureau of Internal Revenue' : /Commission on Audit|COA/i.test(name) ? 'Commission on Audit'
      : /PCAB/i.test(name) ? 'Philippine Contractors Accreditation Board' : /DBM|Budget/i.test(name) ? 'Department of Budget and Management'
      : 'Government agency';
    const fw = framework(date, date?.slice(0, 4) ?? '', `${name} ${r.cells[1]}`);
    const doc = {
      id: `${prefix}-${slug}`,
      reference: name ? `${name} — ${r.cells[1]}` : r.cells[1],
      aliases: name ? [name] : [],
      type, framework: fw, status: fw === 'RA12009' ? 'CURRENT' : 'HISTORICAL',
      authority_level: 3, issuing_body: body,
      date_approved: null, date_published: null, date_issued: date, effective_date: null,
      source_url: files[0],
      verification: `index-listed (GPPB ${type === 'executive_issuance' ? 'executive' : 'administrative'} issuances page, catalogued ${TODAY})${fw === 'RA12009' ? '; status not reviewed' : ''}`,
      ingest: true, ingest_fields: ['source_url', 'annex_urls'],
    };
    if (files.length > 1) doc.annex_urls = files.slice(1);
    add(doc, files);
  }
}

// Drop undefined keys so the manifest stays clean JSON.
const out = added.map(d => Object.fromEntries(Object.entries(d).filter(([, v]) => v !== undefined)));
const byType = out.reduce((n, d) => ({ ...n, [`${d.type}/${d.framework}`]: (n[`${d.type}/${d.framework}`] ?? 0) + 1 }), {});
console.log(`New documents: ${out.length}`, byType, `skipped (already present): by id ${skipped.id}, by URL ${skipped.url}`);
if (!DRY && out.length) {
  manifest.documents.push(...out);
  for (const u of [`${BASE}/policy-matter/`, `${BASE}/category/advisories/`]) if (!manifest.verified_against.includes(u)) manifest.verified_against.push(u);
  await fs.writeFile(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
  await fs.mkdir(path.join(ROOT, 'storage', 'logs'), { recursive: true });
  await fs.writeFile(path.join(ROOT, 'storage', 'logs', 'catalog-new-ids.txt'), out.map(d => d.id).join('\n') + '\n');
  console.log('Manifest updated; new ids in storage/logs/catalog-new-ids.txt');
}
