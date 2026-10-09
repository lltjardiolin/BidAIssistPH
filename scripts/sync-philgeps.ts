// Maintainer job (daily timer). Reads the newest notices from the public PhilGEPS listing into the `notices`
// table. Never called from /api/chat, and nothing it stores is used as evidence for answers.
//
//   npm run notices:sync                      notices published in the last 7 days, newest first, up to 300
//   NOTICE_MAX_AGE_DAYS=7 NOTICE_MAX=300 NOTICE_DELAY_MS=1500
//
// Good manners: one request at a time, a pause between requests, an honest User-Agent, a hard cap on pages,
// and it stops at once on any error instead of retrying in a loop. The site publishes no robots.txt.
import { getPool } from '../lib/db';
import { LISTING_URL, hashOf, hiddenFields, noticeUrl, parseDetail, parseListing, toCategory, toStatus } from '../lib/philgeps';

const MAX_AGE_DAYS = Number(process.env.NOTICE_MAX_AGE_DAYS || 7);
const MAX_NOTICES = Number(process.env.NOTICE_MAX || 300);
const DELAY_MS = Math.max(1000, Number(process.env.NOTICE_DELAY_MS || 1500));
const MAX_PAGES = Math.ceil(MAX_NOTICES / 20) + 2;
const UA = 'BidAIssistPH/1.0 (student research project; reads public notices once a day)';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const cookies = new Map<string, string>();
let requests = 0;

async function request(url: string, form?: Record<string, string>): Promise<{ url: string; html: string }> {
  await sleep(DELAY_MS);
  requests++;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 60_000);
  try {
    const res = await fetch(url, {
      method: form ? 'POST' : 'GET', redirect: 'follow', signal: ctl.signal,
      headers: { 'user-agent': UA, cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; '),
        ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) },
      body: form ? new URLSearchParams(form).toString() : undefined,
    });
    for (const c of res.headers.getSetCookie()) { const [pair] = c.split(';'); const i = pair.indexOf('='); if (i > 0) cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1)); }
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return { url: res.url, html: await res.text() };
  } finally { clearTimeout(timer); }
}

const postBack = (page: { url: string; html: string }, target: string) =>
  request(page.url, { ...hiddenFields(page.html), __EVENTTARGET: target, __EVENTARGUMENT: '' });

// Dates on PhilGEPS are Philippine time.
const manilaToday = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
const cutoff = new Date(Date.parse(`${manilaToday}T00:00:00Z`) - MAX_AGE_DAYS * 86_400_000).toISOString().slice(0, 10);

const pool = getPool();
const startedAt = new Date();
const { rows: [sync] } = await pool.query<{ id: number }>('insert into notice_syncs (started_at) values ($1) returning id', [startedAt]);
const stats = { pages: 0, seen: 0, saved: 0, pruned: 0 };

try {
  console.log(`Reading notices published since ${cutoff} (up to ${MAX_NOTICES}); ${DELAY_MS} ms between requests.`);
  let page = await postBack(await request(LISTING_URL), 'lbtnSearch');
  const wanted: Array<{ refNo: string; publishedAt: string }> = [];
  let total: number | null = null;

  for (let p = 1; p <= MAX_PAGES; p++) {
    const listing = parseListing(page.html);
    if (!listing.rows.length) throw new Error(`page ${p}: no notices found — the page layout may have changed`);
    total ??= listing.total;
    stats.pages = p;
    const fresh = listing.rows.filter(r => r.publishedAt >= cutoff);
    wanted.push(...fresh.map(r => ({ refNo: r.refNo, publishedAt: r.publishedAt })));
    // The listing is newest first: the first page with an older notice is the last page needed.
    if (fresh.length < listing.rows.length || wanted.length >= MAX_NOTICES || p >= listing.pages) break;
    page = await postBack(page, 'pgCtrlDetailedSearch$nextLB');
  }
  const refs = [...new Map(wanted.map(w => [w.refNo, w])).values()].slice(0, MAX_NOTICES);
  stats.seen = refs.length;
  console.log(`${total ?? '?'} open notices on PhilGEPS; ${refs.length} selected from ${stats.pages} page(s).`);

  const { rows: have } = await pool.query<{ ref_no: string }>('select ref_no from notices where ref_no = any($1::text[]) and fetched_at > now() - interval \'20 hours\'', [refs.map(r => r.refNo)]);
  const recent = new Set(have.map(h => h.ref_no));

  for (const [i, r] of refs.entries()) {
    if (recent.has(r.refNo)) continue;                      // read less than a day ago
    const url = noticeUrl(r.refNo);
    const res = await request(url);
    if (/NoticeNotActive/i.test(res.url)) { console.log(`skipped ${r.refNo}: no longer active on PhilGEPS`); continue; }
    const d = parseDetail(res.html);
    if (!d) { console.warn(`skipped ${r.refNo}: could not read the notice page`); continue; }
    await pool.query(
      `insert into notices (ref_no, title, procuring_entity, area_of_delivery, category, business_category, mode, abc,
         published_at, closing_at, status, source_url, fetched_at, raw_hash)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now(),$13)
       on conflict (ref_no) do update set title=excluded.title, procuring_entity=excluded.procuring_entity,
         area_of_delivery=excluded.area_of_delivery, category=excluded.category, business_category=excluded.business_category,
         mode=excluded.mode, abc=excluded.abc, published_at=excluded.published_at, closing_at=excluded.closing_at,
         status=excluded.status, source_url=excluded.source_url, fetched_at=excluded.fetched_at, raw_hash=excluded.raw_hash`,
      [d.refNo, d.title, d.procuringEntity, d.areaOfDelivery, toCategory(d.classification), d.businessCategory, d.mode, d.abc,
        d.publishedAt, d.closingAt, toStatus(d.status), url, hashOf(d)]);
    stats.saved++;
    if (stats.saved % 25 === 0) console.log(`  ${stats.saved} saved (${i + 1}/${refs.length})`);
  }

  const pruned = await pool.query('delete from notices where published_at < $1', [cutoff]);
  stats.pruned = pruned.rowCount ?? 0;
  await pool.query('update notice_syncs set finished_at = now(), ok = true, pages_read = $2, notices_seen = $3, notices_saved = $4, notices_pruned = $5 where id = $1',
    [sync.id, stats.pages, stats.seen, stats.saved, stats.pruned]);
  console.log(`Done: ${stats.saved} saved, ${stats.seen - stats.saved} already up to date or skipped, ${stats.pruned} older than ${MAX_AGE_DAYS} days removed. ${requests} requests.`);
} catch (e) {
  const message = e instanceof Error ? e.message : String(e);
  await pool.query('update notice_syncs set finished_at = now(), ok = false, pages_read = $2, notices_seen = $3, notices_saved = $4, error = $5 where id = $1',
    [sync.id, stats.pages, stats.seen, stats.saved, message.slice(0, 500)]);
  console.error(`Sync failed after ${requests} requests: ${message}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
