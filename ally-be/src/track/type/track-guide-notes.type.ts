/**
 * The course layer of the Ally guide's config (plans/ally-guide/plan.md §7.5,
 * §10.5): what a trainer tells Ally about this course. Stored on
 * `tracks.guideNotes`, never sent in a learner payload, and copied by
 * duplicateTrack. Notes containing quiz-answer text are refused on save
 * (TrackGuideNotesService).
 */
export type GuideNotesTension = 'low' | 'medium' | 'high';

/** Longest trainer note Ally reads. */
export const GUIDE_NOTES_MAX_CHARS = 1500;

export interface TrackGuideNotes {
  /** Free-text guidance for Ally (≤ GUIDE_NOTES_MAX_CHARS characters). */
  notes?: string | null;
  /** Per-item overrides of the pacing tension (item id → level). */
  tension?: Record<string, GuideNotesTension>;
  /** True when Course Copilot drafted the notes and nobody has edited them. */
  draftedByCopilot?: boolean;
}
