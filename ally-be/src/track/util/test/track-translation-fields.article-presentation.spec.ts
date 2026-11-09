import {
  applyItemFields,
  extractItemFields,
  toTranslatedField,
} from '../track-translation-fields.util';
import { TrackItem } from '../../entity/track-item.entity';
import { TrackItemType } from '../../type/track.type';
import { TranslatedFieldMap } from '../../type/track-translation.type';

const article = (content: Record<string, unknown>): TrackItem =>
  ({
    id: 'item-1',
    trackId: 'track-1',
    trackSectionId: 'section-1',
    order: 1,
    title: 'Reflective listening',
    type: TrackItemType.ARTICLE,
    content: { html: '<p>Say it back.</p>', ...content },
  }) as unknown as TrackItem;

describe('article translation fields - cover and takeaways', () => {
  const source = article({
    experience: 'MAGAZINE',
    cover: { url: 'https://cdn.example.com/a.jpg', alt: 'A quiet room' },
    takeaways: ['Name the feeling first.', 'Use your own words.'],
  });

  it('extracts the cover description and each takeaway', () => {
    const paths = extractItemFields(source).map((field) => field.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        'content.cover.alt',
        'content.takeaways[0]',
        'content.takeaways[1]',
      ]),
    );
  });

  it('applies translations without touching the cover url or experience', () => {
    const map: TranslatedFieldMap = {};
    for (const field of extractItemFields(source)) {
      map[field.path] = toTranslatedField(field, `hi:${field.value}`);
    }
    const localized = applyItemFields(source, map).content as any;
    expect(localized.cover).toEqual({
      url: 'https://cdn.example.com/a.jpg',
      alt: 'hi:A quiet room',
    });
    expect(localized.takeaways).toEqual([
      'hi:Name the feeling first.',
      'hi:Use your own words.',
    ]);
    expect(localized.experience).toBe('MAGAZINE');
    // The source item is left as it was.
    expect((source.content as any).takeaways[0]).toBe(
      'Name the feeling first.',
    );
  });

  it('extracts nothing extra from an article without them', () => {
    const paths = extractItemFields(article({})).map((field) => field.path);
    expect(paths.some((path) => path.startsWith('content.takeaways'))).toBe(
      false,
    );
    expect(paths).not.toContain('content.cover.alt');
  });
});
