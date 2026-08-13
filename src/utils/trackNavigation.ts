import {TrackDetail, TrackItemStatus} from '@/types';

/**
 * First actionable item across the whole track, for deep-linking into the
 * player: an in-progress (unlocked + started) item takes priority over the
 * first plain unlocked item. Mirrors ally-web's `findNextItemId`.
 */
export const findNextItemId = (
  track: TrackDetail | undefined,
): string | null => {
  if (!track) return null;
  const sections = [...track.sections].sort((a, b) => a.order - b.order);

  for (const section of sections) {
    const items = [...section.items].sort((a, b) => a.order - b.order);
    const inProgress = items.find(
      item => item.status === TrackItemStatus.UNLOCKED && item.startedAt,
    );
    if (inProgress) return inProgress.id;
  }
  for (const section of sections) {
    const items = [...section.items].sort((a, b) => a.order - b.order);
    const unlocked = items.find(
      item => item.status === TrackItemStatus.UNLOCKED,
    );
    if (unlocked) return unlocked.id;
  }
  return null;
};
