import { describe, expect, it } from 'vitest';
import { contextualQuery, isFollowUp } from '../lib/conversation';

const FIRST = 'What documents do I need for negotiated procurement?';

describe('isFollowUp', () => {
  it.each([
    'What about for infrastructure projects?', 'How about consulting services?', 'Why?', 'Can you explain that further?',
    'Which of those are required for foreign bidders?', 'And the deadline?', 'Is it still valid?', 'Tell me more',
    'Paano naman kung infrastructure?', 'Explain the second one in simpler terms',
  ])('follow-up: %s', q => expect(isFollowUp(q)).toBe(true));

  it.each([
    'What are the framework agreement guidelines under the new law for procuring entities?',
    'What does Circular No. 06-2026 require?', 'Is HB 7917 already law?', 'What is the NGPA?',
    'What are the grounds for post-disqualification of a bidder during evaluation?',
  ])('stands alone: %s', q => expect(isFollowUp(q)).toBe(false));
});

describe('contextualQuery', () => {
  it('searches a first question as it is', () => {
    expect(contextualQuery([FIRST])).toBe(FIRST);
  });

  it('searches a follow-up together with the question it follows', () => {
    expect(contextualQuery([FIRST, 'What about for infrastructure projects?'])).toBe(`${FIRST} What about for infrastructure projects?`);
  });

  it('keeps the original question through a chain of follow-ups', () => {
    expect(contextualQuery([FIRST, 'What about for infrastructure projects?', 'Why?'])).toBe(`${FIRST} Why?`);
  });

  it('starts fresh when the topic changes', () => {
    const next = 'What are the framework agreement guidelines under the new law for procuring entities?';
    expect(contextualQuery([FIRST, next])).toBe(next);
    expect(contextualQuery([FIRST, next, 'Is it time-bound?'])).toBe(`${next} Is it time-bound?`);
  });

  it('does not drag the old topic into a question that names its own document', () => {
    expect(contextualQuery([FIRST, 'Is HB 7917 already law?'])).toBe('Is HB 7917 already law?');
  });
});
