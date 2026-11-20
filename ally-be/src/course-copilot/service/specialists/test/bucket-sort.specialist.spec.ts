import { validateTrackItemContent } from 'src/track/service/track-structure.validator';
import { TrackItemType } from 'src/track/type/track.type';
import {
  BucketSortSpecialist,
  normaliseBucketSortOutput,
} from '../bucket-sort.specialist';
import { SpecialistValidationError } from '../specialist.types';
import {
  fakeLlm,
  makeBlueprint,
  makeContext,
} from './specialist-test.fixtures';

const opts = {
  title: 'Sort the responses',
  itemCount: 6,
  keepIds: new Set<string>(),
};

/** Written the sloppy ways models write it: `label`/`title` for names, bucket by name. */
const SORT = {
  instructions: 'Drag each reply to where it belongs.',
  buckets: [
    { name: 'Helpful', hint: 'Keeps the person talking' },
    { label: 'Unhelpful' },
    'Harmful',
  ],
  items: [
    {
      text: '"That sounds really heavy."',
      bucket: 'Helpful',
      explanation: 'A reflection.',
    },
    {
      statement: '"Have you tried yoga?"',
      bucket: 'Unhelpful',
      feedback: 'Advice too soon.',
    },
    {
      text: '"Others have it worse."',
      bucket: 'Harmful',
      explanation: 'Minimises.',
    },
    {
      text: '"Tell me more."',
      bucket: 'helpful',
      explanation: 'Open invitation.',
    },
  ],
};

describe('normaliseBucketSortOutput', () => {
  it('turns loose output into valid bucket sort content', () => {
    const { content, summary } = normaliseBucketSortOutput(SORT, opts);

    expect(() =>
      validateTrackItemContent({ type: TrackItemType.BUCKET_SORT, content }),
    ).not.toThrow();
    expect(content.intro).toBe('Drag each reply to where it belongs.');
    expect(content.buckets.map((b: any) => b.label)).toEqual([
      'Helpful',
      'Unhelpful',
      'Harmful',
    ]);
    // Bucket names match regardless of case, and every item lands in a real bucket.
    const ids = new Set(content.buckets.map((b: any) => b.id));
    expect(content.items.every((i: any) => ids.has(i.bucketId))).toBe(true);
    expect(content.items[1].explanation).toBe('Advice too soon.');
    expect(summary).toBe('4 items in 3 buckets');
  });

  it('drops duplicate items', () => {
    const { content } = normaliseBucketSortOutput(
      { ...SORT, items: [...SORT.items, { ...SORT.items[0] }] },
      opts,
    );
    expect(content.items).toHaveLength(4);
  });

  it('sends back a bucket nothing belongs in', () => {
    const error = (() => {
      try {
        normaliseBucketSortOutput(
          { ...SORT, buckets: [...SORT.buckets, 'Neutral'] },
          opts,
        );
      } catch (caught) {
        return caught;
      }
    })() as SpecialistValidationError;
    expect(error).toBeInstanceOf(SpecialistValidationError);
    expect(error.errors.join(' ')).toContain('"Neutral"');
  });

  it('on the repair pass, removes the empty bucket instead', () => {
    const { content } = normaliseBucketSortOutput(
      { ...SORT, buckets: [...SORT.buckets, 'Neutral'] },
      { ...opts, lenient: true },
    );
    expect(content.buckets.map((b: any) => b.label)).not.toContain('Neutral');
  });

  it('refuses a sort with fewer than two buckets', () => {
    expect(() =>
      normaliseBucketSortOutput(
        { buckets: ['Helpful'], items: [SORT.items[0], SORT.items[3]] },
        opts,
      ),
    ).toThrow(SpecialistValidationError);
  });
});

describe('BucketSortSpecialist', () => {
  const blueprint = makeBlueprint();
  const base = makeContext(blueprint.sections[0].items[0].id, {}, blueprint);
  const context = {
    ...base,
    item: {
      ...base.item,
      type: 'BUCKET_SORT',
      title: 'Sort the responses',
    } as any,
    referenceMaterial: 'REFERENCE MATERIAL\n[1] Manual.pdf, p. 3\nUse these.',
  };

  it('writes from the brief and passes reference passages through', async () => {
    const llm = fakeLlm([SORT]);
    const output = await new BucketSortSpecialist(llm.service).generate(
      context,
    );

    expect(output.summary).toBe('4 items in 3 buckets');
    expect(llm.complete.mock.calls[0][0].prompt).toContain('Manual.pdf, p. 3');
  });
});
