// Grounding guard. Sits between the model and the reader: a statement is shown only if it cites a retrieved
// source AND what it says can be found in that source. Pure code, no model involved, so it cannot be talked
// out of its rules. It checks statements one line at a time, so answers still stream.
//
// What it guarantees: every number, date, identifier and named law, order or body in a shown statement
// appears in the source that statement cites, most of its wording does too, and it does not call a withdrawn,
// superseded, historical or proposed document the current rule.
// What it cannot guarantee: that the model combined two true facts correctly (for example, attaching the
// right date to the wrong law when both are in the same passage). The sources stay one click away for that.
import { extractTokens } from './aliases';
import { normalizeCitations } from './citations';
import { ABSTAIN_MESSAGE } from './evidence-policy';
import { manifest } from './manifest';
import type { Evidence } from './types';

export type DropReason = 'no-citation' | 'unknown-source' | 'number-not-in-source' | 'name-not-in-source'
  | 'wording-not-in-source' | 'status-conflict' | 'depends-on-removed';
export type Verdict = { ok: true; support: number } | { ok: false; reason: DropReason; detail: string };
export type GuardStats = {
  checked: number; kept: number; removed: number;
  /** Statements whose citation was added or corrected by the guard after it found the supporting source. */
  recited: number;
  /** Verified statements that actually reached the reader. */
  shown: number;
  reasons: Partial<Record<DropReason, number>>; removedText: string[];
};

/** Share of a statement's content words that must be found in the cited source. */
export const MIN_SUPPORT = Number(process.env.GUARD_MIN_SUPPORT || 0.6);
/** Stricter bar when the model gave no usable citation and the guard has to find the source itself. */
export const MIN_SUPPORT_UNCITED = Math.max(MIN_SUPPORT, Number(process.env.GUARD_MIN_SUPPORT_UNCITED || 0.75));

const STOP = new Set((
  'a an the of to in on for and or but nor is are was were be been being do does did have has had it its this that these those ' +
  'as at by from with into than then so if not no yes any all some such which who whom whose what when where why how can could ' +
  'should would will shall may might must also only both either each other more most very there their they them we you i he she ' +
  'his her our your per via about under over between within without during before after above below up down out off again further ' +
  'however therefore thus hence while because since until although though according based following including include includes ' +
  'ang ng mga sa na ay at o para kung may ito iyon din rin lang'
).split(/\s+/));

const MONTHS: Record<string, string> = { jan: 'jan', feb: 'feb', mar: 'mar', apr: 'apr', may: 'may', jun: 'jun', jul: 'jul', aug: 'aug',
  sep: 'sep', oct: 'oct', nov: 'nov', dec: 'dec' };

export function stem(word: string): string {
  let w = word.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (w.length > 5) w = w.replace(/(ational|ations|ation|ments|ment|ings|ing|ities|ity|ness|ives|ive|ally|ly|ed|es|s)$/, '');
  else if (w.length > 3) w = w.replace(/(ed|es|s)$/, '');
  return w.slice(0, 6);
}

const words = (s: string) => s.split(/[^A-Za-z0-9]+/).filter(Boolean);
const contentStems = (s: string) => words(s).filter(w => !/^\d+$/.test(w) && w.length >= 3 && !STOP.has(w.toLowerCase())).map(stem).filter(w => w.length >= 3);
const numbersIn = (s: string) => (s.replace(/(\d),(?=\d{3}\b)/g, '$1').match(/\d+(?:\.\d+)?/g) ?? []).map(n => n.replace(/^0+(?=\d)/, ''));
const monthsIn = (s: string) => (s.toLowerCase().match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/g) ?? []).map(m => MONTHS[m.slice(0, 3)]);
const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const MONTH_NO: Record<string, string> = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08',
  sep: '09', oct: '10', nov: '11', dec: '12' };
const MON = '(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?';
const DATE_PATTERNS: Array<[RegExp, (m: RegExpExecArray) => string]> = [
  [new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MON},?\\s+(\\d{4})\\b`, 'gi'), m => `${m[3]}-${MONTH_NO[m[2].toLowerCase()]}-${m[1].padStart(2, '0')}`],
  [new RegExp(`\\b${MON}\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`, 'gi'), m => `${m[3]}-${MONTH_NO[m[1].toLowerCase()]}-${m[2].padStart(2, '0')}`],
  [/\b(\d{4})-(\d{2})-(\d{2})\b/g, m => `${m[1]}-${m[2]}-${m[3]}`],
  [new RegExp(`\\b${MON},?\\s+(\\d{4})\\b`, 'gi'), m => `${m[2]}-${MONTH_NO[m[1].toLowerCase()]}`],
];

/**
 * Dates are compared whole. Checking day, month and year separately would accept "25 March 2025" from a
 * source that says "25 February 2025" and "31 March 2026". Returns the dates and the text without them.
 */
export function datesIn(text: string): { dates: string[]; rest: string } {
  const dates: string[] = [];
  let rest = text;
  for (const [re, canon] of DATE_PATTERNS)
    rest = rest.replace(re, (...a) => { dates.push(canon(a.slice(0, -2) as unknown as RegExpExecArray)); return ' '; });
  return { dates, rest };
}

// What a document's status lets an answer say about it. These words come from the registry entry, not the text.
const STATUS_WORDS: Record<string, string> = {
  VERSION_ONLY: 'withdrawn superseded replaced longer current rule valid use used cite cited rely instead reference edition version official',
  HISTORICAL_ONLY: 'historical previous previously former formerly old earlier era longer current rule governed counterpart framework',
  PROPOSAL_ONLY: 'bill proposed proposes proposal propose law enacted pending filed yet',
  INTERPRETIVE_ONLY: 'opinion opined opines interpretive interpretation guidance policy board',
  HISTORICAL_OPINION: 'opinion opined opines interpretive interpretation guidance historical previous previously former formerly old earlier era predates longer current rule governed counterpart framework',
  CURRENT_RULE: 'current currently force effect rule applies governs framework',
};

type Source = { text: string; stems: Set<string>; numbers: Set<string>; months: Set<string>; tokens: Set<string>; dates: Set<string>; evidence: Evidence };

export function toSource(e: Evidence): Source {
  // The card's own metadata is part of the source: its title, dates, section and status note.
  const all = [e.reference, e.section, e.dateLabel, e.note, e.issuingBody, e.status, e.text].filter(Boolean).join('\n');
  const dates = datesIn(all).dates;
  return { text: ` ${squash(all)} `, stems: new Set([...contentStems(all), ...contentStems(STATUS_WORDS[e.label] ?? '')]),
    numbers: new Set(numbersIn(all)), months: new Set(monthsIn(all)), tokens: new Set(extractTokens(all)),
    // A full date also vouches for its month and year ("February 2025").
    dates: new Set([...dates, ...dates.map(d => d.slice(0, 7))]), evidence: e };
}

// Names the corpus itself uses (document titles, aliases, issuing bodies) are known names everywhere.
const KNOWN_ACRONYMS = new Set(
  manifest.documents.flatMap(d => [d.reference, d.issuing_body, ...(d.aliases ?? [])]).join(' ').match(/\b[A-Z][A-Za-z]*[A-Z][A-Za-z]*\b/g) ?? []);

// Full names of bodies and instruments, each checked to occur in the indexed documents (28 Sep 2026).
// They expand an abbreviation; they assert nothing, so they are accepted wherever they appear.
const KNOWN_NAMES = [
  'Government Procurement Policy Board', 'Technical Support Office', 'Bids and Awards Committee', 'Procuring Entity',
  'Head of the Procuring Entity', 'New Government Procurement Act', 'Government Procurement Reform Act',
  'Implementing Rules and Regulations', 'Republic Act', 'Official Gazette', 'Annual Procurement Plan', 'Commission on Audit',
  'Department of Budget and Management', 'Philippine Government Electronic Procurement System', 'Commission on Elections',
  'Procurement Service', ...manifest.documents.map(d => d.reference.split(' — ')[0]),
].map(n => ` ${squashName(n)} `);
function squashName(s: string) { return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
const isKnownName = (name: string) => KNOWN_NAMES.some(k => k.includes(` ${squashName(name)} `));

const LEGAL_NOUN = /\b(Act|Acts|Order|Orders|Code|Resolution|Circular|Advisory|Law|Decree|Agenda|Rules|Regulations|Manual|Board|Office|Commission|Committee|Department|Court|Authority|Agency|Bill|Proclamation|Memorandum|Opinion)\b/;
const NAME = /\b[A-Z][A-Za-z]+(?:\s+(?:of|the|and|for|on|in|No\.?)\s+|\s+)(?:[A-Z][A-Za-z]+|\d+)(?:(?:\s+(?:of|the|and|for|on|in|No\.?)\s+|\s+)(?:[A-Z][A-Za-z]+|\d+))*/g;

const CURRENT_CLAIM = /\b(is|are|remains?) (the |still )?(current|in force|in effect|applicable|authoritative|valid|governing)\b|\bthe rule is\b|\bstill (valid|applies|in force|governs?)\b|\b(currently|now) (governs?|applies|in force)\b/i;
const LAW_CLAIM = /\b(is|became|has become|was enacted as|is now|already) (a |the )?law\b|\bhas been enacted\b|\bwas signed into law\b/i;
const NEGATED = /\b(not|no longer|never|isn't|aren't|wasn't|cannot|withdrawn|superseded|repealed|replaced|historical|previously|formerly|should not|must not|do not|hindi)\b/i;

/** A line or sentence that asserts something, as opposed to a heading or a connective such as "Key points:". */
export function isClaim(text: string): boolean {
  const plain = text.replace(/\[E\d{1,2}\]/g, ' ');
  return /\d/.test(plain) || contentStems(plain).length >= 3;
}

export function checkStatement(statement: string, cited: Evidence[], minSupport = MIN_SUPPORT): Verdict {
  if (!cited.length) return { ok: false, reason: 'no-citation', detail: 'the statement names no source' };
  const full = statement.replace(/\[E\d{1,2}\]/g, ' ').replace(/[*_`#>|]/g, ' ');
  const sources = cited.map(toSource);
  const has = <T>(pick: (s: Source) => Set<T>, v: T) => sources.some(s => pick(s).has(v));

  // 1. Dates, identifiers, numbers and months must be in the cited source. Dates are matched whole.
  const { dates, rest: plain } = datesIn(full);
  for (const d of dates) if (!has(s => s.dates, d)) return { ok: false, reason: 'number-not-in-source', detail: `date ${d}` };
  for (const t of extractTokens(plain)) if (!has(s => s.tokens, t)) return { ok: false, reason: 'number-not-in-source', detail: t };
  const identifierDigits = new Set(extractTokens(plain).flatMap(t => numbersIn(t)));
  for (const n of numbersIn(plain)) if (!identifierDigits.has(n) && !has(s => s.numbers, n)) return { ok: false, reason: 'number-not-in-source', detail: n };
  for (const m of monthsIn(plain)) if (!has(s => s.months, m)) return { ok: false, reason: 'number-not-in-source', detail: m };

  // 2. Named laws, orders, bodies and acronyms must be in the cited source.
  for (const name of full.match(NAME) ?? []) {
    if (!LEGAL_NOUN.test(name) || isKnownName(name)) continue;
    if (!sources.some(s => s.text.includes(` ${squash(name)} `))) return { ok: false, reason: 'name-not-in-source', detail: name };
  }
  for (const found of plain.match(/\b[A-Z][A-Za-z]*[A-Z][A-Za-z]*\b/g) ?? []) {
    const a = found.replace(/(?<=[A-Z])s$/, '');            // "IRRs" → "IRR"
    if (KNOWN_ACRONYMS.has(a)) continue;
    if (!sources.some(s => s.text.includes(` ${squash(a)} `))) return { ok: false, reason: 'name-not-in-source', detail: a };
  }

  // 3. Most of the wording must be in the cited source.
  const stems = [...new Set(contentStems(full))];
  const support = stems.length ? stems.filter(w => has(s => s.stems, w)).length / stems.length : 1;
  if (support < minSupport)
    return { ok: false, reason: 'wording-not-in-source', detail: `${Math.round(support * 100)}% of its wording is in the source` };

  // 4. Status: a source that is not the current rule cannot be the basis of a "current rule" statement.
  if (CURRENT_CLAIM.test(full) && !NEGATED.test(full) && cited.every(e => e.label === 'VERSION_ONLY' || e.label === 'HISTORICAL_ONLY' || e.label === 'HISTORICAL_OPINION' || e.label === 'PROPOSAL_ONLY'))
    return { ok: false, reason: 'status-conflict', detail: `${cited[0].status} source stated as current` };
  if (LAW_CLAIM.test(full) && !NEGATED.test(full) && cited.some(e => e.label === 'PROPOSAL_ONLY'))
    return { ok: false, reason: 'status-conflict', detail: 'a bill stated as law' };
  return { ok: true, support };
}

/** A statement that only makes sense together with the one before it ("These are…", "It replaced…"). */
const DEPENDENT = /^\W*(this|these|those|it|they|such|both|the above|the former|the latter|additionally|furthermore|moreover|however|therefore|thus|also)\b/i;

const markersIn = (s: string) => [...new Set([...s.matchAll(/\[E(\d{1,2})\]/g)].map(m => Number(m[1])))];

/** Splits a line into sentences without losing any character, so kept text is exactly what the model wrote. */
export function sentencesOf(line: string): string[] {
  const guarded = line.replace(/\b(Sec|Secs|No|Nos|Res|Circ|Adv|Art|vs|Inc|Dr|Mr|Ms|e\.g|i\.e|R\.A|H\.B)\.(\s)/g, '$1.\u0001$2');
  // A citation marker after the full stop belongs to the sentence before it, so it never starts a sentence.
  const parts = guarded.split(/(?<=[.!?][)"”’]?(?:\s*\[E\d{1,2}\])*)\s+(?=[A-Z"“(]|\[(?!E\d))/);
  return parts.map(p => p.replace(/\u0001/g, ''));
}

const PREFIX = /^\s*(?:[-*+•]\s+|\d{1,2}[.)]\s+|#{1,6}\s+|>\s+)?/;
const LEAD_IN = /:\s*(\[E\d{1,2}\]\s*)*$/;
/** How much text must follow a sentence before it is treated as finished while the answer is still arriving. */
const LOOKAHEAD = 16;

/**
 * One process, whether the answer arrives in one piece or a character at a time: statements are taken in
 * order and each is decided once. A statement that carries its own citation is released as soon as the next
 * one has begun; one that relies on a citation later in its line waits for the end of that line. Releasing
 * early changes when a statement appears, never whether it does.
 */
export class AnswerGuard {
  readonly stats: GuardStats = { checked: 0, kept: 0, removed: 0, recited: 0, shown: 0, reasons: {}, removedText: [] };
  private buffer = '';
  private heldAbstention = false;
  private lastClaimRemoved = false;
  /** Whole lines (headings, blank lines, lead-ins) waiting for a verified statement to follow them. */
  private pending: string[] = [];
  private byN: Map<number, Evidence>;
  private all: Evidence[];

  // The line being read.
  private open = false;            // some of it has already been taken from the buffer
  private prefix = '';             // its bullet, number or heading mark
  private emitted = false;         // some of it has reached the reader
  private hold: string[] = [];     // connectives waiting for a verified statement in this line
  private claims = 0;              // statements seen in this line
  private markers = new Set<number>();

  constructor(evidence: Evidence[]) { this.all = evidence; this.byN = new Map(evidence.map(e => [e.n, e])); }

  /** Feed model text as it arrives; returns the verified text that may be shown now. */
  push(delta: string): string {
    this.buffer += delta;
    let out = '';
    for (let nl = this.buffer.indexOf('\n'); nl >= 0; nl = this.buffer.indexOf('\n')) {
      const rest = this.buffer.slice(0, nl);
      this.buffer = this.buffer.slice(nl + 1);
      out += this.endLine(rest);
    }
    return out + this.early();
  }

  /** Call when the model has finished. Returns the last verified text, or the abstention if nothing held up. */
  flush(): string {
    const last = this.buffer || this.open ? this.endLine(this.buffer) : '';
    this.buffer = '';
    this.pending = [];
    if (this.stats.shown === 0 && (this.stats.checked > 0 || this.heldAbstention)) return ABSTAIN_MESSAGE;
    return last;
  }

  private drop(text: string, v: Extract<Verdict, { ok: false }>) {
    this.stats.removed++;
    this.lastClaimRemoved = true;
    this.stats.reasons[v.reason] = (this.stats.reasons[v.reason] ?? 0) + 1;
    if (this.stats.removedText.length < 20) this.stats.removedText.push(`${v.reason} (${v.detail}): ${text.trim().slice(0, 160)}`);
  }

  /** The single retrieved source that best supports the statement, if any does. */
  private bestSource(unit: string, minSupport: number): { n: number; verdict: Extract<Verdict, { ok: true }> } | null {
    let best: { n: number; verdict: Extract<Verdict, { ok: true }> } | null = null;
    for (const e of this.all) {
      const v = checkStatement(unit, [e], minSupport);
      if (v.ok && (!best || v.support > best.verdict.support)) best = { n: e.n, verdict: v };
    }
    return best;
  }

  /** The cited sources if they support the statement; otherwise the single retrieved source that does. */
  private verify(unit: string, markers: number[]): { verdict: Verdict; markers: number[]; recited: boolean } {
    const unknown = markers.filter(n => !this.byN.has(n));
    const first: Verdict = !markers.length ? { ok: false, reason: 'no-citation', detail: 'the statement names no source' }
      : unknown.length ? { ok: false, reason: 'unknown-source', detail: `E${unknown[0]} was not retrieved` }
      : checkStatement(unit, markers.map(n => this.byN.get(n)!));
    if (first.ok || first.reason === 'status-conflict') return { verdict: first, markers, recited: false };
    const best = this.bestSource(unit, markers.length ? MIN_SUPPORT : MIN_SUPPORT_UNCITED);
    return best ? { verdict: best.verdict, markers: [best.n], recited: true } : { verdict: first, markers, recited: false };
  }

  /** Decides one statement. Returns the text to show, or null when it is removed. */
  private decide(unit: string, fallback: number[]): string | null {
    this.claims++;
    this.stats.checked++;
    if (this.lastClaimRemoved && DEPENDENT.test(unit.replace(/\[E\d{1,2}\]/g, ''))) {
      this.drop(unit, { ok: false, reason: 'depends-on-removed', detail: 'it refers to a statement that was removed' });
      return null;
    }
    const own = markersIn(unit);
    // A statement with no citation of its own is first matched to the one source that clearly supports it. This
    // needs nothing from the rest of the line, so it can be decided at once. Failing that, it may rely on a
    // citation elsewhere in its line.
    const clear = own.length ? null : this.bestSource(unit, MIN_SUPPORT_UNCITED);
    const { verdict, markers, recited } = clear ? { verdict: clear.verdict, markers: [clear.n], recited: true }
      : this.verify(unit, own.length ? own : fallback);
    if (!verdict.ok) { this.drop(unit, verdict); return null; }
    this.stats.kept++;
    this.lastClaimRemoved = false;
    if (recited) this.stats.recited++;
    if (own.length && !recited) return unit;
    const bare = recited ? unit.replace(/\s*\[E\d{1,2}\]/g, '') : unit;
    const cite = markers.map(n => `[E${n}]`).join(' ');
    // The marker goes inside the sentence, before its full stop, so it is read as belonging to it.
    return /[.!?]["”’)]?\s*$/.test(bare) ? bare.trimEnd().replace(/([.!?]["”’)]?)$/, ` ${cite}$1`) : `${bare.trimEnd()} ${cite}`;
  }

  /** Sends verified text of the current line to the reader, with anything that was waiting for it. */
  private show(text: string, claims: number): string {
    const tidy = (t: string) => t.replace(/(\[E\d{1,2}\])(?:\s*\1)+/g, '$1');
    const lead = this.emitted ? ' ' : this.pending.map(l => `${l}\n`).join('') + this.prefix;
    this.pending = [];
    this.emitted = true;
    this.stats.shown += claims;
    const held = this.hold.length ? `${this.hold.join(' ')} ` : '';
    this.hold = [];
    return lead + tidy(held + text);
  }

  private begin(text: string): string {
    if (this.open) return text;
    this.open = true;
    this.prefix = PREFIX.exec(text)?.[0] ?? '';
    return text.slice(this.prefix.length);
  }

  /** While a line is still arriving: release its leading statements that carry their own citation. */
  private early(): string {
    this.buffer = normalizeCitations(this.buffer);
    const peek = this.open ? this.buffer : this.buffer.slice((PREFIX.exec(this.buffer)?.[0] ?? '').length);
    if (!peek.trim() || peek.trimStart().startsWith('|')) return '';      // a table row is decided whole
    const units = sentencesOf(peek);
    const tail = units.at(-1) ?? '';
    // The last piece is still being written. A short piece that opens with a bracket may be a citation on its way.
    let complete = units.length - 1;
    if (complete > 0 && (tail.length < LOOKAHEAD) && /^[\[(]/.test(tail)) complete--;
    if (complete <= 0) return '';

    let out = '';
    let taken = 0;
    for (const unit of units.slice(0, complete)) {
      // A statement that can only be decided with the rest of its line must wait, and so must what follows it.
      if (!this.decidable(unit)) break;
      if (!taken) this.begin(this.buffer);
      taken++;
      out += this.take(unit, []);
    }
    if (taken) this.buffer = units.slice(taken).join(' ');
    return out;
  }

  /** True when the outcome for this statement cannot depend on text that has not arrived yet. */
  private decidable(unit: string): boolean {
    if (unit.includes(ABSTAIN_MESSAGE) || !isClaim(unit) || markersIn(unit).length > 0) return true;
    if (this.lastClaimRemoved && DEPENDENT.test(unit)) return true;
    return this.bestSource(unit, MIN_SUPPORT_UNCITED) !== null;
  }

  private take(unit: string, fallback: number[]): string {
    for (const n of markersIn(unit)) this.markers.add(n);
    if (unit.includes(ABSTAIN_MESSAGE)) { this.heldAbstention = true; return ''; }     // decided at the end
    if (!isClaim(unit)) { this.hold.push(unit); return ''; }
    const kept = this.decide(unit, fallback);
    return kept === null ? '' : this.show(kept, 1);
  }

  /** The rest of a line, now that all of it is known. */
  private endLine(rest: string): string {
    const raw = normalizeCitations(rest);
    // A blank line or a table rule carries no statement; it waits with the headings.
    if (!this.open && (!raw.trim() || /^\s*\|?\s*:?-{2,}/.test(raw))) { this.pending.push(raw); return ''; }

    const body = this.begin(raw);
    for (const n of markersIn(body)) this.markers.add(n);
    const fallback = [...this.markers];
    const units = !body.trim() ? [] : body.trimStart().startsWith('|') ? [body] : sentencesOf(body);
    let out = '';
    let leadIn: string | null = null;

    for (const [i, unit] of units.entries()) {
      if (unit.includes(ABSTAIN_MESSAGE)) { this.heldAbstention = true; continue; }
      if (!isClaim(unit)) { this.hold.push(unit); continue; }
      const kept = this.decide(unit, fallback);
      if (kept === null) continue;
      // "The requirements are:" is shown only if a verified statement follows it.
      if (i === units.length - 1 && LEAD_IN.test(kept)) { leadIn = kept; continue; }
      out += this.show(kept, 1);
    }

    if (this.emitted) {
      // Connectives after the last statement ("Thank you.") close the line. One that opens something
      // ("Therefore:") waits, like any lead-in, for a verified statement to follow.
      const closing = this.hold.filter(h => !LEAD_IN.test(h));
      const opening = this.hold.filter(h => LEAD_IN.test(h));
      if (closing.length) out += ` ${closing.join(' ')}`;
      out += '\n';
      if (opening.length) this.pending.push(opening.join(' '));
    } else if (this.claims === 0 && this.hold.length) {
      this.pending.push(this.prefix + this.hold.join(' '));              // a heading or connective line
    }
    if (leadIn !== null) this.pending.push((this.emitted ? '' : this.prefix) + leadIn);

    this.open = false; this.prefix = ''; this.emitted = false; this.hold = []; this.claims = 0;
    this.markers = new Set();
    return out;
  }
}

/** Whole-answer form of the guard, for tests and the evaluation harness. */
export function guardAnswer(answer: string, evidence: Evidence[]): { text: string; stats: GuardStats } {
  const g = new AnswerGuard(evidence);
  const text = (g.push(answer) + g.flush()).replace(/\n{3,}/g, '\n\n').trim();
  return { text, stats: g.stats };
}
