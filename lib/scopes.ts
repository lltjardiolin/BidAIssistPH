// Scope tabs → retrieval filters (PDR B4.1). Tabs are metadata filters on one index.
// The scope always comes from the request body; the model can never widen it.

export type ScopeDef = {
  label: string;
  short: string;
  note: string;
  statuses?: readonly string[];
  ids?: readonly string[];
  types?: readonly string[];
  framework?: string;
  /** Withdrawn/superseded documents are excluded unless the tab is about them (D2). */
  includeNonDefault?: boolean;
  suggestions: readonly string[];
};

export const SCOPES = {
  all: {
    label: 'All data', short: 'All',
    note: 'Current, historical, reference and proposed documents. Withdrawn editions are excluded.',
    statuses: ['CURRENT', 'HISTORICAL', 'REFERENCE', 'PROPOSED'],
    suggestions: [
      'What changed from RA 9184 to RA 12009?',
      'Should we still use the March 31, 2026 IRR?',
      'What documents do I need for negotiated procurement?',
      'Is HB 7917 already law?',
      'When did the new standard forms become mandatory?',
    ],
  },
  ngpa: {
    label: 'RA 12009 + IRR', short: 'RA 12009',
    note: 'The New Government Procurement Act and its 2025 IRR only.',
    ids: ['RA12009', 'RA12009-IRR-2025'],
    suggestions: [
      'What are the principles of the NGPA?',
      'When did the NGPA IRR take effect?',
      'What is market scoping under the IRR?',
      'What are the alternative modes of procurement?',
      'What are the grounds for post-disqualification?',
    ],
  },
  issuances: {
    label: 'GPPB issuances', short: 'Issuances',
    note: 'GPPB resolutions, circulars and advisories issued under RA 12009.',
    types: ['resolution', 'circular', 'advisory'], framework: 'RA12009',
    suggestions: [
      'What are the framework agreement guidelines?',
      'What is the Procurement Mode Selection Decision Tree?',
      'What does Circular 01-2025 say about the transitory provision?',
      'What are the rules on tie-breaking?',
      'What rules apply during the 2026 BSKE election period?',
    ],
  },
  opinions: {
    label: 'TSO opinions', short: 'Opinions',
    note: 'GPPB-TSO non-policy matter opinions (interpretive, not Board policy).',
    types: ['opinion'],
    suggestions: [
      'Can direct acquisition be used for customized goods?',
      'What are the grounds for post-disqualification?',
      'Can a joint venture partner with net losses be eligible?',
      'How many copies of bids must be submitted?',
      'What is the imposable rate of liquidated damages for goods?',
    ],
  },
  ra9184: {
    label: 'RA 9184 (historical)', short: 'RA 9184',
    note: 'RA 9184-era documents. Historical; may still apply to transitional procurement.',
    framework: 'RA9184',
    suggestions: [
      'What was the rule on tie-breaking?',
      'What were the framework agreement guidelines under RA 9184?',
      'What did the Generic Procurement Manual say about the BAC?',
      'What was the pilot eMarketplace?',
      'What were the alternative methods of procurement under the 2016 IRR?',
    ],
  },
  bills: {
    label: 'Bills', short: 'Bills',
    note: 'Pending bills. Proposals are not law.',
    statuses: ['PROPOSED'],
    suggestions: ['Is HB 7917 already law?', 'What does HB 07917 propose?', 'When was HB 07917 filed?'],
  },
  versions: {
    label: 'Withdrawn & superseded', short: 'Withdrawn',
    note: 'Withdrawn or superseded editions, shown with what replaced them. Never the current rule.',
    statuses: ['WITHDRAWN', 'SUPERSEDED'], includeNonDefault: true,
    suggestions: [
      'Should we still use the March 31, 2026 IRR?',
      'Why was the IRR 1st Edition withdrawn?',
      'What should I cite instead of the March 2026 IRR?',
    ],
  },
} as const satisfies Record<string, ScopeDef>;

export type ScopeKey = keyof typeof SCOPES;
export const SCOPE_KEYS = Object.keys(SCOPES) as ScopeKey[];
export const isScopeKey = (s: unknown): s is ScopeKey => typeof s === 'string' && s in SCOPES;

/** SQL predicate over `chunks` (alias c) for a scope. Returns the clause and its params, numbered from `start`. */
export function scopeFilter(scope: ScopeKey, start: number): { sql: string; params: unknown[] } {
  const s: ScopeDef = SCOPES[scope];
  const parts: string[] = [];
  const params: unknown[] = [];
  const p = (v: unknown) => { params.push(v); return `$${start + params.length - 1}`; };
  if (!s.includeNonDefault) parts.push('c.index_default = true');
  if (s.statuses) parts.push(`c.status = any(${p(s.statuses)}::text[])`);
  if (s.ids) parts.push(`c.document_id = any(${p(s.ids)}::text[])`);
  if (s.types) parts.push(`c.doc_type = any(${p(s.types)}::text[])`);
  if (s.framework) parts.push(`c.framework = ${p(s.framework)}`);
  return { sql: parts.length ? parts.join(' and ') : 'true', params };
}
