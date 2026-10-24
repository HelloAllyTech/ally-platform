import { SessionItemStatus } from 'src/common/type/common.type';
import { TrackItemType } from 'src/track/type/track.type';
import { TrackGuideNotes } from 'src/track/type/track-guide-notes.type';

/**
 * The course as the Conductor sees it (plans/ally-guide/plan.md §4.4, §7.7):
 * every item in course order with its state, a time estimate, a pacing
 * tension and whether it is a chapter's "boss". Built from the same learner
 * view classic renders, so locked/unlocked/completed can never disagree
 * between the two experiences — the Conductor reads progression, it never
 * decides it.
 */

export type GuideTension = 'low' | 'medium' | 'high';
export type SpineItemState = 'locked' | 'available' | 'completed';

/** The fields of the learner track detail the spine needs. */
export interface LearnerTrackItemView {
  id: string;
  type: TrackItemType | string;
  order: number;
  title: string | null;
  description?: string | null;
  status: SessionItemStatus | string;
  completedAt?: Date | string | null;
  completionCriteria?: { minReadSeconds?: number } | null;
  contentMeta?: Record<string, unknown> | null;
}

export interface LearnerTrackView {
  id: string;
  title: string | null;
  enrolled: boolean;
  sections: Array<{
    id: string;
    title: string | null;
    order: number;
    items: LearnerTrackItemView[];
  }>;
}

export interface SpineItem {
  id: string;
  sectionId: string;
  /** 0-based chapter index. */
  sectionIndex: number;
  /** 0-based position in the whole course. */
  position: number;
  type: TrackItemType;
  title: string;
  description: string | null;
  state: SpineItemState;
  /** Novice-adjusted estimate, whole minutes, at least 1. */
  estimatedMinutes: number;
  tension: GuideTension;
  /** A chapter's roleplay or case: the high-stakes practice moment. */
  boss: boolean;
  /** Short enough to be a learner's first win (plan §4.5). */
  quickWin: boolean;
  triggerWarnings: string[];
  completedAt: string | null;
}

export interface SpineSection {
  id: string;
  index: number;
  title: string;
  itemIds: string[];
}

export interface CourseSpine {
  trackId: string;
  title: string;
  enrolled: boolean;
  sections: SpineSection[];
  items: SpineItem[];
  completed: number;
  total: number;
  /** The one item progression allows next; null when finished or none open. */
  current: SpineItem | null;
  /** The item after `current`, for the teaser and the dock's look-ahead. */
  upcoming: SpineItem | null;
  finished: boolean;
}

const BOSS_TYPES = new Set<string>([
  TrackItemType.ROLEPLAY,
  TrackItemType.CASE,
]);

/** Default pacing tension by type (plan §4.4); trigger warnings raise it. */
const TYPE_TENSION: Record<string, GuideTension> = {
  [TrackItemType.ROLEPLAY]: 'high',
  [TrackItemType.CASE]: 'high',
  [TrackItemType.QUIZ]: 'medium',
  [TrackItemType.BRANCHING_SCENARIO]: 'medium',
  [TrackItemType.ANNOTATED_ARTIFACT]: 'medium',
  [TrackItemType.BUCKET_SORT]: 'medium',
  [TrackItemType.ARTICLE]: 'low',
  [TrackItemType.VIDEO]: 'low',
  [TrackItemType.JOURNAL]: 'low',
  [TrackItemType.GAME]: 'low',
};

/**
 * Minutes a newcomer typically needs, by type, when the item itself says
 * nothing better. Deliberately generous: an author's own timing undercounts
 * a novice by half or more (Stacks: Estimating Activity Duration for Novice
 * Learners), and a dock that promises 3 minutes for a 7-minute task spends
 * trust it cannot earn back. Replace with observed medians once there is
 * completion data per item.
 */
const TYPE_MINUTES: Record<string, number> = {
  [TrackItemType.ROLEPLAY]: 12,
  [TrackItemType.CASE]: 25,
  [TrackItemType.QUIZ]: 4,
  [TrackItemType.BRANCHING_SCENARIO]: 7,
  [TrackItemType.ANNOTATED_ARTIFACT]: 8,
  [TrackItemType.BUCKET_SORT]: 4,
  [TrackItemType.ARTICLE]: 6,
  [TrackItemType.VIDEO]: 6,
  [TrackItemType.JOURNAL]: 6,
  [TrackItemType.GAME]: 5,
};

/** The novice allowance applied to a duration the content states. */
const NOVICE_FACTOR = 1.5;

const num = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : null;

export function estimateMinutes(item: LearnerTrackItemView): number {
  const meta = item.contentMeta ?? {};
  let minutes: number;
  switch (item.type) {
    case TrackItemType.VIDEO: {
      const seconds = num(meta.durationSeconds);
      // A video's own length is known; pauses and interjections are not.
      minutes = seconds
        ? seconds / 60 + (num(meta.interjectionCount) ?? 0) * 0.5
        : TYPE_MINUTES[item.type];
      break;
    }
    case TrackItemType.ARTICLE: {
      const read = num(item.completionCriteria?.minReadSeconds);
      minutes =
        (read ? (read / 60) * NOVICE_FACTOR : TYPE_MINUTES[item.type]) +
        (num(meta.questionCount) ?? 0) * 0.5;
      break;
    }
    case TrackItemType.QUIZ: {
      const questions = num(meta.questionCount);
      minutes = questions ? questions * 0.75 * NOVICE_FACTOR : 4;
      break;
    }
    case TrackItemType.JOURNAL: {
      const prompts = num(meta.promptCount);
      minutes = prompts ? prompts * 2 * NOVICE_FACTOR : TYPE_MINUTES[item.type];
      break;
    }
    case TrackItemType.BUCKET_SORT: {
      const cards = num(meta.itemCount);
      minutes = cards ? cards * 0.25 * NOVICE_FACTOR : TYPE_MINUTES[item.type];
      break;
    }
    default:
      minutes = TYPE_MINUTES[item.type] ?? 5;
  }
  return Math.max(1, Math.ceil(minutes));
}

/**
 * Whether an item can be the learner's first win (plan §4.5): an article, a
 * game, a video of at most `maxMinutes`, or a quiz of at most five questions.
 * Judged on what the content states, not on the padded estimate above — an
 * article with no stated read time is short in practice even though the
 * dock budgets six minutes for it.
 */
export function isQuickWin(
  item: LearnerTrackItemView,
  maxMinutes = 5,
): boolean {
  const meta = item.contentMeta ?? {};
  switch (item.type) {
    case TrackItemType.ARTICLE: {
      const read = num(item.completionCriteria?.minReadSeconds);
      return !read || read <= maxMinutes * 60;
    }
    case TrackItemType.GAME:
      return true;
    case TrackItemType.VIDEO: {
      const seconds = num(meta.durationSeconds);
      return seconds !== null && seconds <= maxMinutes * 60;
    }
    case TrackItemType.QUIZ: {
      const questions = num(meta.questionCount);
      return questions !== null && questions <= 5;
    }
    default:
      return false;
  }
}

export function itemTension(
  type: string,
  triggerWarnings: string[],
  override?: GuideTension,
): GuideTension {
  if (override) return override;
  if (triggerWarnings.length > 0) return 'high';
  return TYPE_TENSION[type] ?? 'low';
}

function stateOf(status: string): SpineItemState {
  if (status === SessionItemStatus.COMPLETED) return 'completed';
  if (status === SessionItemStatus.UNLOCKED) return 'available';
  return 'locked';
}

const iso = (value: Date | string | null | undefined): string | null =>
  value == null
    ? null
    : value instanceof Date
      ? value.toISOString()
      : String(value);

export function buildCourseSpine(
  view: LearnerTrackView,
  options: {
    guideNotes?: TrackGuideNotes | null;
    triggerWarningsByItem?: ReadonlyMap<string, string[]>;
  } = {},
): CourseSpine {
  const overrides = options.guideNotes?.tension ?? {};
  const sections = [...view.sections].sort((a, b) => a.order - b.order);
  const items: SpineItem[] = [];
  const spineSections: SpineSection[] = [];

  sections.forEach((section, sectionIndex) => {
    const sorted = [...section.items].sort((a, b) => a.order - b.order);
    spineSections.push({
      id: section.id,
      index: sectionIndex,
      title: section.title ?? '',
      itemIds: sorted.map((item) => item.id),
    });
    for (const item of sorted) {
      const warnings = options.triggerWarningsByItem?.get(item.id) ?? [];
      items.push({
        id: item.id,
        sectionId: section.id,
        sectionIndex,
        position: items.length,
        type: item.type as TrackItemType,
        title: item.title ?? '',
        description: item.description ?? null,
        // Not enrolled yet: nothing is open until enrolment unlocks the first.
        state: view.enrolled ? stateOf(String(item.status)) : 'locked',
        estimatedMinutes: estimateMinutes(item),
        tension: itemTension(item.type, warnings, overrides[item.id]),
        boss: BOSS_TYPES.has(item.type),
        quickWin: isQuickWin(item),
        triggerWarnings: warnings,
        completedAt: iso(item.completedAt),
      });
    }
  });

  const completed = items.filter((item) => item.state === 'completed').length;
  const current = items.find((item) => item.state === 'available') ?? null;
  const upcoming = current
    ? (items.find(
        (item) =>
          item.position > current.position && item.state !== 'completed',
      ) ?? null)
    : null;

  return {
    trackId: view.id,
    title: view.title ?? '',
    enrolled: view.enrolled,
    sections: spineSections,
    items,
    completed,
    total: items.length,
    current,
    upcoming,
    finished: items.length > 0 && completed === items.length,
  };
}
