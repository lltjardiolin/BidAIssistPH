// PhilGEPS Opportunities + Rule Lens (PDR Part G1). Notices are kept apart from the legal corpus: they are
// never embedded, never retrieved by chat, and never used as evidence. The Rule Lens is a fixed mapping from
// procurement mode to documents in the corpus registry — it is not produced by a language model.
import raw from '../data/sample-notices.json';
import { docsById, formatDate, shortRef } from './manifest';
import type { ManifestDoc } from './types';

export type NoticeStatus = 'OPEN' | 'CLOSED' | 'POSTPONED' | 'CANCELLED' | 'AWARDED';
export type Category = 'Goods' | 'Infrastructure' | 'Consulting';

export type Notice = {
  refNo: string;
  title: string;
  procuringEntity: string;
  region?: string;
  category: Category;
  mode: string;
  abc?: number;
  publishedAt: string;
  closingAt: string;
  status: NoticeStatus;
  /** Original posting. Required for every real notice (OP-01); sample notices have none. */
  sourceUrl: string | null;
  fetchedAt: string | null;
  sample: boolean;
};

export type Feed = {
  kind: 'sample' | 'live'; label: string; note: string; lastSync: string | null;
  /** The last read of PhilGEPS failed or is more than a day and a half old (OP-05). */
  stale?: boolean;
  total?: number;
};

export type RuleBadge = 'STATUTE' | 'IRR' | 'BOARD' | 'OPINION' | 'HISTORICAL' | 'TIME-BOUND';
export type RuleRow = {
  documentId: string;
  name: string;            // "GPPB Resolution No. 10-2026 / Circular No. 06-2026"
  title: string | null;    // "Documentary requirements for specific modes under RA 12009"
  detail: string | null;   // "Sec. 35 — Negotiated Procurement"
  badge: RuleBadge;
  /** Only `governing` rows are rules for the notice. `context` rows are shown for comparison and say why. */
  role: 'governing' | 'context';
  note: string | null;
  sourceUrl: string | null;
};

export type NoticeView = Notice & {
  /** The mode in the terms of the IRR of RA 12009; `mode` keeps the wording used on PhilGEPS. */
  lensMode: string;
  abcLabel: string | null;
  closingLabel: string;
  publishedLabel: string;
  inElectionWindow: boolean;
  rules: RuleRow[];
  askUrl: string;
};

const data = raw as { feed: Feed; notices: Array<Omit<Notice, 'sourceUrl' | 'fetchedAt' | 'sample'> & Partial<Notice>> };
export const feed: Feed = data.feed;

export const notices: Notice[] = data.notices.map(n => {
  const sample = feed.kind === 'sample';
  if (!sample && !n.sourceUrl) throw new Error(`${n.refNo}: a live notice must link to its original posting`);
  return { ...n, sourceUrl: n.sourceUrl ?? null, fetchedAt: n.fetchedAt ?? null, sample };
});

/** Mode → IRR section and corpus documents (PDR G1 table; IRR headings as indexed from the IRR itself). */
const MODE_RULES: Record<string, { irr: string; docs: string[]; historical?: string[] }> = {
  'Competitive Bidding': { irr: 'Sec. 27 — Competitive Bidding', docs: ['GPPB-RES-03-2025', 'GPPB-RES-08-2026'] },
  'Negotiated Procurement': { irr: 'Sec. 35 — Negotiated Procurement', docs: ['GPPB-RES-10-2026', 'GPPB-RES-12-2025', 'GPPB-NPM-025-2026'] },
  'Small Value Procurement': { irr: 'Sec. 34 — Small Value Procurement', docs: ['GPPB-RES-12-2025'] },
  'Framework Agreement': { irr: 'Sec. 16 — Use of Framework Agreement', docs: ['GPPB-RES-12-2026'], historical: ['GPPB-RES-27-2019'] },
  'Direct Procurement for STI': { irr: 'Sec. 37 — Direct Procurement for Science, Technology, and Innovation', docs: ['GPPB-RES-04-2026'] },
  'Direct Acquisition': { irr: 'Sec. 32 — Direct Acquisition', docs: ['GPPB-RES-12-2025', 'GPPB-NPM-004-2026', 'GPPB-NPM-019-2026'] },
  'Direct Contracting': { irr: 'Sec. 31 — Direct Contracting', docs: ['GPPB-RES-12-2025'] },
  'Limited Source Bidding': { irr: 'Sec. 28 — Limited Source Bidding', docs: ['GPPB-RES-12-2025'] },
  'Competitive Dialogue': { irr: 'Sec. 29 — Competitive Dialogue', docs: ['GPPB-RES-12-2025'] },
  'Unsolicited Offer with Bid Matching': { irr: 'Sec. 30 — Unsolicited Offer with Bid Matching', docs: ['GPPB-RES-12-2025'] },
  'Repeat Order': { irr: 'Sec. 33 — Repeat Order', docs: ['GPPB-RES-12-2025'] },
  'Direct Sales': { irr: 'Sec. 36 — Direct Sales', docs: ['GPPB-RES-12-2025'] },
  // A mode named on PhilGEPS that is not a heading in the IRR of RA 12009 (for example "Shopping").
  Other: { irr: 'Sec. 26 — Modes of Procurement', docs: ['GPPB-RES-12-2025'] },
};
export const MODES = Object.keys(MODE_RULES).filter(m => m !== 'Other');

const MODE_PATTERNS: Array<[RegExp, string]> = [
  [/small value/i, 'Small Value Procurement'], [/framework/i, 'Framework Agreement'], [/science|technology|\bSTI\b/i, 'Direct Procurement for STI'],
  [/direct acquisition/i, 'Direct Acquisition'], [/direct contracting/i, 'Direct Contracting'], [/direct sales/i, 'Direct Sales'],
  [/limited source/i, 'Limited Source Bidding'], [/competitive dialogue/i, 'Competitive Dialogue'], [/unsolicited/i, 'Unsolicited Offer with Bid Matching'],
  [/repeat order/i, 'Repeat Order'], [/negotiated/i, 'Negotiated Procurement'], [/public bidding|competitive bidding/i, 'Competitive Bidding'],
];
/** PhilGEPS wording ("Public Bidding", "Negotiated Procurement - Small Value Procurement (Sec. 53.9)") → IRR mode. */
export const lensMode = (mode: string) => MODE_PATTERNS.find(([re]) => re.test(mode))?.[1] ?? 'Other';

const TRANSITORY_DOC = 'GPPB-RES-05-2025';
const ELECTION_DOC = 'GPPB-RES-20-2026';
const day = (iso: string) => iso.slice(0, 10);

/** The time-bound election circular, while it is in the corpus and has not expired (OP-03). */
export function activeElectionRule(today: string): ManifestDoc | null {
  const d = docsById.get(ELECTION_DOC);
  if (!d || d.ingest === false || d.status !== 'CURRENT' || !d.expires_at) return null;
  return day(today) <= d.expires_at ? d : null;
}

export function inElectionWindow(n: Pick<Notice, 'closingAt'>, today: string): boolean {
  const d = activeElectionRule(today);
  if (!d?.applies_from || !d.expires_at) return false;
  return day(n.closingAt) >= d.applies_from && day(n.closingAt) <= d.expires_at;
}

function badgeFor(d: ManifestDoc): RuleBadge {
  if (d.status === 'HISTORICAL') return 'HISTORICAL';
  if (d.expires_at) return 'TIME-BOUND';
  if (d.authority_level >= 4) return 'OPINION';
  if (d.type === 'irr') return 'IRR';
  if (d.type === 'law') return 'STATUTE';
  return 'BOARD';
}

function row(id: string, role: RuleRow['role'], detail: string | null, note: string | null): RuleRow | null {
  const d = docsById.get(id);
  // Only indexed documents may appear: the lens must never point at something the corpus does not hold.
  if (!d || d.ingest === false) return null;
  // Withdrawn, superseded and proposed documents are never rules for a notice (OP-02).
  if (['WITHDRAWN', 'SUPERSEDED', 'PROPOSED'].includes(d.status)) return null;
  const effectiveRole = d.status === 'HISTORICAL' ? 'context' : role;
  return {
    documentId: d.id, name: shortRef(d), title: d.reference.split(' — ')[1] ?? null, detail, badge: badgeFor(d),
    role: effectiveRole, note, sourceUrl: d.source_url ?? null,
  };
}

export function ruleLens(n: Pick<Notice, 'mode' | 'closingAt'>, today: string): RuleRow[] {
  const mode = lensMode(n.mode);
  const m = MODE_RULES[mode];
  const rows: Array<RuleRow | null> = [row('RA12009-IRR-2025', 'governing', m.irr,
    mode === 'Other' ? `PhilGEPS lists this notice as “${n.mode}”, which is not a heading in the IRR of RA 12009. Sec. 26 lists the modes.` : null)];
  for (const id of m?.docs ?? []) {
    const d = docsById.get(id);
    rows.push(row(id, 'governing', null, d && d.authority_level >= 4 ? 'GPPB-TSO opinion: interpretive, not Board policy.' : null));
  }
  for (const id of m?.historical ?? []) {
    const d = docsById.get(id);
    const current = d?.counterpart ? docsById.get(d.counterpart) : undefined;
    rows.push(row(id, 'context', null, `RA 9184-era. Shown for comparison only${current ? `; ${shortRef(current)} governs now` : ''}.`));
  }
  rows.push(row(TRANSITORY_DOC, 'governing', null,
    'Covers the transitory provision (Sec. 113) and the repealing clause (Sec. 115). Read it to see whether RA 9184 or RA 12009 applies to this procurement.'));
  if (inElectionWindow(n, today)) {
    const d = docsById.get(ELECTION_DOC)!;
    rows.push(row(ELECTION_DOC, 'governing', null,
      `Closing date falls in the election period (${formatDate(d.applies_from)} – ${formatDate(d.expires_at)}).`));
  }
  return rows.filter((r): r is RuleRow => r !== null);
}

const peso = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 0 });
export const formatAbc = (abc?: number) => (abc === undefined ? null : peso.format(abc));

export function toView(n: Notice, today: string): NoticeView {
  const mode = lensMode(n.mode);
  const question = `What rules and documentary requirements apply to ${mode === 'Other' ? 'the modes of procurement' : mode} under RA 12009?`;
  return {
    ...n,
    lensMode: mode,
    status: effectiveStatus(n, today),
    abcLabel: formatAbc(n.abc),
    closingLabel: formatDate(day(n.closingAt)) ?? n.closingAt,
    publishedLabel: formatDate(day(n.publishedAt)) ?? n.publishedAt,
    inElectionWindow: inElectionWindow(n, today),
    rules: ruleLens(n, today),
    askUrl: `/?scope=all&q=${encodeURIComponent(question)}`,
  };
}

/** A notice whose closing date has passed is shown as closed even if the feed has not caught up. */
export function effectiveStatus(n: Pick<Notice, 'status' | 'closingAt'>, today: string): NoticeStatus {
  return n.status === 'OPEN' && day(n.closingAt) < day(today) ? 'CLOSED' : n.status;
}
