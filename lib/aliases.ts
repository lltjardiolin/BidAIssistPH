// Identifier normalization (PDR B4.2). Shared by ingestion (chunk reference tokens) and retrieval
// (query tokens), so both sides always agree on the token format.
import { manifest } from './manifest';

const pad = (n: string, w: number) => n.replace(/^0+(?=\d)/, '').padStart(w, '0');

// Order matters: the most specific patterns run first and blank out what they matched.
const PATTERNS: Array<[RegExp, (m: RegExpExecArray) => string]> = [
  [/\bNPM\s*(?:No\.?\s*)?(\d{1,3})\s*[-–]\s*(\d{4})\b/gi, m => `NPM-${pad(m[1], 3)}-${m[2]}`],
  [/\bCirc(?:ular)?s?\.?\s*(?:No\.?\s*)?(\d{1,2})\s*[-–]\s*(\d{4})\b/gi, m => `CIRC-${pad(m[1], 2)}-${m[2]}`],
  [/\b(?:Public\s+)?Adv(?:isory)?\.?\s*(?:No\.?\s*)?(\d{1,2})\s*[-–]\s*(\d{4})\b/gi, m => `ADV-${pad(m[1], 2)}-${m[2]}`],
  [/\bRes(?:olution)?s?\.?\s*(?:No\.?\s*)?(\d{1,2})\s*[-–]\s*(\d{4})\b/gi, m => `RES-${pad(m[1], 2)}-${m[2]}`],
  [/\b(?:H\.?\s?B\.?|House\s+Bill)\s*(?:No\.?\s*)?(\d{1,5})\b/gi, m => `HB${pad(m[1], 5)}`],
  [/\b(?:R\.?\s?A\.?|Republic\s+Act)\s*(?:No\.?\s*)?(\d{3,5})\b/gi, m => `RA${m[1]}`],
  [/\bSec(?:tion)?s?\.?\s*(\d{1,3})(?:\.\d+)*\b/gi, m => `SEC${Number(m[1])}`],
  [/\bRule\s+([IVXLC]{1,6})\b/g, m => `RULE-${m[1]}`],
];

/** Extract canonical reference tokens: RA12009, HB07917, RES-10-2026, CIRC-06-2026, ADV-09-2026, NPM-019-2026, SEC113, RULE-V. */
export function extractTokens(text: string): string[] {
  const out = new Set<string>();
  let rest = text;
  for (const [re, fmt] of PATTERNS) {
    rest = rest.replace(re, (...args) => {
      const m = args.slice(0, -2) as unknown as RegExpExecArray;
      out.add(fmt(m));
      return ' ';
    });
  }
  return [...out];
}

// Identity tokens and alias phrases per document, built once from the manifest.
const tokenToDocs = new Map<string, Set<string>>();
const phraseToDoc: Array<[RegExp, string]> = [];

function addToken(token: string, id: string) {
  if (!tokenToDocs.has(token)) tokenToDocs.set(token, new Set());
  tokenToDocs.get(token)!.add(id);
}

function idToken(id: string): string | null {
  const m = /^GPPB-(RES|ADV|NPM)-(\d+)-(\d{4})$/.exec(id);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  if (/^(RA\d+|HB\d+)$/.test(id)) return id;
  return null;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

for (const d of manifest.documents) {
  const own = idToken(d.id);
  if (own) addToken(own, d.id);
  for (const alias of d.aliases ?? []) {
    // Identifier aliases ("Circular No. 06-2026") map by token; everything else by phrase ("NGPA", "March 2026 IRR").
    const toks = extractTokens(alias).filter(t => !t.startsWith('SEC') && !t.startsWith('RULE'));
    if (toks.length) toks.forEach(t => addToken(t, d.id));
    else phraseToDoc.push([new RegExp(`(^|[^\\w])${escape(alias)}(?=$|[^\\w])`, 'i'), d.id]);
  }
}

export type NormalizedQuery = {
  text: string;          // query text used for lexical + vector search
  tokens: string[];      // reference tokens found in the query
  ids: string[];         // document ids resolved from identifiers and alias phrases
  sections: string[];    // SEC tokens
};

/** "March 31, 2026" / "31 March 2026" / "Mar. 31 2026" → "March 2026", so edition aliases match any date style. */
const MONTH = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const FULL_MONTH: Record<string, string> = { jan: 'January', feb: 'February', mar: 'March', apr: 'April', may: 'May', jun: 'June',
  jul: 'July', aug: 'August', sep: 'September', oct: 'October', nov: 'November', dec: 'December' };
export function dropDays(text: string): string {
  const month = (m: string) => FULL_MONTH[m.slice(0, 3).toLowerCase()];
  return text
    .replace(new RegExp(`\\b${MONTH}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`, 'gi'), (_, m, y) => `${month(m)} ${y}`)
    .replace(new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTH}\\.?,?\\s+(\\d{4})\\b`, 'gi'), (_, m, y) => `${month(m)} ${y}`);
}

export function normalizeAliases(query: string): NormalizedQuery {
  const tokens = extractTokens(query);
  const ids = new Set<string>();
  for (const t of tokens) for (const id of tokenToDocs.get(t) ?? []) ids.add(id);
  const loose = dropDays(query);
  for (const [re, id] of phraseToDoc) if (re.test(query) || re.test(loose)) ids.add(id);
  // "IRR of RA 12009" names the IRR, not only the Act.
  if (/\bIRR\b|implementing rules/i.test(query) && ids.has('RA12009') && !/\b(2016|revised|9184)\b/i.test(query)) ids.add('RA12009-IRR-2025');
  // Expand identifiers into plain numbers so the lexical index (which sees "Republic Act No. 12009") can match "RA12009".
  const expansions = tokens.flatMap(t => {
    const m = /^(?:RA|HB)0*(\d+)$/.exec(t) ?? /^(?:RES|CIRC|ADV|NPM)-0*(\d+)-(\d{4})$/.exec(t);
    return m ? m.slice(1).filter(Boolean) : [];
  });
  return {
    text: expansions.length ? `${query} ${expansions.join(' ')}` : query,
    tokens,
    ids: [...ids],
    sections: tokens.filter(t => t.startsWith('SEC')),
  };
}
