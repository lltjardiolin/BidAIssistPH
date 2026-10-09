import { dateLabel, docsById, versionNote } from '@/lib/manifest';

// Source-card metadata (PDR B7). Served from the manifest bundled with the app: no database, no network.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const d = docsById.get(decodeURIComponent(id));
  if (!d) return Response.json({ error: 'not_found' }, { status: 404 });
  return Response.json({
    id: d.id, reference: d.reference, type: d.type, framework: d.framework, status: d.status,
    authority: d.authority_level, issuingBody: d.issuing_body, dateLabel: dateLabel(d), note: versionNote(d),
    sourceUrl: d.source_url ?? null, indexed: d.ingest !== false, verification: d.verification ?? null,
    withdrawnBy: d.withdrawn_by ?? null, supersededBy: d.superseded_by ?? null, counterpart: d.counterpart ?? null,
  }, { headers: { 'cache-control': 'public, max-age=3600' } });
}
