import { GuideLoopPolicy } from 'src/guide/release/guide-release.bundle';

/**
 * Progressive delegation (plans/ally-guide/plan.md §7.13, Appendix A
 * "Autonomy preconditions"; Stacks: Progressive Delegation: Staged Autonomy
 * Growth — start cautious and human-reviewed, widen autonomy as reliability
 * is proven). Pure.
 *
 *  - Stage 1, propose only: always available.
 *  - Stage 2, automatic gate, shadow and canary with a person promoting:
 *    the eval suite is big and broad enough (≥ 150 cases, ≥ 60 safety,
 *    ≥ 40 mined, ≥ 8 in every hard category), 4 weeks of evaluator data,
 *    and κ ≥ 0.6 on safety and on grounding.
 *  - Stage 3, automatic promotion: all of stage 2, plus 3 clean canaries a
 *    person approved — evidence the automatic decision agrees with people
 *    before people stop making it.
 */

export type DelegationStage = 1 | 2 | 3;

export const STAGE_LABELS: Record<DelegationStage, string> = {
  1: 'The curator proposes; people run every step',
  2: 'Gate, shadow and canary run on their own; a person promotes',
  3: 'Promotion is automatic too',
};

export interface DelegationCounts {
  activeCases: number;
  safetyCases: number;
  minedCases: number;
  casesByHardCategory: Record<string, number>;
  /** Days since the first night the evaluator judged a window, or null. */
  evaluatorDays: number | null;
  /** κ (critic vs people) per criterion; null when untrusted for lack of pairs. */
  kappa: Record<string, { kappa: number | null; trusted: boolean }>;
  cleanCanaries: number;
}

export interface Precondition {
  id: string;
  label: string;
  /** The lowest stage that needs it. */
  stage: DelegationStage;
  need: number;
  have: number | null;
  met: boolean;
}

/** The κ criteria Appendix A names. */
export const KAPPA_CRITERIA = ['safety', 'grounding'] as const;

export function delegationPreconditions(
  counts: DelegationCounts,
  policy: Pick<
    GuideLoopPolicy,
    | 'delegationMinCases'
    | 'delegationMinSafetyCases'
    | 'delegationMinMinedCases'
    | 'delegationMinPerHardCategory'
    | 'delegationEvaluatorDays'
    | 'delegationCleanCanaries'
  >,
  kappaThreshold: number,
  hardCategories: readonly string[],
): Precondition[] {
  const at = (
    id: string,
    label: string,
    stage: DelegationStage,
    need: number,
    have: number | null,
  ): Precondition => ({
    id,
    label,
    stage,
    need,
    have,
    met: have !== null && have >= need,
  });
  const out: Precondition[] = [
    at(
      'cases',
      'Active eval cases',
      2,
      policy.delegationMinCases,
      counts.activeCases,
    ),
    at(
      'safety_cases',
      'Safety cases',
      2,
      policy.delegationMinSafetyCases,
      counts.safetyCases,
    ),
    at(
      'mined_cases',
      'Cases mined from real conversations',
      2,
      policy.delegationMinMinedCases,
      counts.minedCases,
    ),
  ];
  for (const category of hardCategories) {
    out.push(
      at(
        `category:${category}`,
        `Cases in "${category}"`,
        2,
        policy.delegationMinPerHardCategory,
        counts.casesByHardCategory[category] ?? 0,
      ),
    );
  }
  out.push(
    at(
      'evaluator_days',
      'Days of nightly evaluator data',
      2,
      policy.delegationEvaluatorDays,
      counts.evaluatorDays === null ? null : Math.floor(counts.evaluatorDays),
    ),
  );
  for (const criterion of KAPPA_CRITERIA) {
    const k = counts.kappa[criterion];
    out.push({
      id: `kappa:${criterion}`,
      label: `Agreement with people (κ) on ${criterion}`,
      stage: 2,
      need: kappaThreshold,
      have: k?.kappa ?? null,
      met: Boolean(k?.trusted && k.kappa !== null && k.kappa >= kappaThreshold),
    });
  }
  out.push(
    at(
      'clean_canaries',
      'Clean canaries a person approved',
      3,
      policy.delegationCleanCanaries,
      counts.cleanCanaries,
    ),
  );
  return out;
}

/** The highest stage whose preconditions all hold. */
export function highestUnlockedStage(
  preconditions: Precondition[],
): DelegationStage {
  const holds = (stage: DelegationStage) =>
    preconditions.filter((p) => p.stage <= stage).every((p) => p.met);
  if (holds(3)) return 3;
  if (holds(2)) return 2;
  return 1;
}

/**
 * Whether a person may move the stage from `current` to `requested`:
 * down at any time; up one step at a time, and only to an unlocked stage.
 */
export function stageChangeRefusal(
  current: DelegationStage,
  requested: number,
  unlocked: DelegationStage,
): string | null {
  if (![1, 2, 3].includes(requested)) return 'The stage is 1, 2 or 3.';
  if (requested <= current) return null;
  if (requested > current + 1) {
    return `Raise the stage one step at a time (now ${current}).`;
  }
  if (requested > unlocked) {
    return `Stage ${requested} is locked: its preconditions do not all hold yet.`;
  }
  return null;
}
