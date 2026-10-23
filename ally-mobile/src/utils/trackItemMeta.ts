import {TrackDetailItem, TrackItemType} from '@/types';

// Plain `string` (not the app's strict `TranslationType`) because this needs
// to accept `courses.meta.questions`-style base keys that i18next resolves
// to `_one`/`_other` at runtime by pluralization count — those suffixed
// forms are what's actually declared in the locale JSON, so callers should
// pass `tVariable` (the untyped translate function) here, not `t`.
type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * Builds the small meta line under a course item title on the overview
 * screen, e.g. "7 questions · pass 70%" or "4 min video". Mirrors ally-web's
 * `getTrackItemMeta`.
 */
export const getTrackItemMeta = (
  item: TrackDetailItem,
  t: Translate,
): string => {
  const meta = item.contentMeta;
  const criteria = item.completionCriteria;

  switch (item.type) {
    case TrackItemType.QUIZ: {
      const parts: string[] = [];
      if (meta?.questionCount) {
        parts.push(t('courses.meta.questions', {count: meta.questionCount}));
      }
      // Unlike ROLEPLAY's minScore, a QUIZ passScore of 0 is a real,
      // configured threshold (the quiz's own intro screen shows it
      // unconditionally too), so it must not be dropped as falsy.
      const passScore = meta?.passScore ?? criteria?.passScore;
      if (passScore !== undefined)
        parts.push(t('courses.meta.passScore', {score: passScore}));
      return parts.length ? parts.join(' · ') : t('courses.meta.quiz');
    }
    case TrackItemType.VIDEO: {
      if (meta?.durationSeconds) {
        const minutes = Math.max(1, Math.round(meta.durationSeconds / 60));
        return t('courses.meta.videoDuration', {count: minutes, minutes});
      }
      return t('courses.meta.video');
    }
    case TrackItemType.JOURNAL: {
      if (meta?.promptCount) {
        return t('courses.meta.prompts', {count: meta.promptCount});
      }
      return t('courses.meta.journal');
    }
    case TrackItemType.ARTICLE:
      return t('courses.meta.article');
    case TrackItemType.ROLEPLAY: {
      // A minScore of 0 is the unconfigured default and gates nothing (see
      // meetsMinimumScore in ally-be), so only a real threshold is shown —
      // advertising "min score 0" would read as a hurdle that isn't there.
      if ((criteria?.minScore ?? 0) > 0) {
        return `${t('courses.meta.roleplay')} · ${t('courses.meta.minScore', {
          score: criteria?.minScore,
        })}`;
      }
      return t('courses.meta.roleplay');
    }
    case TrackItemType.CASE:
      return t('courses.meta.case');
    case TrackItemType.GAME:
      // No score or threshold in the meta line — there isn't one, and hinting
      // at one would make an optional break look like another hurdle.
      return t('courses.meta.game');
    case TrackItemType.BRANCHING_SCENARIO:
      return t('courses.meta.branchingScenario');
    case TrackItemType.BUCKET_SORT:
      return t('courses.meta.bucketSort');
    default:
      return '';
  }
};
