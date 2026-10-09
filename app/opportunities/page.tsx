import type { Metadata } from 'next';
import { OpportunitiesView } from '@/components/opportunities/opportunities-view';
import { AppHeader } from '@/components/shell/app-header';
import { Sheet } from '@/components/shell/sheet';
import { formatDate, shortRef } from '@/lib/manifest';
import { loadNotices } from '@/lib/notices-store';
import { MODES, activeElectionRule, toView } from '@/lib/opportunities';

export const metadata: Metadata = { title: 'Opportunities' };
// Closing dates and the election period are compared with today's date on every request.
export const dynamic = 'force-dynamic';

export default async function OpportunitiesPage() {
  // Closing dates on PhilGEPS are Philippine time, so "today" is too.
  const today = new Date(Date.now() + 8 * 3600_000).toISOString();
  const { feed, notices } = await loadNotices();
  const rule = activeElectionRule(today);
  const views = notices.map(n => toView(n, today)).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || a.closingAt.localeCompare(b.closingAt));
  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader active="opportunities" />
      <Sheet>
      <OpportunitiesView
        notices={views}
        feed={feed}
        modes={MODES.filter(m => views.some(v => v.lensMode === m))}
        election={rule ? { name: shortRef(rule), window: `${formatDate(rule.applies_from)} to ${formatDate(rule.expires_at)}` } : null}
      />
      </Sheet>
    </div>
  );
}
