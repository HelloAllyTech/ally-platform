/**
 * The course layer of the Ally guide's config (plans/ally-guide/plan.md §7.5,
 * §10.5): what a trainer tells Ally about this course. Stored on
 * `tracks.guideNotes`, never sent in a learner payload, and copied by
 * duplicateTrack. Notes containing quiz-answer text are refused on save.
 */
export interface TrackGuideNotes {
  /** Free-text guidance for Ally (≤ 1500 characters). */
  notes?: string | null;
  /** Per-item overrides of the pacing tension (item id → level). */
  tension?: Record<string, 'low' | 'medium' | 'high'>;
  /** True when Course Copilot drafted the notes and nobody has edited them. */
  draftedByCopilot?: boolean;
}
