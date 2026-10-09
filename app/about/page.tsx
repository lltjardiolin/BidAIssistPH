import type { Metadata } from 'next';
import Link from 'next/link';
import { Chip } from '@/components/evidence/chip';
import { StatusBadge } from '@/components/evidence/status-badge';
import { AppHeader } from '@/components/shell/app-header';
import { Sheet } from '@/components/shell/sheet';
import { CORPUS_DATE, DISCLAIMER } from '@/lib/copy';
import { CORPUS_VERSION, dateLabel, indexedDocs, manifest } from '@/lib/manifest';
import { FRAMEWORK_LABEL, KIND_LABEL, STATUS_STYLE } from '@/lib/status';
import type { Status } from '@/lib/types';

export const metadata: Metadata = { title: 'About the corpus' };

const STEPS = [
  ['Search the indexed documents', 'Your question is matched against the corpus three ways — exact identifiers (RA 12009, Sec. 113, Res. 10-2026), keywords, and meaning — inside the scope tab you chose. Nothing is looked up on the open web.'],
  ['Check version, status and authority', 'Withdrawn editions are kept out of the default pool and only ever appear next to the record that withdrew them. Bills are labelled as proposals; GPPB-TSO opinions as interpretive.'],
  ['Answer only from the evidence', 'The model writes from the retrieved passages and cites each claim. If no eligible document supports an answer, it says so instead of guessing.'],
];

const STATUSES: Status[] = ['CURRENT', 'HISTORICAL', 'REFERENCE', 'PROPOSED', 'WITHDRAWN', 'SUPERSEDED'];
const H2 = 'font-display text-[24px] font-medium leading-tight text-ink';

export default function AboutPage() {
  const excluded = manifest.documents.filter(d => d.ingest === false && d.type !== 'opinion_collection');
  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader active="about" />
      <Sheet className="pt-8 md:pt-12">
                <h1 className="max-w-[22ch] font-display text-[30px] font-medium leading-[1.12] tracking-[-0.01em] text-ink md:text-[40px]">Which document says that, which version applies, and where exactly?</h1>
        <p className="mt-4 max-w-[720px] text-[15px] leading-relaxed text-ink-2">
          BidAIssistPH is a closed-corpus research assistant for Philippine government procurement law. It answers only from
          documents that were downloaded, hashed and indexed before you asked — {indexedDocs.length} documents, corpus version{' '}
          <span className="font-mono text-[13px] font-medium text-ink">{CORPUS_VERSION}</span>.
        </p>
        <p className="mt-4"><Link href="/" className="font-medium text-accent hover:text-accent-hover hover:underline">← Back to research</Link></p>

        <section className="mt-10" aria-labelledby="how">
          <h2 id="how" className={H2}>How answers are built</h2>
          <ol className="mt-4 grid gap-3 md:grid-cols-3">
            {STEPS.map(([title, body], i) => (
              <li key={title} className="border-t-2 border-ink pt-4">
                <span className="font-display text-[22px] font-medium text-accent">{i + 1}</span>
                <h3 className="mt-1 text-[15px] font-semibold text-ink">{title}</h3>
                <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-2">{body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="mt-10" aria-labelledby="legend">
          <h2 id="legend" className={H2}>Document status</h2>
          <ul className="mt-4 grid gap-x-8 gap-y-3 md:grid-cols-2">
            {STATUSES.map(s => (
              <li key={s} className="flex items-start gap-3 text-[13.5px] leading-snug text-ink-2">
                <span className="mt-px w-[104px] shrink-0"><StatusBadge status={s} /></span>
                <span>{STATUS_STYLE[s].meaning}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-10" aria-labelledby="corpus">
          <h2 id="corpus" className={H2}>Indexed documents</h2>
          <div className="relative mt-4 max-w-full overflow-x-auto border-y border-line">
            <table className="w-full min-w-[720px] border-collapse text-left text-[13.5px]">
              <thead className="text-[13px] text-ink-2">
                <tr>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Document</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Status</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Framework</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Source</th>
                </tr>
              </thead>
              <tbody>
                {indexedDocs.map(d => (
                  <tr key={d.id} className="border-t border-line-soft align-top">
                    <td className="px-4 py-3">
                      <span className="font-medium text-ink">{d.reference}</span>
                      <span className="mt-0.5 block text-[12.5px] text-ink-2">
                        {[d.issuing_body, dateLabel(d)].filter(Boolean).join(', ')}
                      </span>
                      {d.release_note && <span className="mt-1 block text-[12.5px] text-status-superseded-fg">Open item: {d.release_note}</span>}
                    </td>
                    <td className="px-4 py-3"><StatusBadge status={d.status} /></td>
                    <td className="px-4 py-3"><span className="flex flex-wrap gap-1"><Chip>{FRAMEWORK_LABEL[d.framework]}</Chip><Chip>{KIND_LABEL[d.type] ?? d.type}</Chip></span></td>
                    <td className="px-4 py-3">
                      {d.source_url && (
                        <a href={d.source_url} target="_blank" rel="noopener noreferrer" className="whitespace-nowrap font-medium text-accent hover:text-accent-hover hover:underline">
                          Open the original<span className="sr-only"> (opens in a new tab)</span>
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="mt-10" aria-labelledby="open">
          <h2 id="open" className={H2}>Not yet in the corpus</h2>
          <p className="mt-2 max-w-[720px] text-[13.5px] leading-relaxed text-ink-2">
            These documents are known but have no verified official source yet, so they are not searched. Questions that depend on them are answered with “I couldn’t verify that”.
          </p>
          <ul className="mt-4 flex flex-col gap-2">
            {excluded.map(d => (
              <li key={d.id} className="border-t border-line py-3 text-[13.5px]">
                <span className="flex flex-wrap items-center gap-2"><StatusBadge status={d.status} /><span className="font-medium text-ink">{d.reference}</span></span>
                <span className="mt-1 block text-[12.5px] text-ink-2">{d.ingest_blocker}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-10 max-w-[68ch] border-l-[3px] border-line-strong pl-4" aria-labelledby="disclaimer">
          <h2 id="disclaimer" className="text-[15px] font-semibold text-ink">Disclaimer</h2>
          <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-2">{DISCLAIMER}</p>
          <p className="mt-2 text-[13.5px] leading-relaxed text-ink-2">Questions are logged as evaluation traces to measure and improve answer quality. Do not enter personal or confidential information.</p>
        </section>
      </Sheet>
    </div>
  );
}
