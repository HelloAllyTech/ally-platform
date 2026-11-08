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
