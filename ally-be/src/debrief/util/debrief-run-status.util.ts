import { DebriefRunStatus as S } from '../enum/debrief-run.enum';

/**
 * Where a debrief run may go from each status: the one table every writer of `debrief_runs.status`
 * answers to. The TypeScript writers call `checkTransition`; the raw-SQL sweeps take their from and
 * to statuses from `RUN_STATUS_WRITERS`, and a spec checks every writer's pairs against this table,
 * so a new writer or a changed WHERE clause cannot quietly add a path.
 */
export const RUN_STATUS_TRANSITIONS: Readonly<Record<S, readonly S[]>> = {
  [S.QUEUED]: [S.RUNNING, S.SKIPPED, S.FAILED],
  // The graph's answer (or an ending before it): every outcome a run can have.
  [S.RUNNING]: [S.PUBLISHED, S.BELOW_BAR, S.NEEDS_PERSON, S.SKIPPED, S.FAILED],
  // A person sends the learner back to today's debrief.
  [S.PUBLISHED]: [S.SKIPPED],
  // A person finishes it as it is, or sends the learner back to today's debrief.
  [S.BELOW_BAR]: [S.PUBLISHED, S.SKIPPED],
  // Tried again, shown as it is (no debrief is held), finished by a person, or sent back.
  [S.NEEDS_PERSON]: [S.RUNNING, S.BELOW_BAR, S.PUBLISHED, S.SKIPPED],
  [S.SKIPPED]: [],
  // Tried again, finished by a person, or sent back.
  [S.FAILED]: [S.RUNNING, S.PUBLISHED, S.SKIPPED],
};

export function canTransition(from: S, to: S): boolean {
  return from === to || RUN_STATUS_TRANSITIONS[from]?.includes(to) === true;
}

/**
 * Says so (and returns false) when a writer is about to make a move the table does not allow. It
 * never throws: a learner's debrief is never undone by a bookkeeping check.
 */
export function checkTransition(
  from: S,
  to: S,
  log?: { error: (message: string) => void },
  who = 'a writer',
): boolean {
  if (canTransition(from, to)) return true;
  log?.error(
    `[debrief] ${who} moved a run from ${from} to ${to}, which is not an allowed transition`,
  );
  return false;
}

/** Each raw writer of the status: the statuses it reads from and the ones it writes. */
export const RUN_STATUS_WRITERS = {
  /** `retryRun`: a run with no draft is tried again from the start. */
  retry: { from: [S.NEEDS_PERSON, S.FAILED], to: [S.RUNNING] },
  /** `showHeldDrafts`: a draft held for a person is shown as it is. */
  showHeldDraft: { from: [S.NEEDS_PERSON], to: [S.BELOW_BAR] },
  /** `sweepStuckRuns`: a run whose worker died and could not be resumed. */
  sweepStuck: { from: [S.RUNNING], to: [S.NEEDS_PERSON, S.FAILED] },
  /** The graph's answer, applied by the runner. */
  apply: {
    from: [S.RUNNING],
    to: [S.PUBLISHED, S.BELOW_BAR, S.NEEDS_PERSON, S.SKIPPED, S.FAILED],
  },
  /** A person publishes the draft. */
  personPublishes: {
    from: [S.NEEDS_PERSON, S.BELOW_BAR, S.FAILED],
    to: [S.PUBLISHED],
  },
  /** A person sends the learner back to today's debrief. */
  personFallsBack: {
    from: [
      S.QUEUED,
      S.RUNNING,
      S.PUBLISHED,
      S.BELOW_BAR,
      S.NEEDS_PERSON,
      S.FAILED,
    ],
    to: [S.SKIPPED],
  },
} as const;
