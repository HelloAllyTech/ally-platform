import { LearnedSection } from '../enum/bot-draft.enum';
import { extractDocument } from '../../knowledge-base/extractor/index';
import { KbDocumentSourceType } from '../../knowledge-base/enum/knowledge-base.enum';
import { chunkDocument } from '../../knowledge-base/util/chunker';
import {
  factHeading,
  learnedFactsText,
} from '../service/learned-facts-document';
import type { LearnedFact } from '../type/bot-draft.type';

/**
 * Q3-fast Part 2, fix 1: the learned facts as a document where each fact is its own passage, so
 * "What are the Mumbai centre's hours?" finds "open 9:00 am - 8:00 pm" instead of a long page.
 */
const fact = (
  section: LearnedSection,
  text: string,
  sourceTitle: string | null = 'Mpower - The Centre, Mumbai | Mpower',
  extra: Partial<LearnedFact> = {},
): LearnedFact => ({
  id: text.slice(0, 8),
  section,
  text,
  sourceUrl: 'https://mpowerminds.com/mumbai',
  sourceTitle,
  ...extra,
});

const FACTS = [
  fact(
    LearnedSection.HOURS,
    'MPOWER- THE CENTRE (MUMBAI) is open 9:00 am - 8:00 pm',
  ),
  fact(
    LearnedSection.LOCATION,
    'Mpower Mumbai is at 1/155, Nyaymurti Sitaram Patkar Marg, Hughes Road, Mumbai - 400 007.',
  ),
  fact(
    LearnedSection.POLICIES,
    'Cancellations must be informed at least 48 hours in advance.',
    'Terms &amp; Conditions – Mpower',
  ),
  fact(LearnedSection.BRAND, 'Logo found: /logo.png.'),
  fact(LearnedSection.FAQS, 'We see children and teenagers.', null, {
    byOwner: true,
    sourceUrl: 'owner',
  }),
];

describe('learned facts as a document (Q3-fast Part 2)', () => {
  it('heads each fact with its section and page, as a heading the extractor accepts', () => {
    expect(factHeading(FACTS[0])).toBe('Hours, Mpower The Centre Mumbai');
    expect(factHeading(FACTS[2])).toBe('Policies, Terms & Conditions');
    expect(factHeading(FACTS[4])).toBe('Common questions, from the owner');
    const long = fact(
      LearnedSection.SERVICES,
      'x.',
      'A very long page title that goes on and on well past ten words in all',
    );
    const heading = factHeading(long);
    expect(heading.split(' ').length).toBeLessThanOrEqual(10);
    expect(heading.length).toBeLessThanOrEqual(80);
    expect(heading).not.toMatch(/[.!?;:,]$/);
  });

  it('leaves out brand facts, and ends every fact with a full stop', () => {
    const text = learnedFactsText(FACTS);
    expect(text).not.toContain('Logo found');
    expect(text).toContain('is open 9:00 am - 8:00 pm.\n');
    expect(learnedFactsText([])).toBe('');
  });

  it('becomes one passage per fact through the real extractor and chunker', async () => {
    const extracted = await extractDocument({
      sourceType: KbDocumentSourceType.PASTE,
      text: learnedFactsText(FACTS),
      headingsInSections: true,
    } as never);
    const chunks = chunkDocument(extracted);
    expect(chunks).toHaveLength(4);
    expect(chunks.map((c) => c.sectionPath)).toEqual([
      'Hours, Mpower The Centre Mumbai',
      'Location and contact, Mpower The Centre Mumbai',
      'Policies, Terms & Conditions',
      'Common questions, from the owner',
    ]);
    // The heading travels with its fact, so the passage names where it came from.
    expect(chunks[0].text).toBe(
      'Hours, Mpower The Centre Mumbai\nMPOWER- THE CENTRE (MUMBAI) is open 9:00 am - 8:00 pm.',
    );
  });
});
