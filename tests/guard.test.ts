import { describe, expect, it } from 'vitest';
import { ABSTAIN_MESSAGE } from '../lib/evidence-policy';
import { AnswerGuard, checkStatement, guardAnswer, isClaim, sentencesOf } from '../lib/guard';
import type { Evidence } from '../lib/types';

const ev = (o: Partial<Evidence>): Evidence => ({
  n: 1, id: 'c', documentId: 'D', reference: 'Doc', status: 'CURRENT', framework: 'RA12009', authority: 3, kind: 'resolution',
  label: 'CURRENT_RULE', section: null, page: null, issuingBody: 'GPPB', dateLabel: null, note: null, sourceUrl: null, companion: false, text: '', ...o,
});

const ADVISORY = ev({
  n: 1, documentId: 'GPPB-ADV-09-2026', reference: 'GPPB-TSO Public Advisory No. 09-2026 — Withdrawal of IRR 1st Edition', kind: 'advisory',
  issuingBody: 'GPPB-TSO', dateLabel: 'issued 31 Jul 2026',
  text: 'The GPPB-TSO advises that the "Implementing Rules and Regulations of Republic Act No. 12009 (1st Edition, as of 31 March 2026)" ' +
    'has been withdrawn and should no longer be used as reference. All concerned are reminded to use and cite only the IRR of RA No. 12009 ' +
    'approved by the GPPB through its Resolution No. 02-2025 dated 04 February 2025, published in the Official Gazette on 10 February 2025, ' +
    'and effective 25 February 2025.',
});
const WITHDRAWN = ev({
  n: 2, documentId: 'IRR-2026', reference: 'IRR of RA 12009 (1st Edition, as of 31 March 2026)', status: 'WITHDRAWN', label: 'VERSION_ONLY', kind: 'irr',
  note: 'Withdrawn by GPPB-TSO Public Advisory No. 09-2026 on 31 Jul 2026.',
  text: 'Section 35. Negotiated Procurement. The Procuring Entity may resort to negotiated procurement in the following instances.',
});
const BILL = ev({ n: 3, documentId: 'HB', reference: 'HB 07917 — Act amending RA 12009', status: 'PROPOSED', label: 'PROPOSAL_ONLY', kind: 'bill',
  text: 'This bill proposes to prohibit public officials from participating in procurement contracts.' });
const ALL = [ADVISORY, WITHDRAWN, BILL];

describe('checkStatement', () => {
  it('accepts a statement whose facts are in the source it cites', () => {
    expect(checkStatement('The 1st Edition of the IRR was withdrawn and should no longer be used as reference [E1].', [ADVISORY]).ok).toBe(true);
    expect(checkStatement('The IRR approved through Resolution No. 02-2025 took effect on 25 Feb 2025 [E1].', [ADVISORY]).ok).toBe(true);
  });

  it.each([
    ['an invented executive order', 'Procurement is also governed by Executive Order No. 138 [E1].'],
    ['an invented name for the law', 'RA 12009 is known as the Government Procurement Modernization Act [E1].'],
    ['a wrong year', 'The IRR was approved by the GPPB in 2009 [E1].'],
    ['a wrong date', 'The IRR took effect on 25 March 2025 [E1].'],
    ['a section the source does not contain', 'Sec. 99 of RA 12009 requires three quotations [E1].'],
    ['a different law', 'The withdrawal was ordered under RA 9184 [E1].'],
    ['an invented amount', 'The penalty for using the withdrawn edition is 50,000 pesos [E1].'],
    ['an unknown acronym', 'The withdrawal was confirmed by the DPWH [E1].'],
    ['wording that is not in the source', 'Bidders who wear red shirts are disqualified from every competitive tender [E1].'],
  ])('rejects %s', (_, statement) => {
    expect(checkStatement(statement, [ADVISORY]).ok).toBe(false);
  });

  it('rejects a statement that names no source', () => {
    expect(checkStatement('The IRR was withdrawn.', [])).toMatchObject({ ok: false, reason: 'no-citation' });
  });

  it('never lets a withdrawn edition or a bill be stated as the current rule or as law', () => {
    expect(checkStatement('The 1st Edition of the IRR is the current rule on negotiated procurement [E2].', [WITHDRAWN])).toMatchObject({ ok: false, reason: 'status-conflict' });
    expect(checkStatement('The 1st Edition of the IRR is no longer the current rule [E2].', [WITHDRAWN]).ok).toBe(true);
    expect(checkStatement('HB 07917 is already law and prohibits public officials from participating [E3].', [BILL])).toMatchObject({ ok: false, reason: 'status-conflict' });
    expect(checkStatement('HB 07917 proposes to prohibit public officials from participating in procurement contracts [E3].', [BILL]).ok).toBe(true);
  });
});

describe('guardAnswer', () => {
  it('shows only supported statements and counts what it removed', () => {
    const { text, stats } = guardAnswer([
      'The 1st Edition of the IRR has been withdrawn and should no longer be used as reference [E1].',
      'It was replaced under Executive Order No. 138 of 2022 [E1].',
      'Use only the IRR approved through Resolution No. 02-2025, effective 25 February 2025 [E1].',
    ].join(' '), ALL);
    expect(text).toContain('has been withdrawn');
    expect(text).toContain('Resolution No. 02-2025');
    expect(text).not.toContain('Executive Order');
    expect(stats).toMatchObject({ checked: 3, kept: 2, removed: 1, shown: 2 });
  });

  it('adds the citation itself when the model forgot it and one source supports the statement', () => {
    const { text, stats } = guardAnswer('- The 1st Edition of the IRR has been withdrawn and should no longer be used as reference.', ALL);
    expect(text).toBe('- The 1st Edition of the IRR has been withdrawn and should no longer be used as reference [E1].');
    expect(stats.recited).toBe(1);
  });

  it('corrects a citation that points at the wrong source', () => {
    const { text } = guardAnswer('The IRR approved through Resolution No. 02-2025 is effective 25 February 2025 [E3].', ALL);
    expect(text).toContain('[E1]');
    expect(text).not.toContain('[E3]');
  });

  it('removes a statement citing a source that was never retrieved, unless a retrieved one supports it', () => {
    expect(guardAnswer('Bidders must post a bond of 2 million pesos [E9].', ALL).text).toBe(ABSTAIN_MESSAGE);
  });

  it('removes statements that lean on a removed statement', () => {
    const { text, stats } = guardAnswer('The frameworks are RA 9184 and Executive Order No. 138 [E1]. These frameworks are currently in effect [E1].', ALL);
    expect(text).toBe(ABSTAIN_MESSAGE);
    expect(stats.reasons['depends-on-removed']).toBe(1);
  });

  it('drops headings and lead-ins when nothing verified follows them', () => {
    const { text } = guardAnswer('Key points:\n- The penalty is 5 years in prison [E1].\n\nThe requirements are:\n- A bond of 2 million pesos [E1].', ALL);
    expect(text).toBe(ABSTAIN_MESSAGE);
  });

  it('does not leave a dangling lead-in at the end of a line', () => {
    const { text } = guardAnswer('The 1st Edition has been withdrawn and should no longer be used as reference [E1]. Therefore:', ALL);
    expect(text).toBe('The 1st Edition has been withdrawn and should no longer be used as reference [E1].');
  });

  it('keeps a heading when a verified statement follows it', () => {
    const { text } = guardAnswer('Key points:\n- The 1st Edition has been withdrawn and should no longer be used as reference [E1].', ALL);
    expect(text).toBe('Key points:\n- The 1st Edition has been withdrawn and should no longer be used as reference [E1].');
  });

  it('drops a false abstention sentence when verified statements follow, and keeps it when none do', () => {
    const mixed = guardAnswer(`${ABSTAIN_MESSAGE} The 1st Edition has been withdrawn and should no longer be used as reference [E1].`, ALL);
    expect(mixed.text).not.toContain(ABSTAIN_MESSAGE);
    expect(mixed.text).toContain('withdrawn');
    expect(guardAnswer(ABSTAIN_MESSAGE, ALL).text).toBe(ABSTAIN_MESSAGE);
  });

  it('never shows anything when there is no evidence at all', () => {
    expect(guardAnswer('RA 12009 took effect in 2024 and requires competitive bidding for all goods.', []).text).toBe(ABSTAIN_MESSAGE);
  });

  it('shows text that is never anything the model did not write, apart from citation markers', () => {
    const answer = 'The 1st Edition has been withdrawn and should no longer be used as reference. It carries a fine of 1,000 pesos [E1].';
    const { text } = guardAnswer(answer, ALL);
    for (const sentence of sentencesOf(text.replace(/\s*\[E\d\]/g, ''))) expect(answer).toContain(sentence.trim());
  });
});

describe('streaming', () => {
  it('gives the same result however the text is cut into pieces', () => {
    const answer = 'Key points:\n- The 1st Edition has been withdrawn and should no longer be used as reference [E1].\n- A fine of 9,000 pesos applies [E1].\n- Use only the IRR approved through Resolution No. 02-2025 [E1].';
    const whole = guardAnswer(answer, ALL).text;
    for (const size of [1, 3, 7, 50]) {
      const g = new AnswerGuard(ALL);
      let out = '';
      for (let i = 0; i < answer.length; i += size) out += g.push(answer.slice(i, i + size));
      out += g.flush();
      expect(out.replace(/\n{3,}/g, '\n\n').trim(), `chunks of ${size}`).toBe(whole);
    }
  });

  it('holds a line back until it is complete', () => {
    const g = new AnswerGuard(ALL);
    expect(g.push('The penalty is 5 years')).toBe('');
    expect(g.push(' in prison [E1].\n')).toBe('');
    expect(g.flush()).toBe(ABSTAIN_MESSAGE);
  });
});

describe('helpers', () => {
  it('tells statements from headings', () => {
    expect(isClaim('Key points:')).toBe(false);
    expect(isClaim('Short answer')).toBe(false);
    expect(isClaim('The IRR took effect in 2025')).toBe(true);
    expect(isClaim('Procuring entities must post notices online')).toBe(true);
  });

  it('does not split on abbreviations', () => {
    expect(sentencesOf('Under Sec. 35 of RA No. 12009 it applies. The BAC decides.')).toEqual(['Under Sec. 35 of RA No. 12009 it applies.', 'The BAC decides.']);
  });
});

describe('dates', () => {
  it('reads every common way of writing a date as the same date', async () => {
    const { datesIn } = await import('../lib/guard');
    for (const d of ['25 February 2025', 'February 25, 2025', '25 Feb 2025', 'Feb. 25, 2025', '25th of February, 2025', '2025-02-25'])
      expect(datesIn(`effective ${d}.`).dates, d).toEqual(['2025-02-25']);
    expect(datesIn('in February 2025').dates).toEqual(['2025-02']);
  });

  it('accepts a date in another format, and a month and year taken from a full date', () => {
    expect(checkStatement('The IRR took effect on February 25, 2025 [E1].', [ADVISORY]).ok).toBe(true);
    expect(checkStatement('The IRR took effect in February 2025 [E1].', [ADVISORY]).ok).toBe(true);
  });

  it('rejects a date assembled from parts of other dates in the same source', () => {
    expect(checkStatement('The IRR took effect on 25 March 2025 [E1].', [ADVISORY])).toMatchObject({ ok: false, detail: 'date 2025-03-25' });
    expect(checkStatement('The edition was withdrawn on 31 March 2025 [E1].', [ADVISORY]).ok).toBe(false);
  });
});

describe('sentence-by-sentence release', () => {
  const S1 = 'The 1st Edition has been withdrawn and should no longer be used as reference [E1].';
  const S2 = 'Use only the IRR approved through Resolution No. 02-2025, effective 25 February 2025 [E1].';
  const BAD = 'A fine of 9,000 pesos applies to anyone who cites it [E1].';

  it('shows a cited sentence as soon as the next one has begun, without waiting for the end of the line', () => {
    const g = new AnswerGuard(ALL);
    expect(g.push(S1)).toBe('');                                   // could still be continued
    expect(g.push(` ${S2.slice(0, 40)}`)).toBe(S1);                // the next sentence has begun
    expect(g.push(S2.slice(40))).toBe('');
    expect(g.flush()).toBe(` ${S2}\n`);
  });

  it('removes an unsupported sentence in the middle without holding up the ones around it', () => {
    const g = new AnswerGuard(ALL);
    let out = '';
    for (const piece of `${S1} ${BAD} ${S2} Thank you.`.match(/.{1,9}/g)!) out += g.push(piece);
    out += g.flush();
    expect(out).toBe(`${S1} ${S2} Thank you.\n`);
    expect(g.stats).toMatchObject({ checked: 3, shown: 2, removed: 1 });
  });

  it('releases an uncited sentence at once when one source clearly supports it, adding the citation', () => {
    const g = new AnswerGuard(ALL);
    const uncited = 'The 1st Edition has been withdrawn and should no longer be used as reference.';
    expect(g.push(`${uncited} ${S2.slice(0, 30)}`)).toBe('The 1st Edition has been withdrawn and should no longer be used as reference [E1].');
  });

  it('makes an uncited sentence that no single source clearly supports wait for the end of its line', () => {
    const g = new AnswerGuard(ALL);
    // Supported only loosely: it needs the citation that closes the line.
    const loose = 'The withdrawn edition should no longer be used, suppliers say.';
    expect(g.push(`${loose} ${S2} And more`)).toBe('');           // it blocks what follows, so the order is kept
    const out = g.push(' text.\n');
    expect(out).toContain('The withdrawn edition should no longer be used, suppliers say [E1].');
    expect(out).toContain('Resolution No. 02-2025');
    expect(out.indexOf('suppliers say')).toBeLessThan(out.indexOf('Resolution No. 02-2025'));
  });

  it('does not mistake a citation that is still arriving for the start of a new sentence', () => {
    const g = new AnswerGuard(ALL);
    const bare = 'The 1st Edition has been withdrawn and should no longer be used as reference.';
    expect(g.push(`${bare} [E`)).toBe('');                        // "[E" is not the start of a sentence
    expect(g.push('1] ')).toBe('');
    // The marker stays with the sentence it follows, and that sentence is released once the next has begun.
    expect(g.push(`${S2} `)).toBe(`${bare} [E1]`);
    expect(g.push('Next sentence starts here')).toBe(` ${S2}`);
  });

  it('keeps the bullet with the first sentence released from a list item', () => {
    const g = new AnswerGuard(ALL);
    expect(g.push(`Key points:\n- ${S1} ${S2.slice(0, 30)}`)).toBe(`Key points:\n- ${S1}`);
  });

  it('holds a table row until it is complete', () => {
    const g = new AnswerGuard(ALL);
    expect(g.push('| Withdrawn edition | Should no longer be used as reference [E1]. | Next cell text is still')).toBe('');
  });

  it('never shows, at any moment, text that the finished answer does not contain', () => {
    const answers = [
      `${S1} ${BAD} ${S2}`,
      `Key points:\n- ${S1}\n- ${BAD}\n\nThe requirements are:\n- ${BAD}`,
      `${ABSTAIN_MESSAGE} ${S1} These are currently in effect [E1].`,
      `Yes. ${S1} It was replaced under Executive Order No. 138 [E1]. This order is still valid [E1].\n\n| Item | Status |\n|---|---|\n| 1st Edition | withdrawn, should no longer be used as reference [E1] |`,
      `The 1st Edition has been withdrawn and should no longer be used as reference. ${S2}\nHB 07917 is already law [E3]. HB 07917 proposes to prohibit public officials from participating in procurement contracts [E3].`,
      BAD,
    ];
    for (const answer of answers) {
      const whole = guardAnswer(answer, ALL);
      for (const size of [1, 2, 5, 11, 23, 64, 500]) {
        const g = new AnswerGuard(ALL);
        let out = '';
        for (let i = 0; i < answer.length; i += size) {
          out += g.push(answer.slice(i, i + size));
          // Whatever has been shown so far is the beginning of the final answer.
          if (whole.text !== ABSTAIN_MESSAGE) expect(whole.text.replace(/\s+/g, ' ').startsWith(out.replace(/\s+/g, ' ').trim()), `size ${size}: "${out}"`).toBe(true);
          else expect(out, `size ${size}`).toBe('');
        }
        out += g.flush();
        expect(out.replace(/\n{3,}/g, '\n\n').trim(), `size ${size}`).toBe(whole.text);
        expect(g.stats, `size ${size}`).toEqual(whole.stats);
      }
    }
  });
});
