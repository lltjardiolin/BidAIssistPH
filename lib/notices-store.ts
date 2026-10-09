// Server only. Notices come from the `notices` table filled by scripts/sync-philgeps.ts; when it is empty
// (no sync has run yet) the labelled sample notices are shown instead.
import { query } from './db';
import { formatDate } from './manifest';
import { feed as sampleFeed, notices as sampleNotices, type Feed, type Notice } from './opportunities';

type Row = { ref_no: string; title: string; procuring_entity: string; area_of_delivery: string | null; category: Notice['category'];
  mode: string; abc: string | null; published_at: Date; closing_at: Date; status: Notice['status']; source_url: string; fetched_at: Date };
const manila = (d: Date) => new Date(d.getTime() + 8 * 3600_000).toISOString();

export async function loadNotices(limit = 300): Promise<{ feed: Feed; notices: Notice[] }> {
  try {
    const { rows } = await query<Row>(
      `select ref_no, title, procuring_entity, area_of_delivery, category, mode, abc, published_at, closing_at, status, source_url, fetched_at
       from notices order by published_at desc, closing_at asc limit $1`, [limit]);
    if (!rows.length) return { feed: sampleFeed, notices: sampleNotices };
    const { rows: [last] } = await query<{ finished_at: Date | null; ok: boolean }>('select finished_at, ok from notice_syncs order by id desc limit 1');
    const lastOk = (await query<{ finished_at: Date }>('select finished_at from notice_syncs where ok order by id desc limit 1')).rows[0]?.finished_at ?? null;
    const stale = !last?.ok || !lastOk || Date.now() - lastOk.getTime() > 36 * 3600_000;
    const synced = lastOk ? `${formatDate(manila(lastOk).slice(0, 10))} ${manila(lastOk).slice(11, 16)} PHT` : null;
    return {
      feed: { kind: 'live', label: 'PhilGEPS open opportunities', lastSync: synced, stale, total: rows.length,
        note: 'Notices published on PhilGEPS in the last 7 days, newest first. Always confirm on the original posting.' },
      notices: rows.map(r => ({
        refNo: r.ref_no, title: r.title, procuringEntity: r.procuring_entity, region: r.area_of_delivery ?? undefined, category: r.category,
        mode: r.mode, abc: r.abc === null ? undefined : Number(r.abc),
        // Dates are shown as PhilGEPS shows them, in Philippine time.
        publishedAt: typeof r.published_at === 'string' ? r.published_at : manila(r.published_at).slice(0, 10),
        closingAt: manila(r.closing_at).slice(0, 19),
        status: r.status, sourceUrl: r.source_url, fetchedAt: `${formatDate(manila(r.fetched_at).slice(0, 10))} ${manila(r.fetched_at).slice(11, 16)} PHT`,
        sample: false,
      })),
    };
  } catch (e) {
    console.error('[notices]', e instanceof Error ? e.message : e);
    return { feed: { ...sampleFeed, stale: true }, notices: sampleNotices };
  }
}
