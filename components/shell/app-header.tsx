import Link from 'next/link';

const TABS = [{ href: '/', label: 'Research', key: 'research' }, { href: '/opportunities', label: 'Opportunities', key: 'opportunities' },
  { href: '/evaluation', label: 'Evaluation', key: 'evaluation' }, { href: '/about', label: 'About', key: 'about' }] as const;
export type PrimaryTab = (typeof TABS)[number]['key'];

export function AppHeader({ active, children }: {
  active?: PrimaryTab; children?: React.ReactNode;
  /** Kept so pages written for the earlier header still compile; the corpus date now sits with the answer. */
  corpusVersion?: string; corpusDate?: string;
}) {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-surface">
      <div className="mx-auto flex max-w-[1180px] flex-wrap items-center gap-x-8 px-4 md:flex-nowrap md:px-8">
        <Link href="/" className="py-3.5 font-display text-[21px] font-semibold leading-none text-ink md:py-4">BidAIssistPH</Link>
        <nav aria-label="Sections" className="order-3 -mx-1 flex w-full overflow-x-auto md:order-none md:mx-0 md:w-auto">
          {TABS.map(t => (
            <Link key={t.key} href={t.href} aria-current={active === t.key ? 'page' : undefined}
              className={`inline-flex min-h-11 shrink-0 items-center border-b-2 px-3 text-[14.5px] ${
                active === t.key ? 'border-accent font-semibold text-ink' : 'border-transparent text-ink-2 hover:text-ink'}`}>
              {t.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3">{children}</div>
      </div>
    </header>
  );
}
