import { loadNotices } from '@/lib/notices-store';
import { toView } from '@/lib/opportunities';

export const dynamic = 'force-dynamic';

// Notices with their Rule Lens (PDR B7). Separate from the legal corpus: nothing here is retrieval evidence.
export async function GET() {
  const today = new Date(Date.now() + 8 * 3600_000).toISOString();
  const { feed, notices } = await loadNotices();
  return Response.json({ feed, notices: notices.map(n => toView(n, today)) });
}
