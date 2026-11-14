import { readFileSync } from 'fs';
import { join } from 'path';
import { ONBOARDING_COPY, fill } from '../copy/onboarding-copy';

const DECK = readFileSync(
  join(__dirname, '../../../../docs/agents-v2/ONBOARDING-COPY.md'),
  'utf8',
);

describe('onboarding copy', () => {
  it.each([
    ONBOARDING_COPY.opening,
    ONBOARDING_COPY.readingDone,
    ONBOARDING_COPY.describedDone,
    ONBOARDING_COPY.looksRight,
    ...Object.values(ONBOARDING_COPY.problems),
    ...Object.values(ONBOARDING_COPY.findings),
  ])('is the deck’s: %s', (line) => {
    expect(DECK).toContain(line);
  });

  it('uses the deck’s chips', () => {
    expect(DECK).toContain(ONBOARDING_COPY.openingChips.join(' · '));
  });

  it('fills placeholders and leaves unknown ones', () => {
    expect(fill('Read {n} of {max}', { n: 3 })).toBe('Read 3 of {max}');
  });
});

describe('chat notes after an edit', () => {
  // Imported here so the deck test covers the labels the notes use.

  const { summarise } = require('../service/bot-draft.service');
  const learned = {
    facts: [
      { id: 'f', section: 'hours', text: 'x', sourceUrl: 'https://a.example/' },
    ],
    dropped: 0,
  };

  it.each([
    [
      [{ op: 'replace', path: '/facts/0/text', value: 'y' }],
      'learned',
      'Updated your hours',
    ],
    [
      [{ op: 'replace', path: '/declineText', value: 'y' }],
      'draft',
      "Updated what it says when it doesn't know",
    ],
    [
      [
        { op: 'replace', path: '/introduction', value: 'y' },
        { op: 'replace', path: '/tone', value: 'formal' },
      ],
      'draft',
      'Updated its introduction and its tone',
    ],
  ])('reads as the owner would say it', (ops, target, note) => {
    expect(summarise(ops, target, learned)).toBe(note);
  });

  it('uses the deck’s words', () => {
    for (const what of [
      'your hours',
      "what it says when it doesn't know",
      'its introduction',
    ]) {
      expect(DECK).toContain(what);
    }
  });
});
