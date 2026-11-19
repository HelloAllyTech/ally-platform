import type { PlanCloseReadiness } from 'src/product-planning/util/plan-close-readiness.util';
import type { BuilderPrdReadiness } from '../type/builder-prd.type';

/**
 * A plan session's interview reads the same "ready to close" the Owner's
 * Close plan dialog reads (audit 2026-11-19, rec 2). Builder's own rubric is
 * already in the turn; these helpers add what it does not cover — the
 * technical design, the success measure, the specialist checks and
 * conflicting answers — so the agent stops announcing "complete" over
 * blockers people can see.
 */

/** Falls back to this when Builder's rubric lists nothing; never a real gap of its own. */
const GENERIC_PRD_BLOCKER = 'Finish the PRD.';

/** The gate's blockers that Builder's rubric does not already list. */
export function planGateExtras(
  readiness: Pick<BuilderPrdReadiness, 'sections'>,
  gate: PlanCloseReadiness | null,
): string[] {
  if (!gate || gate.ready) return [];
  const hints = new Set(
    (readiness.sections ?? [])
      .filter((section) => !section.ok)
      .map((section) => String(section.hint ?? '').trim()),
  );
  return gate.blockers
    .map((blocker) => blocker.text)
    .filter((text) => text !== GENERIC_PRD_BLOCKER && !hints.has(text));
}

/**
 * Readiness as a "the plan is ready" claim is judged against: Builder's own,
 * not ready while any gate blocker is open. Each extra becomes a failing row,
 * so the receipt's note lists it in the words the Owner sees.
 */
export function withPlanGate(
  readiness: BuilderPrdReadiness,
  gate: PlanCloseReadiness | null,
): BuilderPrdReadiness {
  const extras = planGateExtras(readiness, gate);
  if (!extras.length) return readiness;
  return {
    ...readiness,
    ready: false,
    blockers: [...readiness.blockers, ...extras],
    sections: [
      ...readiness.sections,
      ...extras.map((text, index) => ({
        key: `plan_gate_${index + 1}`,
        label: 'Before the plan closes',
        ok: false,
        hint: text,
      })),
    ],
  };
}

/** The block a plan session's turn carries beside its readiness. Null when nothing is open. */
export function renderPlanGateBlock(
  readiness: Pick<BuilderPrdReadiness, 'sections'>,
  gate: PlanCloseReadiness | null,
): string | null {
  const extras = planGateExtras(readiness, gate);
  if (!extras.length) return null;
  return [
    '<before_plan_closes>',
    'Besides the readiness rows above, the Owner’s Close plan dialog lists these as open. ' +
      'Until every one is resolved, do not tell anyone the PRD or the plan is ready or complete: ' +
      'say what is left. You can set the success measure with set_success_measure. A person ' +
      'drafts and approves the technical design from the Design tab, and chooses between ' +
      'answers that differ: point them to it rather than claiming it is done.',
    ...extras.map((text) => `- ${text}`),
    '</before_plan_closes>',
  ].join('\n');
}
