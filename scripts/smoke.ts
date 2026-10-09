// Retrieval smoke test (PDR D4): prints the evidence ids per question and fails on version/scope leaks.
// No LLM involved. Usage: npm run smoke
import { getPool } from '../lib/db';
import { docsById } from '../lib/manifest';
import { retrieveEvidence } from '../lib/retrieval';
import type { ScopeKey } from '../lib/scopes';
import type { RetrievalResult } from '../lib/types';

type Case = {
  q: string; scope: ScopeKey;
  expect?: string[];                       // at least one of these documents must be retrieved
  first?: string;                          // this document must rank first
  forbid?: string[];                       // none of these may appear
  abstain?: boolean;
  check?: (r: RetrievalResult) => string | null;
};

const WITHDRAWN = 'RA12009-IRR-2026-03-31-WITHDRAWN';
const onlyTypes = (types: string[]) => (r: RetrievalResult) => {
  const bad = r.evidence.filter(e => !e.companion && !types.includes(e.kind));
  return bad.length ? `out-of-scope evidence: ${bad.map(e => `${e.documentId} (${e.kind})`).join(', ')}` : null;
};

const CASES: Case[] = [
  { q: 'What governed procurement before RA 12009?', scope: 'all', expect: ['RA12009', 'GPPB-RES-05-2025', 'RA9184-IRR-2016'], forbid: [WITHDRAWN] },
  { q: 'What is the NGPA?', scope: 'all', expect: ['RA12009'], forbid: [WITHDRAWN] },
  { q: 'What is the current IRR?', scope: 'all', expect: ['RA12009-IRR-2025', 'GPPB-RES-02-2025', 'GPPB-ADV-09-2026'], forbid: [WITHDRAWN] },
  { q: 'Is the March 31, 2026 IRR still valid?', scope: 'all', expect: ['GPPB-ADV-09-2026'],
    check: r => r.evidence.some(e => e.documentId === WITHDRAWN && e.label !== 'VERSION_ONLY') ? 'withdrawn IRR not labelled VERSION_ONLY' : null },
  { q: 'When did the new standard forms become mandatory?', scope: 'all', expect: ['GPPB-RES-03-2025'], forbid: [WITHDRAWN] },
  { q: 'Compare RA 9184 and RA 12009', scope: 'all', expect: ['RA12009'], forbid: [WITHDRAWN],
    check: r => new Set(r.evidence.map(e => e.framework)).size < 2 ? 'comparison retrieved a single framework' : null },
  { q: 'What documents do I need for negotiated procurement?', scope: 'all', expect: ['GPPB-RES-10-2026'], forbid: [WITHDRAWN] },
  { q: 'What are the framework agreement guidelines?', scope: 'all', first: 'GPPB-RES-12-2026', forbid: [WITHDRAWN] },
  { q: 'What does Circular No. 06-2026 require?', scope: 'all', first: 'GPPB-RES-10-2026' },
  { q: 'Can direct acquisition be used for customized goods?', scope: 'opinions', expect: ['GPPB-NPM-019-2026'], check: onlyTypes(['opinion']) },
  { q: 'What are the grounds for post-disqualification?', scope: 'opinions', expect: ['GPPB-NPM-032-2026'], check: onlyTypes(['opinion']) },
  { q: 'What was the rule on framework agreements?', scope: 'ra9184', expect: ['GPPB-RES-27-2019'],
    check: r => r.evidence.some(e => !e.companion && e.framework !== 'RA9184') ? 'non-RA 9184 evidence in RA 9184 tab' : null },
  { q: 'Should we still use the March 31, 2026 IRR?', scope: 'versions', expect: [WITHDRAWN, 'GPPB-ADV-09-2026'] },
  { q: 'What are the rules on tie-breaking?', scope: 'issuances', expect: ['GPPB-RES-08-2026'], forbid: [WITHDRAWN] },
  { q: 'Ano ang mga dokumento para sa negotiated procurement?', scope: 'all', expect: ['GPPB-RES-10-2026'], forbid: [WITHDRAWN] },
  // HB 07917 bill text (official House record) is in the corpus; alias HB 7917 must resolve and the bill must rank first.
  { q: 'Is HB 7917 already law?', scope: 'bills', expect: ['HB07917'], first: 'HB07917', forbid: [WITHDRAWN], check: onlyTypes(['bill']) },
  // In the mixed scope the bill must still resolve by number and be flagged PROPOSAL_ONLY (never CURRENT_RULE).
  { q: 'What does HB 7917 propose on public officials participating in procurement?', scope: 'all', expect: ['HB07917'], first: 'HB07917',
    check: r => !r.flags?.hasProposal ? 'hasProposal flag not set' : r.evidence.some(e => e.documentId === 'HB07917' && e.label !== 'PROPOSAL_ONLY') ? 'bill evidence not labelled PROPOSAL_ONLY' : null },
];

let failed = 0;
const t0 = Date.now();
try {
  for (const c of CASES) {
    const t = Date.now();
    const r = await retrieveEvidence({ query: c.q, scope: c.scope });
    const ids = r.evidence.map(e => e.documentId);
    const problems: string[] = [];
    if (c.abstain !== undefined && r.abstain !== c.abstain) problems.push(`abstain=${r.abstain}, expected ${c.abstain}`);
    if (!c.abstain && r.abstain) problems.push(`unexpected abstention (${r.reason})`);
    if (c.expect && !c.expect.some(id => ids.includes(id))) problems.push(`none of [${c.expect.join(', ')}] retrieved`);
    if (c.first && ids[0] !== c.first) problems.push(`first is ${ids[0]}, expected ${c.first}`);
    for (const id of c.forbid ?? []) if (ids.includes(id)) problems.push(`forbidden ${id} retrieved`);
    // Withdrawn/superseded evidence must never travel without the record that replaced it.
    for (const e of r.evidence) {
      const d = docsById.get(e.documentId);
      if (e.status === 'WITHDRAWN' && !(d?.withdrawn_by && ids.includes(d.withdrawn_by))) problems.push(`${e.documentId} without its withdrawal record`);
    }
    const extra = c.check?.(r);
    if (extra) problems.push(extra);

    if (problems.length) failed++;
    console.log(`${problems.length ? 'FAIL' : 'ok  '} [${c.scope}] ${c.q}  (${Date.now() - t} ms)`);
    console.log('       ' + (r.abstain ? `ABSTAIN (${r.reason})` : r.evidence.map(e => `${e.n}:${e.documentId}${e.companion ? '+' : ''}${e.section ? `/${e.section}` : ''}`).join('  ')));
    for (const p of problems) console.log(`       ✗ ${p}`);
  }
} finally {
  await getPool().end();
}
console.log(`\n${CASES.length - failed}/${CASES.length} passed in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
process.exit(failed ? 1 : 0);
