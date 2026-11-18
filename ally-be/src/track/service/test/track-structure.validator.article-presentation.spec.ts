import { validateTrackStructure } from '../track-structure.validator';
import { ArticleExperience, TrackItemType } from '../../type/track.type';
import { UpsertTrackSectionDto } from '../../dto/upsert-track-structure.dto';

const wrap = (content: Record<string, unknown>): UpsertTrackSectionDto[] => [
  {
    title: 'S',
    order: 1,
    items: [
      {
        type: TrackItemType.ARTICLE,
        order: 1,
        title: 'Reflective listening',
        content: { html: '<h2>Why</h2><p>Say it back.</p>', ...content } as any,
      },
    ],
  },
];

const validate = (content: Record<string, unknown>) => () =>
  validateTrackStructure(wrap(content));

describe('validateTrackStructure - article presentation', () => {
  it('accepts an article written before experiences existed', () => {
    expect(validate({})).not.toThrow();
  });

  it('accepts every experience with a cover and takeaways', () => {
    for (const experience of Object.values(ArticleExperience)) {
      expect(
        validate({
          experience,
          cover: { url: 'https://cdn.example.com/a.jpg', alt: 'A quiet room' },
          takeaways: ['Name the feeling first.', 'Use your own words.'],
        }),
      ).not.toThrow();
    }
  });

  it('accepts a highlight box in the html', () => {
    expect(
      validate({
        html: '<p>Try this.</p><div data-ally-callout="say"><p>"It sounds hard."</p></div>',
      }),
    ).not.toThrow();
  });

  it('rejects an unknown experience', () => {
    expect(validate({ experience: 'SLIDES' })).toThrow(
      /reading experience must be classic, magazine or cards/,
    );
  });

  it('rejects a cover that is not an uploaded https file', () => {
    expect(validate({ cover: { url: 'javascript:alert(1)' } })).toThrow(
      /cover photo must be an uploaded file/,
    );
    expect(validate({ cover: { url: 'http://example.com/a.jpg' } })).toThrow(
      /cover photo must be an uploaded file/,
    );
  });

  it('rejects an overlong cover description', () => {
    expect(
      validate({
        cover: { url: 'https://cdn.example.com/a.jpg', alt: 'x'.repeat(301) },
      }),
    ).toThrow(/300 characters or fewer/);
  });

  it('rejects more than five takeaways', () => {
    expect(validate({ takeaways: ['a', 'b', 'c', 'd', 'e', 'f'] })).toThrow(
      /at most 5 key takeaways/,
    );
  });

  it('rejects an empty or overlong takeaway', () => {
    expect(validate({ takeaways: ['Fine', '  '] })).toThrow(
      /key takeaway 2 is empty/,
    );
    expect(validate({ takeaways: ['y'.repeat(201)] })).toThrow(
      /200 characters or fewer/,
    );
  });
});
