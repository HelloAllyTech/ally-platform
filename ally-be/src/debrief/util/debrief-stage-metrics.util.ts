import { ADVISORY_CHECKS, DebriefCheckCode } from './debrief-cards.util';
import { debriefOutcome } from './debrief-outcome.util';
import { rate, Rate } from './debrief-metrics.util';

/**
 * Live numbers for each agent inside a debrief run, so a failure is traced to
 * the step that caused it (evals skill §6: grade each stage of a system with
 * parts). Read from what every live run already records — its step trail,
 * workspace, checks and the judge's verdict — with no model call.
 *
 * Offline-only numbers (recall on planted cues, the judge's catch rate on
 * planted faults, decision accuracy on planted ideas) need answers known in
 * advance and are produced by the gates and the paired eval, not here.
 */

export interface StageStep {
  step?: string;
  status?: string;
  note?: string | null;
  model?: string | null;
  ms?: number | null;
  round?: number | null;
}

export interface StageRun {
  status: string;
  cards?: unknown;
  hasRiskCue?: boolean;
  skipReason?: string | null;
  checkFailures?: Array<{ code: string }> | null;
  evaluatorHardFails?: Array<{ code: string }> | null;
  steps?: StageStep[] | null;
  workspace?: Record<string, any> | null;
  /** Debrief Guidance entries the run retrieved, with what grading them needs. */
  passages?: Array<{
    kind?: string | null;
    level?: string[] | null;
    clinical?: boolean;
  }>;
  /** The learner's level (users.metadata.workerType, lower-cased). */
  learnerLevel?: string | null;
}

export interface StepHealth {
  /** Runs where the step ran at least once. */
  ran: number;
  /** Every attempt failed: the step gave nothing. */
  failRate: Rate;
  /** Needed a second attempt (on the backup model when there is one). */
  retryRate: Rate;
  msP50: number | null;
  msP90: number | null;
}

/** Agreement of two yes/no graders on the same items, against a reference. */
export interface Agreement {
  n: number;
  /** Both yes / reference only / candidate only / both no. */
  both: number;
  referenceOnly: number;
  candidateOnly: number;
  neither: number;
  /** Cohen's κ: agreement beyond chance. Raw agreement hides a grader that always says no. */
  kappa: number | null;
  /** Of the items the reference flagged, the share the candidate flagged too. */
  recall: Rate;
  /** Of the items the reference did not flag, the share the candidate flagged. */
  falseFlagRate: Rate;
}

/** Cohen's κ, recall on the reference's positives and false-flag rate (evals skill §4). */
export function agreement(
  items: Array<{ reference: boolean; candidate: boolean }>,
): Agreement {
  const n = items.length;
  const both = items.filter((i) => i.reference && i.candidate).length;
  const referenceOnly = items.filter((i) => i.reference && !i.candidate).length;
  const candidateOnly = items.filter((i) => !i.reference && i.candidate).length;
  const neither = n - both - referenceOnly - candidateOnly;
  let kappa: number | null = null;
  if (n > 0) {
    const po = (both + neither) / n;
    const pRef = (both + referenceOnly) / n;
    const pCand = (both + candidateOnly) / n;
    const pe = pRef * pCand + (1 - pRef) * (1 - pCand);
    kappa = pe >= 1 ? null : Math.round(((po - pe) / (1 - pe)) * 1000) / 1000;
  }
  return {
    n,
    both,
    referenceOnly,
    candidateOnly,
    neither,
    kappa,
    recall: rate(both, both + referenceOnly),
    falseFlagRate: rate(candidateOnly, candidateOnly + neither),
  };
}

const pct = (xs: number[], p: number): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)];
};

function stepHealth(runs: StageRun[], name: string): StepHealth {
  const per = runs
    .map((r) => (r.steps ?? []).filter((s) => s.step === name))
    .filter((ss) =>
      ss.some((s) => s.status === 'done' || s.status === 'failed'),
    );
  const ms = per.flatMap((ss) =>
    ss
      .filter((s) => s.status === 'done' && s.ms != null)
      .map((s) => Number(s.ms)),
  );
  // One run may hold several rounds of a step (the Reviser): a round is one unit.
  const rounds = per.flatMap((ss) => {
    const byRound = new Map<number, StageStep[]>();
    for (const s of ss) {
      const k = s.round ?? 0;
      byRound.set(k, [...(byRound.get(k) ?? []), s]);
    }
    return [...byRound.values()];
  });
  return {
    ran: per.length,
    failRate: rate(
      rounds.filter((r) => !r.some((s) => s.status === 'done')).length,
      rounds.length,
    ),
    retryRate: rate(
      rounds.filter((r) => r.some((s) => s.status === 'failed')).length,
      rounds.length,
    ),
    msP50: pct(ms, 0.5),
    msP90: pct(ms, 0.9),
  };
}

/** Blocking check codes a `checks` step reported for one round ("all passed" = none). */
export function blockingCodesInNote(note: string | null | undefined): string[] {
  if (!note || /all passed/i.test(note)) return [];
  const codes = Object.values(DebriefCheckCode) as string[];
  return [
    ...new Set((note.match(/[a-z_]+/g) ?? []).filter((c) => codes.includes(c))),
  ].filter((c) => !ADVISORY_CHECKS.has(c as DebriefCheckCode));
}

function checksByRound(run: StageRun): Map<number, string[]> {
  const m = new Map<number, string[]>();
  for (const s of run.steps ?? []) {
    if (s.step === 'checks' && s.status === 'done') {
      m.set(s.round ?? 0, blockingCodesInNote(s.note));
    }
  }
  return m;
}

const tallyCodes = (lists: string[][]) => {
  const t: Record<string, number> = {};
  for (const l of lists) for (const c of l) t[c] = (t[c] ?? 0) + 1;
  return Object.entries(t)
    .sort((a, b) => b[1] - a[1])
    .map(([code, runs]) => ({ code, runs }));
};

export interface StageMetrics {
  runs: number;
  safetyReader: StepHealth & {
    /** Share of sessions with at least one client risk cue: a drift signal, not a grade. */
    riskCueRate: Rate;
    /**
     * Debriefs where every cue the reader found was covered, yet the judge
     * still found a missed risk cue — a cue the reader did not find, or one
     * covered without substance.
     */
    judgeMissDespiteCoverage: Rate;
  };
  analyst: StepHealth;
  progressReader: StepHealth & {
    /** Judged debriefs that used a progress reading and still claimed progress without support. */
    unsupportedProgressRate: Rate;
  };
  guidanceLookup: {
    ran: number;
    /** Runs that looked guidance up and got at least one passage. */
    foundRate: Rate;
    passagesPerRunMean: number | null;
    /** Runs with no risk cue that were still given clinical (risk) entries. */
    clinicalOnNoRiskRate: Rate;
    /** Runs given a level guide written for another learner level. */
    wrongLevelRate: Rate;
  };
  writer: StepHealth & {
    /** First drafts that passed every blocking check. */
    firstDraftPassRate: Rate;
    firstDraftFailures: Array<{ code: string; runs: number }>;
  };
  reviser: StepHealth & {
    /** Of runs whose first draft failed a blocking check, the share that ended with none. */
    fixRate: Rate;
    /** Revisions that introduced a blocking failure the draft before did not have. */
    regressionRate: Rate;
    /** Runs that wanted another round and ran out of time. */
    deadlineSkipRate: Rate;
  };
  evaluator: StepHealth & {
    /** Against the independent judge (the reference), on missed risk cues. */
    missedRiskCue: Agreement;
    /** Held for a person because only the Evaluator saw a missed risk cue. */
    heldOnItsOwnRate: Rate;
  };
  judge: {
    /** Debriefs that reached the learner and were scored. */
    judgedRate: Rate;
    versions: string[];
  };
}

/** Every stage's live numbers over a set of live runs. */
export function stageMetrics(runs: StageRun[]): StageMetrics {
  const outcomes = runs.map((r) => ({ r, o: debriefOutcome(r) }));
  const notSkipped = outcomes.filter(({ o }) => !o.skipped);
  const judgedReady = outcomes.filter(({ o }) => o.ready && o.judged);

  // Safety reader.
  const safetyRan = notSkipped.filter(({ r }) =>
    (r.steps ?? []).some(
      (s) => s.step === 'safety_reader' && s.status === 'done',
    ),
  );
  const coveredRisk = judgedReady.filter(
    ({ r, o }) =>
      r.hasRiskCue && !o.blocking.includes(DebriefCheckCode.RISK_CUE_UNCOVERED),
  );

  // Progress reader.
  const withProgress = judgedReady.filter(({ r }) =>
    (r.steps ?? []).some(
      (s) => s.step === 'progress_reader' && s.status === 'done',
    ),
  );

  // Guidance lookup.
  const looked = notSkipped.filter(({ r }) =>
    (r.steps ?? []).some(
      (s) => s.step === 'guidance_lookup' && s.status === 'done',
    ),
  );
  const passages = (r: StageRun) => r.passages ?? [];
  const gotLevelGuide = looked.filter(({ r }) =>
    passages(r).some((p) => p.kind === 'level_guide'),
  );

  // Writer and Reviser, round by round.
  const rounds = notSkipped.map(({ r, o }) => ({
    r,
    o,
    checks: checksByRound(r),
  }));
  const firstDrafts = rounds.filter(({ checks }) => checks.has(0));
  const firstFailed = firstDrafts.filter(
    ({ checks }) => checks.get(0)!.length > 0,
  );
  const revisions = rounds.flatMap(({ checks }) =>
    [...checks.keys()]
      .filter((k) => k > 0 && checks.has(k - 1))
      .map((k) => ({ before: checks.get(k - 1)!, after: checks.get(k)! })),
  );
  const wantedMore = rounds.filter(({ r }) =>
    (r.steps ?? []).some(
      (s) =>
        s.step === 'reviser' &&
        s.status === 'skipped' &&
        /deadline/i.test(s.note ?? ''),
    ),
  );
  const reviserEligible = rounds.filter(({ r }) =>
    (r.steps ?? []).some(
      (s) =>
        s.step === 'reviser' &&
        (s.status === 'done' || /deadline/i.test(s.note ?? '')),
    ),
  );

  // Evaluator against the judge, on the debrief that went out.
  const evalItems = judgedReady.map(({ r, o }) => ({
    reference: o.hardFails.includes('missed_risk_cue'),
    candidate: (r.evaluatorHardFails ?? []).some(
      (h) => h.code === 'missed_risk_cue',
    ),
  }));
  const heldByEvaluatorOnly = outcomes.filter(
    ({ r, o }) =>
      r.status === 'needs_person' &&
      r.skipReason === 'not_evaluated_or_risk' &&
      (r.evaluatorHardFails ?? []).some((h) => h.code === 'missed_risk_cue') &&
      o.judged &&
      !o.hardFails.includes('missed_risk_cue') &&
      !o.blocking.length,
  );
  const evaluated = notSkipped.filter(({ r }) =>
    (r.steps ?? []).some((s) => s.step === 'evaluator' && s.status === 'done'),
  );
  const ready = outcomes.filter(({ o }) => o.ready);
  const runsOnly = runs.filter((r) => r.status !== 'skipped');

  return {
    runs: runsOnly.length,
    safetyReader: {
      ...stepHealth(runsOnly, 'safety_reader'),
      riskCueRate: rate(
        safetyRan.filter(({ r }) => r.hasRiskCue).length,
        safetyRan.length,
      ),
      judgeMissDespiteCoverage: rate(
        coveredRisk.filter(({ o }) => o.hardFails.includes('missed_risk_cue'))
          .length,
        coveredRisk.length,
      ),
    },
    analyst: stepHealth(runsOnly, 'analyst'),
    progressReader: {
      ...stepHealth(runsOnly, 'progress_reader'),
      unsupportedProgressRate: rate(
        withProgress.filter(({ o }) =>
          o.hardFails.includes('unsupported_progress_claim'),
        ).length,
        withProgress.length,
      ),
    },
    guidanceLookup: {
      ran: looked.length,
      foundRate: rate(
        looked.filter(({ r }) => passages(r).length > 0).length,
        looked.length,
      ),
      passagesPerRunMean: looked.length
        ? Math.round(
            (looked.reduce((a, { r }) => a + passages(r).length, 0) /
              looked.length) *
              10,
          ) / 10
        : null,
      clinicalOnNoRiskRate: rate(
        looked.filter(
          ({ r }) => !r.hasRiskCue && passages(r).some((p) => p.clinical),
        ).length,
        looked.filter(({ r }) => !r.hasRiskCue).length,
      ),
      wrongLevelRate: rate(
        gotLevelGuide.filter(({ r }) =>
          passages(r).some(
            (p) =>
              p.kind === 'level_guide' &&
              Array.isArray(p.level) &&
              !!r.learnerLevel &&
              !p.level.includes(r.learnerLevel),
          ),
        ).length,
        gotLevelGuide.length,
      ),
    },
    writer: {
      ...stepHealth(runsOnly, 'writer'),
      firstDraftPassRate: rate(
        firstDrafts.length - firstFailed.length,
        firstDrafts.length,
      ),
      firstDraftFailures: tallyCodes(
        firstFailed.map(({ checks }) => checks.get(0)!),
      ),
    },
    reviser: {
      ...stepHealth(runsOnly, 'reviser'),
      fixRate: rate(
        firstFailed.filter(({ o }) => o.blocking.length === 0).length,
        firstFailed.length,
      ),
      regressionRate: rate(
        revisions.filter(({ before, after }) =>
          after.some((c) => !before.includes(c)),
        ).length,
        revisions.length,
      ),
      deadlineSkipRate: rate(wantedMore.length, reviserEligible.length),
    },
    evaluator: {
      ...stepHealth(runsOnly, 'evaluator'),
      missedRiskCue: agreement(evalItems),
      heldOnItsOwnRate: rate(heldByEvaluatorOnly.length, evaluated.length),
    },
    judge: {
      judgedRate: rate(ready.filter(({ o }) => o.judged).length, ready.length),
      versions: [
        ...new Set(
          judgedReady
            .map(({ r }) => r.workspace?.judge)
            .filter(Boolean)
            .map((j: any) => `${j.model}/${j.promptVersion ?? '?'}`),
        ),
      ].sort(),
    },
  };
}
