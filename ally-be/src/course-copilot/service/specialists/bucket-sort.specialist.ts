import { Injectable } from '@nestjs/common';
import { LlmTask } from 'src/learn/enum/llm-task.enum';
import {
  TRACK_MAX_BUCKET_SORT_BUCKETS,
  TRACK_MAX_BUCKET_SORT_DESCRIPTION,
  TRACK_MAX_BUCKET_SORT_EXPLANATION,
  TRACK_MAX_BUCKET_SORT_ITEM_TEXT,
  TRACK_MAX_BUCKET_SORT_LABEL,
  TRACK_MIN_BUCKET_SORT_BUCKETS,
  TRACK_MIN_BUCKET_SORT_ITEMS,
} from 'src/track/constants/track.constant';
import {
  BucketSortBucket,
  BucketSortContent,
  BucketSortItem,
} from 'src/track/type/bucket-sort.type';
import { TrackItemType } from 'src/track/type/track.type';
import {
  COURSE_COPILOT_AI_TASKS,
  COURSE_COPILOT_LIMITS,
  COURSE_COPILOT_PROMPTS,
} from '../../constants/course-copilot.constants';
import { SpecialistLlmService } from './specialist-llm.service';
import {
  ItemSpecialist,
  SpecialistContext,
  SpecialistOutput,
} from './specialist.types';
import {
  asArray,
  asNumber,
  asText,
  assertNoProblems,
  assertTrackItemContent,
  behavioursForPrompt,
  briefForPrompt,
  clampInt,
  collectContentIds,
  courseCharactersForPrompt,
  courseOutlineForPrompt,
  foldText,
  IdMinter,
  isRecord,
  itemForPrompt,
  objectivesForPrompt,
  plural,
  SPECIALIST_MAX_TOKENS,
} from './specialist.util';

const DEFAULT_ITEMS = 10;
const MIN_ITEMS = 4;
const INTRO_MAX_CHARS = 300;
const DEFAULT_INTRO = 'Drag each one into the bucket you think it belongs in.';

interface BucketSortNormaliseOptions {
  title: string;
  itemCount: number;
  keepIds: ReadonlySet<string>;
  /**
   * Repair pass: drop an item that is still broken, and a bucket nothing
   * belongs in, as long as enough of each remains.
   */
  lenient?: boolean;
}

/**
 * Writes one BUCKET_SORT item: 2-6 labelled buckets (the brief's rubric
 * categories — harmful / unhelpful / helpful — work well) and the things to
 * sort into them, each with its right bucket and an explanation.
 *
 * A bucket sort is practice, not a gate: it surfaces a misconception while it
 * is still the learner's own guess (see bucket-sort.type.ts), so it never
 * carries a completion rule. That is why the explanation is written for the
 * WRONG guess the writer expects, and why the prompt asks for items learners
 * are likely to misplace — an item everyone sorts right teaches nothing.
 * Every item must have an explanation; the code checks it.
 */
@Injectable()
export class BucketSortSpecialist implements ItemSpecialist {
  constructor(private readonly llm: SpecialistLlmService) {}

  async generate(context: SpecialistContext): Promise<SpecialistOutput> {
    const { brief, blueprint, item, previous } = context;
    const spec = item.spec ?? {};
    const itemCount = clampInt(
      spec.itemCount,
      MIN_ITEMS,
      COURSE_COPILOT_LIMITS.bucketSortItems,
      DEFAULT_ITEMS,
    );
    const chosenBuckets = asArray(spec.buckets)
      .map((bucket) => asText(isRecord(bucket) ? bucket.name : bucket))
      .filter(Boolean)
      .slice(0, TRACK_MAX_BUCKET_SORT_BUCKETS);

    const { data } = await this.llm.runJson({
      specialist: 'bucket_sort',
      promptCode: COURSE_COPILOT_PROMPTS.BUCKET_SORT_WRITER,
      taskId: COURSE_COPILOT_AI_TASKS.BUCKET_SORT,
      task: LlmTask.COURSE_COPILOT_BUCKET_SORT,
      maxTokens: SPECIALIST_MAX_TOKENS.BUCKET_SORT,
      usageMetadata: context.usageMetadata,
      repairErrors: context.repairErrors,
      referenceMaterial: context.referenceMaterial,
      previous,
      variables: {
        brief_json: briefForPrompt(brief),
        course_outline: courseOutlineForPrompt(blueprint, item.id),
        item_json: itemForPrompt(item),
        objectives: objectivesForPrompt(brief, item),
        helpful_behaviours: behavioursForPrompt(brief?.behaviours?.helpful),
        unhelpful_behaviours: behavioursForPrompt(brief?.behaviours?.unhelpful),
        course_characters: courseCharactersForPrompt(blueprint),
        item_count: String(itemCount),
        max_buckets: String(TRACK_MAX_BUCKET_SORT_BUCKETS),
        bucket_instruction: chosenBuckets.length
          ? `The course plan chose these buckets — use them, named exactly so: ${chosenBuckets.join('; ')}.`
          : `Choose ${TRACK_MIN_BUCKET_SORT_BUCKETS}-${TRACK_MAX_BUCKET_SORT_BUCKETS} buckets yourself; categories from the brief's behaviours (for example harmful / unhelpful / helpful) work well.`,
      },
    });

    return normaliseBucketSortOutput(data, {
      title: item.title,
      itemCount,
      keepIds: previous ? collectContentIds(previous.content) : new Set(),
      lenient: Boolean(context.repairErrors?.length),
    });
  }
}

/** Pure: raw model JSON → validated BUCKET_SORT content. Exported for tests. */
export function normaliseBucketSortOutput(
  raw: Record<string, any>,
  opts: BucketSortNormaliseOptions,
): SpecialistOutput {
  const root = isRecord(raw.bucketSort)
    ? raw.bucketSort
    : isRecord(raw.sort)
      ? raw.sort
      : raw;
  const ids = new IdMinter(opts.keepIds);
  const problems: string[] = [];

  // Buckets: a repeated name is one bucket, so items keyed to either land in it.
  let buckets: BucketSortBucket[] = [];
  const bucketByKey = new Map<string, BucketSortBucket>();
  asArray(root.buckets)
    .map((entry) => (isRecord(entry) ? entry : { name: entry }))
    .forEach((rawBucket, index) => {
      const label = asText(
        rawBucket.name ?? rawBucket.label ?? rawBucket.title,
        TRACK_MAX_BUCKET_SORT_LABEL,
      );
      if (!label) return;
      const existing = bucketByKey.get(foldText(label));
      const bucket: BucketSortBucket = existing ?? {
        id: ids.mint(rawBucket.id),
        label,
      };
      if (!existing) {
        const description = asText(
          rawBucket.hint ?? rawBucket.description,
          TRACK_MAX_BUCKET_SORT_DESCRIPTION,
        );
        if (description) bucket.description = description;
        buckets.push(bucket);
        bucketByKey.set(foldText(label), bucket);
      }
      const rawId = asText(rawBucket.id);
      if (rawId) bucketByKey.set(`id:${rawId.toLowerCase()}`, bucket);
      bucketByKey.set(`index:${index}`, bucket);
    });

  if (buckets.length > TRACK_MAX_BUCKET_SORT_BUCKETS) {
    problems.push(
      `The sort has ${buckets.length} buckets; use ${TRACK_MIN_BUCKET_SORT_BUCKETS} to ${TRACK_MAX_BUCKET_SORT_BUCKETS}.`,
    );
  }

  const resolveBucket = (value: unknown): BucketSortBucket | undefined => {
    const key = asText(value);
    if (key) {
      const match =
        bucketByKey.get(`id:${key.toLowerCase()}`) ??
        bucketByKey.get(foldText(key));
      if (match) return match;
    }
    const index = asNumber(value);
    return index !== undefined && Number.isInteger(index)
      ? bucketByKey.get(`index:${index}`)
      : undefined;
  };

  let items: BucketSortItem[] = [];
  asArray(root.items)
    .filter(isRecord)
    .forEach((rawItem, index) => {
      if (items.length >= opts.itemCount) return;
      const label = `Item ${index + 1}`;
      const text = asText(
        rawItem.text ?? rawItem.statement,
        TRACK_MAX_BUCKET_SORT_ITEM_TEXT,
      );
      if (!text) return;
      const bucket = resolveBucket(
        rawItem.bucketId ??
          rawItem.bucket ??
          rawItem.correctBucket ??
          rawItem.belongsIn,
      );
      const explanation = asText(
        rawItem.explanation ?? rawItem.feedback,
        TRACK_MAX_BUCKET_SORT_EXPLANATION,
      );
      const problem = !bucket
        ? `${label} ("${text}") does not name one of the buckets as its right one.`
        : !explanation
          ? `${label} ("${text}") needs an explanation for a learner who sorts it wrongly.`
          : null;
      if (problem) {
        if (!opts.lenient) problems.push(problem);
        return;
      }
      items.push({
        id: ids.mint(rawItem.id),
        text,
        bucketId: bucket!.id,
        explanation,
      });
    });

  // An item can only be sorted once; the same text twice is one item.
  const seenText = new Set<string>();
  items = items.filter((item) => {
    const key = foldText(item.text);
    if (seenText.has(key)) return false;
    seenText.add(key);
    return true;
  });

  const used = new Set(items.map((item) => item.bucketId));
  const empty = buckets.filter((bucket) => !used.has(bucket.id));
  if (empty.length) {
    if (opts.lenient) buckets = buckets.filter((bucket) => used.has(bucket.id));
    else {
      problems.push(
        ...empty.map(
          (bucket) =>
            `No item belongs in the bucket "${bucket.label}". Give it at least one item or remove it.`,
        ),
      );
    }
  }
  if (buckets.length < TRACK_MIN_BUCKET_SORT_BUCKETS) {
    problems.push(
      `The sort needs at least ${TRACK_MIN_BUCKET_SORT_BUCKETS} buckets that items belong in.`,
    );
  }
  if (items.length < TRACK_MIN_BUCKET_SORT_ITEMS) {
    problems.push(
      `The sort needs at least ${TRACK_MIN_BUCKET_SORT_ITEMS} items to sort.`,
    );
  }
  assertNoProblems(problems);

  const content: BucketSortContent = {
    intro:
      asText(root.intro ?? root.instructions, INTRO_MAX_CHARS) || DEFAULT_INTRO,
    buckets,
    items,
  };
  assertTrackItemContent(TrackItemType.BUCKET_SORT, content, opts.title);
  return {
    content: content as unknown as Record<string, any>,
    summary: `${plural(items.length, 'item')} in ${plural(buckets.length, 'bucket')}`,
  };
}
