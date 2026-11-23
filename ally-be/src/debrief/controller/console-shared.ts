import { ForbiddenException } from '@nestjs/common';
import { DebriefConsoleViewService } from '../service/debrief-console-view.service';

export type AuthedRequest = { user: { id: number } };

/** A budget change in plain words: "Monthly cap to $150". */
export function budgetTitle(settings: Record<string, number>): string {
  const label: Record<string, (v: number) => string> = {
    monthlyCapUsd: (v) => 'Monthly cap to $' + v,
    runCeilingUsd: (v) => 'Most one debrief may spend to $' + v.toFixed(2),
    passScore: (v) => 'Pass mark to ' + v,
  };
  const parts = Object.entries(settings).map(([k, v]) =>
    label[k] ? label[k](v) : k + ' to ' + v,
  );
  return parts.length ? parts.join(', ') : 'Budget change';
}

/**
 * The Debrief Console's API (plan §12): runs and their timelines, the
 * PM agent's report and ideas with the approval layer, releases and rollback,
 * the test sets, and the per-organisation switch. Ally team only, behind the
 * same ANALYTICS toggle as the calibration set.
 */

/** Release settings (budgets, the evaluator bar) are the owner's. */
export async function requireOwnerFor(
  view: DebriefConsoleViewService,
  userId: number,
  settings: Record<string, unknown> | undefined,
) {
  if (
    settings &&
    Object.keys(settings).length &&
    !(await view.viewer(userId)).can.ownerSettings
  ) {
    throw new ForbiddenException(
      'Only the Debrief owner changes budgets and the evaluator bar',
    );
  }
}
