import { TrackGuideNotes } from '../type/track-guide-notes.type';

/**
 * Re-point a course's Ally notes at a duplicate's item ids. `tension` is keyed
 * by item id, so a copy that kept the original ids would point at items in a
 * different course; ids with no counterpart in the copy are dropped. Notes and
 * the Copilot flag carry over unchanged.
 */
export function remapGuideNotesItems(
  notes: TrackGuideNotes,
  itemIdMap: ReadonlyMap<string, string>,
): TrackGuideNotes {
  const remapped: TrackGuideNotes = { ...notes };
  if (notes.tension) {
    remapped.tension = Object.fromEntries(
      Object.entries(notes.tension)
        .filter(([itemId]) => itemIdMap.has(itemId))
        .map(([itemId, level]) => [itemIdMap.get(itemId) as string, level]),
    );
  }
  return remapped;
}
