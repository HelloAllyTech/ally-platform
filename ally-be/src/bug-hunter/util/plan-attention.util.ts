import { BugFinding } from '../entity/bug-finding.entity';
import { BugFindingStatus } from '../enum/bug-finding.enum';
import { latestVerdictFor } from '../type/bug-fix-verdict.type';

/**
 * What a person has to do on a multi-repo plan, read off its steps.
 *
 * A plan parks at `coordinating` while a step waits on a person, and for
 * four days (2026-10-26 → 30) two plans did exactly that with nobody told:
 * one step's PR had passed the Verifier in a repo Bug Hunter may not merge
 * in, the other's had been refused and the orchestrator had handed it to a
 * human. Both notices went to the STEP, which is not a row anybody sees;
 * the parent's row said "Fixing across repos" and offered nothing.
 *
 * Derived, never stored, the way the case chain is: the step's status and
 * its latest fix verdict already say it.
 */
export type PlanAttentionKind = 'merge' | 'review';

export interface PlanAttention {
  /** `merge`: the step's PR passed and needs a person's merge. `review`: the Verifier refused it and a person reads it. */
  kind: PlanAttentionKind;
  stepId: string;
  stepIndex: number;
  repo: string | null;
  prUrl: string | null;
}

/** The Verifier's latest word on a step's current PR, if any. */
export function stepFixVerdict(step: BugFinding): 'pass' | 'fail' | null {
  const verdict = latestVerdictFor(
    step.metadata?.fixVerdicts,
    step.prUrl ?? null,
  );
  if (!verdict) return null;
  return verdict.verdict === 'pass' ? 'pass' : 'fail';
}

export function planAttention(
  parent: Pick<BugFinding, 'status'>,
  steps: BugFinding[],
): PlanAttention | null {
  if (parent.status !== BugFindingStatus.COORDINATING) return null;
  // One step is open at a time, so the first PR_OPENED step is the plan's.
  const step = steps.find(
    (s) => s.status === BugFindingStatus.PR_OPENED && s.prUrl,
  );
  if (!step) return null;
  // No verdict yet means the Verifier is still reading it: Bug Hunter's turn.
  const verdict = stepFixVerdict(step);
  if (!verdict) return null;
  return {
    kind: verdict === 'pass' ? 'merge' : 'review',
    stepId: step.id,
    stepIndex: step.stepIndex ?? 0,
    repo: step.repo ?? null,
    prUrl: step.prUrl ?? null,
  };
}
