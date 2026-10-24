import { Injectable } from '@nestjs/common';
import { TrackItem } from 'src/track/entity/track-item.entity';
import { TrackLocalizationService } from 'src/track/service/track-localization.service';
import { TrackSharedService } from 'src/track/service/track-shared.service';
import { QuizContent } from 'src/track/type/quiz.type';
import { TrackItemType } from 'src/track/type/track.type';
import { CourseSpine } from '../conductor/course-spine';
import { itemTypeLabel, plainText } from '../context/guide-context';

/** One course passage the Tutor may read and cite. */
export interface TutorSource {
  itemId: string;
  title: string;
  type: string;
  text: string;
}

/** Characters of source text a single consultation may carry. */
export const TUTOR_SOURCE_BUDGET = 30_000;
const PER_ITEM_CHARS = 8_000;

const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

/**
 * The learner-safe text of one item: what the learner can already read, and
 * nothing that would answer an assessment (plans/ally-guide/plan.md §6.4,
 * the firewall). An allowlist per type — a new content field is invisible
 * to the Tutor until someone decides it is safe:
 *
 *  - ARTICLE: the article body (never its inline questions)
 *  - JOURNAL: the prompts
 *  - GAME / BUCKET_SORT / ANNOTATED_ARTIFACT: the intro; for a sort, the
 *    bucket names (never which item goes where)
 *  - VIDEO / ROLEPLAY / CASE / BRANCHING_SCENARIO / QUIZ: title and
 *    description only — interjections, branches and quiz questions all
 *    carry correct answers
 */
export function learnerSafeText(item: TrackItem): string {
  const content = (item.content ?? {}) as Record<string, any>;
  const parts: string[] = [];
  if (item.description) parts.push(plainText(item.description));
  switch (item.type) {
    case TrackItemType.ARTICLE:
      if (typeof content.html === 'string') parts.push(plainText(content.html));
      break;
    case TrackItemType.JOURNAL:
      for (const prompt of content.prompts ?? []) {
        if (typeof prompt?.prompt === 'string')
          parts.push(`Prompt: ${prompt.prompt}`);
      }
      break;
    case TrackItemType.GAME:
    case TrackItemType.ANNOTATED_ARTIFACT:
      if (typeof content.intro === 'string') parts.push(content.intro);
      break;
    case TrackItemType.BUCKET_SORT:
      if (typeof content.intro === 'string') parts.push(content.intro);
      if (Array.isArray(content.buckets)) {
        parts.push(
          `Categories: ${content.buckets
            .map((bucket: any) => bucket?.label ?? bucket?.name)
            .filter(Boolean)
            .join('; ')}`,
        );
      }
      break;
    default:
      break;
  }
  return parts.filter((part) => part.trim()).join('\n\n');
}

/**
 * Course text for the Tutor (plan §7.7, "direct read" in M1): the items the
 * learner can already open — completed ones and the current one — in the
 * learner's language. Locked items contribute only their title and
 * description, enough to say "that comes later" without spoiling it.
 */
@Injectable()
export class GuideCourseContentService {
  constructor(
    private readonly shared: TrackSharedService,
    private readonly localization: TrackLocalizationService,
  ) {}

  async tutorSources(
    trackId: string,
    spine: CourseSpine,
    languageCode: string,
  ): Promise<TutorSource[]> {
    const [structure, translation] = await Promise.all([
      this.shared.getTrackWithStructure(trackId),
      this.localization.resolvePublished(trackId, languageCode),
    ]);
    const stateById = new Map(spine.items.map((item) => [item.id, item.state]));
    const items = structure.sections.flatMap((section) => section.items);
    // Nearest the learner first: the current item, then backwards.
    const currentIndex = spine.current
      ? items.findIndex((item) => item.id === spine.current!.id)
      : items.length - 1;
    const ordered = [
      ...items.slice(0, currentIndex + 1).reverse(),
      ...items.slice(currentIndex + 1),
    ];

    const sources: TutorSource[] = [];
    let used = 0;
    for (const raw of ordered) {
      const item = this.localization.localizeItem(raw, translation);
      const open = stateById.get(item.id) !== 'locked';
      const text = open
        ? learnerSafeText(item)
        : plainText(item.description ?? '');
      const clipped = clip(text, open ? PER_ITEM_CHARS : 400);
      if (!clipped.trim()) continue;
      if (used + clipped.length > TUTOR_SOURCE_BUDGET) break;
      used += clipped.length;
      sources.push({
        itemId: item.id,
        title: item.title ?? '',
        type: itemTypeLabel(item.type) + (open ? '' : ' (not reached yet)'),
        text: clipped,
      });
    }
    return sources;
  }

  /**
   * Passages for practice (plan §4.6): only items the learner can already
   * open, learner-safe text, the focus items first, within `budget`
   * characters. A locked item is never practised.
   */
  async practiceSources(
    trackId: string,
    spine: CourseSpine,
    languageCode: string,
    focusItemIds: string[] = [],
    budget = 12_000,
  ): Promise<TutorSource[]> {
    const all = await this.tutorSources(trackId, spine, languageCode);
    const open = all.filter((source) => !source.type.includes('not reached'));
    const focus = new Set(focusItemIds);
    const ordered = [
      ...open.filter((source) => focus.has(source.itemId)),
      ...open.filter((source) => !focus.has(source.itemId)),
    ];
    const picked: TutorSource[] = [];
    let used = 0;
    for (const source of ordered) {
      if (used + source.text.length > budget) continue;
      used += source.text.length;
      picked.push(source);
    }
    return picked;
  }

  /**
   * Every quiz question's prompt in the course — for the Assessor to steer
   * clear of, never to show (plan §6.4). Prompts only: no options or keys.
   */
  async quizPrompts(trackId: string): Promise<string[]> {
    const structure = await this.shared.getTrackWithStructure(trackId);
    const prompts: string[] = [];
    for (const section of structure.sections) {
      for (const item of section.items) {
        if (item.type !== TrackItemType.QUIZ) continue;
        const questions = ((item.content as any)?.questions ?? []) as Array<{
          prompt?: string;
        }>;
        for (const question of questions) {
          const prompt = plainText(String(question?.prompt ?? '')).trim();
          if (prompt) prompts.push(prompt.slice(0, 300));
        }
      }
    }
    return prompts;
  }

  /**
   * One quiz's full content, key included, in the learner's language — for
   * the Assessor's firewall alone (plan §6.4), which decides what of it the
   * learner has earned. Never passed to the orchestrator or a prompt as is.
   */
  async quizWithKey(
    trackId: string,
    itemId: string,
    languageCode: string,
  ): Promise<{ title: string; quiz: QuizContent } | null> {
    const [structure, translation] = await Promise.all([
      this.shared.getTrackWithStructure(trackId),
      this.localization.resolvePublished(trackId, languageCode),
    ]);
    const raw = structure.sections
      .flatMap((section) => section.items)
      .find((item) => item.id === itemId);
    if (!raw || raw.type !== TrackItemType.QUIZ) return null;
    const item = this.localization.localizeItem(raw, translation);
    const quiz = item.content as QuizContent | undefined;
    if (!quiz || !Array.isArray(quiz.questions)) return null;
    return { title: item.title ?? '', quiz };
  }

  /** One reached item's learner-safe text, for the Coach's focus. */
  async focusText(
    trackId: string,
    spine: CourseSpine,
    languageCode: string,
    itemId: string,
  ): Promise<string> {
    const sources = await this.tutorSources(trackId, spine, languageCode);
    return sources.find((source) => source.itemId === itemId)?.text ?? '';
  }
}
