import {TrackDetail, TrackItemCompletionResult, TrackItemStatus} from '@/types';

/**
 * Applies a completion result to a cached TrackDetail draft in place: marks
 * the item COMPLETED, unlocks the ids the server reported, and bumps the
 * enrollment counters. Mirrors ally-web's `applyCompletionToDetailDraft` so
 * the player stays responsive between refetches (used inside RTK Query
 * `onQueryStarted` optimistic updates).
 */
export const applyCompletionToDetailDraft = (
  draft: TrackDetail,
  itemId: string,
  result: TrackItemCompletionResult,
): void => {
  if (!result.completed) return;
  for (const section of draft.sections) {
    for (const item of section.items) {
      if (item.id === itemId && item.status !== TrackItemStatus.COMPLETED) {
        item.status = TrackItemStatus.COMPLETED;
        item.completedAt = item.completedAt ?? new Date().toISOString();
        draft.completedItems = Math.min(
          draft.totalItems,
          draft.completedItems + 1,
        );
      } else if (
        result.unlockedItemIds?.includes(item.id) &&
        item.status === TrackItemStatus.LOCKED
      ) {
        item.status = TrackItemStatus.UNLOCKED;
      }
    }
  }
  if (result.trackCompleted) {
    draft.completedAt = draft.completedAt ?? new Date().toISOString();
  }
};
