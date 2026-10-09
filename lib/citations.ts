// Post-generation citation check (PDR B5.4). Pure function: runs on the server after the stream
// completes and again in the evaluation harness.
import { ABSTAIN_MESSAGE } from './evidence-policy';

export type CitationCheck = {
  cited: number[];          // evidence numbers the answer cites
  invalid: number[];        // cited numbers that were never returned
  claims: number;           // sentences that make a legal/procedural claim
  uncited: number;          // …of which carry no marker
  uncitedRatio: number;
  partiallyVerified: boolean;
  unverified: boolean;      // makes claims but cites no retrieved source at all
  abstained: boolean;
};

export const CITE = /\[E(\d{1,2})\]/g;

/**
 * Models write citations in several ways: "(E1)", "[E1, E2]", "(E1 and E2)", "[E1][E2]". They are rewritten
 * to the one form the UI and the checks understand, "[E1] [E2]". Only markers are touched, never the claim.
 */
export function normalizeCitations(text: string): string {
  return text.replace(/[\[(]\s*(E\d{1,2}(?:\s*(?:,|and|&|;|-|–)\s*E\d{1,2})*)\s*[\])]/g, (_, inner: string) =>
    (inner.match(/E\d{1,2}/g) ?? []).map(e => `[${e}]`).join(' '));
}

const CLAIM = new RegExp([
  'shall', 'must', 'may not', 'required?', 'requires', 'prohibit', 'allow', 'mandatory', 'effective', 'took effect',
  'approved', 'published', 'withdrawn', 'superseded', 'repeal', 'amend', 'provides?', 'states?', 'governs?', 'applies',
  'section', 'sec\\.', 'rule', 'resolution', 'circular', 'penalt', 'threshold', 'deadline', 'within \\d+', '\\d{4}',
  'dapat', 'kailangan', 'bawal', 'ipinagbabawal', 'pinapayagan',
].join('|'), 'i');

export function splitSentences(text: string): string[] {
  return text
    .replace(/\|/g, '\n')                                 // table cells are separate claims
    .replace(/\b(Sec|No|Res|Circ|Adv|Art|R\.A|vs|e\.g|i\.e)\.\s/g, '$1. ')
    .split(/(?<=[.!?])\s+(?=[A-Z"“(\[])|\n+/)
    .map(s => s.replace(/ /g, ' ').replace(/^[\s>*#\-•\d.)]+/, '').trim())
    .filter(s => s.replace(CITE, '').replace(/[\s\-:|]/g, '').length >= 20);
}

export function checkCitations(raw: string, evidenceCount: number): CitationCheck {
  const answer = normalizeCitations(raw);
  const abstained = answer.includes(ABSTAIN_MESSAGE);
  const cited = [...new Set([...answer.matchAll(CITE)].map(m => Number(m[1])))].sort((a, b) => a - b);
  const invalid = cited.filter(n => n < 1 || n > evidenceCount);
  const claims = splitSentences(answer).filter(s => CLAIM.test(s) && !s.includes(ABSTAIN_MESSAGE));
  const uncited = claims.filter(s => !/\[E\d{1,2}\]/.test(s)).length;
  const uncitedRatio = claims.length ? uncited / claims.length : 0;
  const valid = cited.filter(n => !invalid.includes(n));
  const unverified = !abstained && claims.length > 0 && valid.length === 0;
  return {
    cited, invalid, claims: claims.length, uncited, uncitedRatio, abstained, unverified,
    partiallyVerified: !abstained && (unverified || invalid.length > 0 || uncitedRatio > 0.2),
  };
}
