/**
 * One definition of "ready to close the plan" (audit 2026-11-19, rec 2).
 *
 * Four readers use it and must agree: the Close plan dialog, the server's
 * close check, the planning agent's view of what is left, and the check that
 * sends back an agent reply claiming the plan is complete. Verification is a
 * separate, explicit condition, never the agent's say-so [FP-3116].
 *
 * Pure: PlanCloseReadinessService gathers the inputs. PRD readiness arrives
 * already assessed by PlanReadinessService (Builder's rubric, the success
 * measure and the specialist checks), so a row added to Builder's rubric
 * reaches this gate without a change here.
 */

export type PlanCloseBlockerKind = 'prd' | 'design' | 'answers';

export interface PlanCloseBlocker {
  kind: PlanCloseBlockerKind;
  /** The next action, in one sentence: read by people and by the agent. */
  text: string;
}

export interface PlanCloseReadiness {
  ready: boolean;
  /** No requirement in the PRD at all: the dialog says so first. */
  prdEmpty: boolean;
  blockers: PlanCloseBlocker[];
}

/** The technical design as the gate reads it (BuilderTechnicalDesign, loosely). */
export interface PlanCloseDesignFacts {
  status: string | null;
  /** computeDesignReadiness's answer for the current PRD. */
  ready: boolean;
  stale: boolean;
  blockers: string[];
}

export interface PlanCloseInputs {
  /** PlanReadinessService.assess(...).blockers: the PRD, success measure and checks. */
  planBlockers: string[];
  /** Requirements in the PRD. */
  requirementCount: number;
  /** Null when no design has been drafted. */
  design: PlanCloseDesignFacts | null;
  /** Agent questions whose answers conflict and wait for the settler. */
  openConflicts: number;
}

/** At most this many design blockers are listed; the Design tab has them all. */
const DESIGN_BLOCKERS_SHOWN = 3;

export const NO_DESIGN_BLOCKER =
  'No technical design yet: draft one from the Design tab, then approve it.';

/**
 * What the design still needs before the plan can close [BL-0043]: drafted,
 * sound, approved, and drafted from the PRD as it is now.
 */
export function designCloseBlockers(
  design: PlanCloseDesignFacts | null,
): string[] {
  if (!design || !design.status) return [NO_DESIGN_BLOCKER];
  if (design.status === 'approved' && !design.stale) return [];
  if (design.status === 'drafting') {
    return [
      'Wait for the technical design to finish drafting, then approve it.',
    ];
  }
  if (design.stale) {
    return [
      'The PRD changed after the technical design was drafted: draft it again and approve it.',
    ];
  }
  if (design.status === 'review' && design.ready) {
    return ['Approve the technical design.'];
  }
  const listed = design.blockers
    .map((b) => String(b ?? '').trim())
    .filter(Boolean)
    .slice(0, DESIGN_BLOCKERS_SHOWN)
    .map((b) => `Technical design: ${b}`);
  return listed.length
    ? listed
    : ['Fix the technical design, then approve it.'];
}

export function planCloseReadiness(input: PlanCloseInputs): PlanCloseReadiness {
  const blockers: PlanCloseBlocker[] = [];
  const seen = new Set<string>();
  const add = (kind: PlanCloseBlockerKind, text: string) => {
    const clean = String(text ?? '').trim();
    if (!clean || seen.has(clean)) return;
    seen.add(clean);
    blockers.push({ kind, text: clean });
  };
  for (const text of input.planBlockers) add('prd', text);
  for (const text of designCloseBlockers(input.design)) add('design', text);
  if (input.openConflicts > 0) {
    add(
      'answers',
      input.openConflicts === 1
        ? 'One agent question has answers that differ: choose the one the agent should use.'
        : `${input.openConflicts} agent questions have answers that differ: choose the ones the agent should use.`,
    );
  }
  return {
    ready: blockers.length === 0,
    prdEmpty: input.requirementCount === 0,
    blockers,
  };
}

/** Longest typed reason for closing a plan that is not ready. */
export const CLOSE_REASON_MAX = 500;
/** Shortest: a word or two is not a reason the builder can act on. */
export const CLOSE_REASON_MIN = 10;
