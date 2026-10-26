/**
 * Prompts that are judge rubrics. A judge's results are labelled by a version
 * pinned in code (ally-ai's `*_JUDGE.PROMPT_VERSION`, and the backlog
 * drainer's targets), not by the rubric's store version. Putting a different
 * rubric live under the same label would mix two rubrics in one series, and
 * re-labelling automatically would make the drainer re-judge every session.
 *
 * So the Skills Store refuses to put a new rubric live unless the promotion
 * explicitly confirms the judge's label was bumped in the same change.
 */
export const JUDGE_RUBRIC_PROMPT_CODES: ReadonlySet<string> = new Set([
  'drift_judge_conversation_rubric',
  'filler_quality_judge_rubric',
  'language_quality_judge_rubric',
  'recall_quality_rubric',
  'feedback_groundedness_rubric',
  'rag_quality_rubric',
]);
