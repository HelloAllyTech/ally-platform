import type {
  PlanImpactTagId,
  PlanSuccessMeasure,
} from '../type/plan-record.type';

/** The check kinds the review board runs (rev 5.2 §B.8.4). */
export type PlanCheckKind = 'safety' | 'privacy' | 'ai_quality';

/**
 * Which checks a plan must pass, from its impact tags. Pure and deliberately
 * boring: code decides what is required, never the model (rev 5.2 §B.8.4).
 */
export function requiredChecks(tags: PlanImpactTagId[]): PlanCheckKind[] {
  const set = new Set(tags);
  const required: PlanCheckKind[] = [];
  if (
    set.has('learner_or_client_facing_ai') ||
    set.has('crisis_or_helpline_path') ||
    set.has('recordings_or_transcripts') ||
    set.has('minors_possible')
  ) {
    required.push('safety');
  }
  if (
    set.has('stores_or_moves_personal_data') ||
    set.has('sends_user_content_to_llm') ||
    set.has('recordings_or_transcripts') ||
    set.has('cross_tenant') ||
    set.has('export')
  ) {
    required.push('privacy');
  }
  if (
    set.has('prompt_or_model_change') ||
    set.has('learner_or_client_facing_ai')
  ) {
    required.push('ai_quality');
  }
  return required;
}

/**
 * What is still missing from a success measure, as next actions. Empty when
 * the measure is complete enough to judge a result against later.
 */
export function successMeasureGaps(
  measure: PlanSuccessMeasure | null | undefined,
): string[] {
  if (!measure) {
    return [
      'Set a success measure: the metric, its target, and how it will be measured.',
    ];
  }
  const gaps: string[] = [];
  if (!measure.metric?.trim()) gaps.push('Name the metric that should move.');
  if (!measure.target?.trim()) gaps.push('Set a target for the metric.');
  if (measure.baseline === undefined) {
    gaps.push(
      'Record a baseline, or say there is none yet (then tracking becomes part of the first slice).',
    );
  }
  if (!measure.guardrails?.length) {
    gaps.push('Add at least one guardrail metric that must not get worse.');
  }
  if (!measure.method?.spec?.trim()) {
    gaps.push('Say how the outcome will be measured.');
  }
  if (!measure.reviewAfterDays?.length) {
    gaps.push('Set at least one review date after release.');
  }
  return gaps;
}
