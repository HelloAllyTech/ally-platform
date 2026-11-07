/**
 * Prompts whose live version changes only with an explicit confirmation.
 * Every edit is still a version; these just can't go live in passing, because
 * what they do depends on something outside the text:
 *
 * - `judge_rubric`: a judge's results are labelled by a version pinned in code
 *   (ally-ai's `*_JUDGE.PROMPT_VERSION`, and the backlog drainer's targets),
 *   not by the rubric's store version. Putting a different rubric live under
 *   the same label would mix two rubrics in one series, and re-labelling
 *   automatically would make the drainer re-judge every session.
 * - `measuring_instrument`: prompts that score other work — Builder's eval
 *   admin and judge (every eval run) and ally-ai-learn's actor judge (the
 *   actor-quality composite). Retuning one makes scores before and after
 *   incomparable.
 * - `guard`: the check on another agent's output (the PRD reviewer checks the
 *   interviewer) or text whose answer shape the server enforces (the discovery
 *   planner). A check that can be loosened in passing is not one.
 *
 * Plain strings, no imports: the prompts module reads this file. A spec keeps
 * the Builder codes in step with their contracts (the ally-ai and
 * ally-ai-learn codes are declared in those services).
 */
export type PinnedPromptReason =
  | 'judge_rubric'
  | 'measuring_instrument'
  | 'guard';

export const PINNED_PROMPTS: ReadonlyMap<string, PinnedPromptReason> = new Map([
  ['drift_judge_conversation_rubric', 'judge_rubric'],
  ['filler_quality_judge_rubric', 'judge_rubric'],
  ['language_quality_judge_rubric', 'judge_rubric'],
  ['recall_quality_rubric', 'judge_rubric'],
  ['feedback_groundedness_rubric', 'judge_rubric'],
  ['debrief_quality_rubric', 'judge_rubric'],
  ['rag_quality_rubric', 'judge_rubric'],
  ['ally_ai_learn_evaluation_actor_goal_system', 'measuring_instrument'],
  ['builder_eval_admin_system', 'measuring_instrument'],
  ['builder_eval_judge_system', 'measuring_instrument'],
  ['builder_prd_review_system', 'guard'],
  ['builder_prd_recheck_system', 'guard'],
  ['builder_discovery_plan_system', 'guard'],
  // Decides whether a learner sees "an important moment"; its recall is gated
  // at 100% on the seeded safety set (ally-ai scripts/debrief_safety_recall.py).
  ['debrief_safety_reader_system', 'guard'],
]);

/** What the editor must have done before confirming, by reason. */
export const PINNED_PROMPT_REFUSAL: Record<PinnedPromptReason, string> = {
  judge_rubric:
    'is a judge rubric. Its results are labelled by a version pinned in code, ' +
    'so bump the judge’s PROMPT_VERSION (and the backlog drainer’s target) in the same change, then confirm.',
  measuring_instrument:
    'scores other work (Builder’s eval runs, or the actor-quality composite). Scores before and ' +
    'after a change are not comparable, so start a new baseline after publishing, then confirm.',
  guard:
    'is a check on another agent’s output, or its answer shape is enforced by the server. ' +
    'Have the change reviewed before publishing, then confirm.',
};
