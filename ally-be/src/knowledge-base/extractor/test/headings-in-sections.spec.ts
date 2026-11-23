import { KbDocumentSourceType } from '../../enum/knowledge-base.enum';
import { chunkDocument } from '../../util/chunker';
import { extractDocument } from '../index';

/**
 * Agents v2 chunk 20a-2: a crawled page's headings stay with the text they introduce, for an
 * onboarded assistant's documents only. Off, pasted text extracts exactly as before.
 */
describe('extractDocument: headings in their sections (pasted text)', () => {
  // The real estate fixture's home and project pages, as the crawl pastes them.
  const page = [
    'Greenfield Meadows',
    'Two towers of 14 floors on 3.2 acres.',
    '',
    'Amenities',
    "Clubhouse, pool, children's play area, and a 1 km walking track.",
  ].join('\n');

  const chunks = async (headingsInSections?: boolean) =>
    chunkDocument(
      await extractDocument({
        sourceType: KbDocumentSourceType.PASTE,
        text: page,
        headingsInSections,
      }),
    );

  it('off: unchanged, so a heading is chunked apart from its text', async () => {
    const texts = (await chunks()).map((c) => c.text);
    expect(texts).toContain('Greenfield Meadows');
    expect(texts.some((t) => t.startsWith('Two towers'))).toBe(true);
  });

  it('on: each heading starts the chunk of the text it introduces', async () => {
    const found = await chunks(true);
    expect(found.map((c) => c.text)).toEqual([
      'Greenfield Meadows\nTwo towers of 14 floors on 3.2 acres.',
      "Amenities\nClubhouse, pool, children's play area, and a 1 km walking track.",
    ]);
    expect(found.map((c) => c.sectionPath)).toEqual([
      'Greenfield Meadows',
      'Amenities',
    ]);
    expect(found.every((c) => c.tokenCount >= 10)).toBe(true);
  });

  it('is ignored for every other source type', async () => {
    const extracted = await extractDocument({
      sourceType: KbDocumentSourceType.PASTE,
      text: 'No headings here, just a sentence.',
      headingsInSections: true,
    });
    expect(extracted.sections).toEqual([]);
  });
});
