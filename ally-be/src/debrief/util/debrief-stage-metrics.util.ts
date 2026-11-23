import {
  ADVISORY_CHECKS,
  DebriefCards,
  DebriefCheckCode,
  normaliseForQuote,
} from './debrief-cards.util';
import { DEBRIEF_REGISTRY_AGENTS } from '../constants/debrief-release.constants';
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
  /**
   * Expert review of the run (spec Part B): whether anyone reviewed it, the
   * hard fails reviewers ticked, and the tags on their top-level comments.
   * Read by the orchestrator's skipped-then-missed metric.
   */
  reviewed?: boolean;
  reviewHardFails?: string[];
  reviewTags?: string[];
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
  /** The planner, the top-up and every registry agent (orchestrated runs only). */
  orchestrator: OrchestratorMetrics;
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
    orchestrator: orchestratorMetrics(
      runsOnly,
      Object.keys(DEBRIEF_REGISTRY_AGENTS),
    ),
  };
}

// --- The orchestrator: planner, top-up, registry agents ---------------------------

/** One Plan record (`debrief_runs.workspace.plans[]`, ally-ai orchestrator.py). */
export interface PlanRecord {
  phase?: string; // 'plan' | 'top_up'
  source?: string; // 'planner' | 'default' | 'none'
  fallback?: string | null;
  /** planner_failed · no_agents · no_model · no_price · no_budget · nothing_left · no_time. */
  fallbackCode?: string | null;
  chosen?: Array<{ agent: string }>;
  considered?: Array<{ agent: string; whyNot?: string }>;
  /** `code`: already_ran · refused · unavailable · requires · limit · no_price · budget · time. */
  dropped?: Array<{ agent: string; code?: string; why?: string }>;
  profile?: Record<string, any> | null;
}

/** One finding as the run keeps it (spec A3). */
export interface FindingRecord {
  kind?: string;
  turnIndex?: number | null;
  quote?: string | null;
  source?: string | null;
}

/**
 * The agents ally-ai runs in the orchestrated floor (decided 2026-11-11):
 * never offered to the planner, so they have no chosen rate.
 */
export const DEBRIEF_FLOOR_AGENTS: readonly string[] = [
  'analyst',
  'case_memory',
];

/**
 * The miss each agent is there to prevent, as the judge's hard fails, the
 * final draft's blocking checks, a reviewer's ticked hard fails and comment
 * tags name it. The skipped-then-missed metric counts a run when the planner
 * considered an agent, did not choose it, and its miss showed up anyway.
 */
export const AGENT_MISS_SIGNALS: Record<
  string,
  { hardFails: string[]; checks: string[]; tags: string[] }
> = {
  protocol_check: {
    hardFails: ['contradicts_protocol'],
    checks: [],
    tags: ['protocol'],
  },
  history_deep: {
    hardFails: ['unsupported_progress_claim'],
    checks: [DebriefCheckCode.UNSUPPORTED_PROGRESS],
    tags: [],
  },
  progress_reader: {
    hardFails: ['unsupported_progress_claim'],
    checks: [DebriefCheckCode.UNSUPPORTED_PROGRESS],
    tags: [],
  },
  language_specialist: {
    hardFails: ['wrong_language'],
    checks: [DebriefCheckCode.WRONG_LANGUAGE, DebriefCheckCode.QUOTE_MISMATCH],
    tags: ['language'],
  },
};

/** One registry agent's live numbers. */
export interface RegistryAgentMetrics extends StepHealth {
  agent: string;
  /** Runs in the floor, never chosen by the planner. */
  floor: boolean;
  /** Runs where the planner was offered it (chosen, considered, or dropped after choosing). */
  offered: number;
  /** Of those, chosen by the planner in the plan or the top-up, kept or later dropped for budget or time (no value for floor agents). */
  chosenRate: Rate;
  /** Findings it returned per run it answered. */
  findingsPerRunMean: number | null;
  /** Of the quotes it gave, the share dropped because no turn held them. */
  droppedQuoteRate: Rate;
  /** Of its anchored findings (turn or quote) in debriefs that reached the learner, the share a card uses. */
  usedByWriterRate: Rate;
  /** Judged debriefs it answered in that still had a judge hard fail. */
  judgedHardFailRate: Rate;
  topHardFails: Array<{ code: string; runs: number }>;
}

export interface OrchestratorMetrics {
  /** Live runs that planned (have a Plan record). */
  runs: number;
  planner: StepHealth & {
    /** First plans that gave way to the default plan (planner failed or timed out, or could not run). */
    fallbackRate: Rate;
    /** First plans that fell back because the planner timed out. */
    timeoutRate: Rate;
    fallbackReasons: Array<{ code: string; runs: number }>;
    agentsChosenMean: number | null;
    agentsChosenP50: number | null;
    /** First plans that lost at least one chosen agent for each reason. */
    droppedForBudgetRate: Rate;
    droppedForTimeRate: Rate;
    droppedUnavailableRate: Rate;
    /** Agents chosen, across plans, in order of how often. */
    chosen: Array<{ code: string; runs: number }>;
  };
  topUp: {
    /** Runs whose first evaluation failed and reached the top-up. */
    reachedRate: Rate;
    /** Of those, the share where it added at least one agent. */
    addedRate: Rate;
    /** Debriefs that passed (outcome definition) after a top-up that added agents. */
    passAfterTopUpRate: Rate;
  };
  /**
   * Runs with a verdict (judged or expert-reviewed) where the planner
   * considered an agent and skipped it, and that agent's miss showed up.
   * `whenChosen` is the same miss when the agent ran: the comparison that
   * says whether skipping it costs anything.
   */
  skippedThenMissed: {
    overall: Rate;
    byAgent: Array<{ agent: string; whenSkipped: Rate; whenChosen: Rate }>;
  };
  agents: RegistryAgentMetrics[];
  protocolCheck: {
    /** Judged debriefs with protocol_check's answer that contradicted a protocol. */
    contradictsProtocolRate: Rate;
    /** Judged debriefs where it was offered but did not run, that contradicted one. */
    contradictsProtocolWithoutRate: Rate;
    /** Runs where it found a protocol applied (any finding). */
    appliedRate: Rate;
    /** Of its findings, the share naming the protocol (`source: protocol:<code>`). */
    protocolNamedRate: Rate;
  };
  languageSpecialist: {
    /** Indic or code-mixed sessions (from the plan's profile). */
    sessions: number;
    /** wrong_language (judge or check) or quote_mismatch, with and without its answer. */
    missWithRate: Rate;
    missWithoutRate: Rate;
  };
  historyDeep: {
    /** Judged debriefs claiming progress without support, with and without its answer (3+ past debriefs). */
    unsupportedProgressWithRate: Rate;
    unsupportedProgressWithoutRate: Rate;
  };
  /** cohort_comparison and course_patterns: no finding carries words; a refused query is a group under 5. */
  aggregates: Array<{
    agent: string;
    ran: number;
    noQuoteRate: Rate;
    smallGroupRefusedRate: Rate;
  }>;
}

const plansOf = (r: StageRun): PlanRecord[] =>
  Array.isArray(r.workspace?.plans) ? (r.workspace!.plans as PlanRecord[]) : [];

const firstPlan = (r: StageRun) => plansOf(r).find((p) => p.phase !== 'top_up');

const chosenIn = (p: PlanRecord | undefined) =>
  (p?.chosen ?? []).map((c) => c.agent);

const answered = (r: StageRun, agent: string) =>
  (r.steps ?? []).some((s) => s.step === agent && s.status === 'done');

const findingsOf = (r: StageRun, agent: string): FindingRecord[] => {
  const f = r.workspace?.findings?.[agent]?.findings;
  return Array.isArray(f) ? f : [];
};

/** The words and turns the published cards rest on. */
function cardAnchors(cards: unknown): { turns: Set<number>; quotes: string[] } {
  const c = (cards ?? {}) as Partial<DebriefCards>;
  const items: Array<
    { turn_index?: number; quote?: string } | null | undefined
  > = [
    c.important_moment,
    ...(c.important_moment?.others ?? []),
    ...(c.what_worked ?? []),
    ...(c.work_on_this ?? []),
  ];
  const turns = new Set<number>();
  const quotes: string[] = [];
  for (const i of items) {
    if (!i) continue;
    if (typeof i.turn_index === 'number') turns.add(i.turn_index);
    if (i.quote) quotes.push(normaliseForQuote(i.quote));
  }
  return { turns, quotes: quotes.filter(Boolean) };
}

/** A finding the Writer used: its turn or its words are in a published card. */
export function findingUsed(
  f: FindingRecord,
  anchors: { turns: Set<number>; quotes: string[] },
): boolean {
  if (typeof f.turnIndex === 'number' && anchors.turns.has(f.turnIndex)) {
    return true;
  }
  const q = f.quote ? normaliseForQuote(f.quote) : '';
  return !!q && anchors.quotes.some((c) => c.includes(q) || q.includes(c));
}

/** The run showed the miss this agent is there to prevent. */
export function agentMissShown(r: StageRun, agent: string): boolean {
  const sig = AGENT_MISS_SIGNALS[agent];
  if (!sig) return false;
  const o = debriefOutcome(r);
  return (
    o.hardFails.some((h) => sig.hardFails.includes(h)) ||
    (r.reviewHardFails ?? []).some((h) => sig.hardFails.includes(h)) ||
    o.blocking.some((c) => sig.checks.includes(c)) ||
    (r.reviewTags ?? []).some((t) => sig.tags.includes(t))
  );
}

const meanOf = (xs: number[]) =>
  xs.length
    ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10
    : null;

const share = <T>(xs: T[], test: (x: T) => boolean) =>
  rate(xs.filter(test).length, xs.length);

/** The planner, the top-up and every registry agent over live orchestrated runs. */
export function orchestratorMetrics(
  runs: StageRun[],
  agentIds: readonly string[] = [],
): OrchestratorMetrics {
  const planned = runs.filter((r) => firstPlan(r));
  const firsts = planned.map((r) => firstPlan(r)!);
  const withVerdict = planned.filter(
    (r) => debriefOutcome(r).judged || r.reviewed,
  );

  // Planner.
  const fellBack = firsts.filter((p) => p.source === 'default');
  const timedOut = planned.filter((r) => {
    const p = firstPlan(r)!;
    if (p.source !== 'default' || p.fallbackCode !== 'planner_failed') {
      return false;
    }
    return (r.steps ?? []).some(
      (s) =>
        s.step === 'planner' &&
        !s.round &&
        s.status === 'failed' &&
        /timeout/i.test(s.note ?? ''),
    );
  });
  const droppedFor = (code: string) =>
    share(firsts, (p) => (p.dropped ?? []).some((d) => dropCode(d) === code));
  const counts = firsts.map((p) => chosenIn(p).length);

  // Top-up.
  const reached = planned.filter((r) =>
    plansOf(r).some((p) => p.phase === 'top_up'),
  );
  const added = reached.filter((r) =>
    plansOf(r).some((p) => p.phase === 'top_up' && chosenIn(p).length > 0),
  );
  const addedScored = added
    .map((r) => debriefOutcome(r).pass)
    .filter((p): p is boolean => p !== null);

  // Skipped then missed.
  const skipped = (r: StageRun, agent: string) =>
    (firstPlan(r)?.considered ?? []).some((c) => c.agent === agent) &&
    !plansOf(r).some((p) => chosenIn(p).includes(agent));
  const watched = Object.keys(AGENT_MISS_SIGNALS);
  const byAgent = watched.map((agent) => ({
    agent,
    whenSkipped: share(
      withVerdict.filter((r) => skipped(r, agent)),
      (r) => agentMissShown(r, agent),
    ),
    whenChosen: share(
      withVerdict.filter((r) => answered(r, agent)),
      (r) => agentMissShown(r, agent),
    ),
  }));
  const skippedAny = withVerdict.filter((r) =>
    watched.some((a) => skipped(r, a)),
  );

  // Every registry agent (those the release named, plus any seen in a run).
  const seen = new Set<string>(agentIds);
  for (const r of planned) {
    for (const p of plansOf(r)) {
      for (const a of [
        ...chosenIn(p),
        ...(p.considered ?? []).map((c) => c.agent),
        ...(p.dropped ?? []).map((d) => d.agent),
      ]) {
        if (a) seen.add(a);
      }
    }
  }
  const agents = [...seen].map((agent) => registryAgentMetrics(planned, agent));

  // Agent-specific.
  const judgedReady = planned.filter((r) => {
    const o = debriefOutcome(r);
    return o.ready && o.judged;
  });
  const offeredTo = (r: StageRun, agent: string) =>
    plansOf(r).some(
      (p) =>
        chosenIn(p).includes(agent) ||
        (p.considered ?? []).some((c) => c.agent === agent),
    );
  const hasHardFail = (r: StageRun, code: string) =>
    debriefOutcome(r).hardFails.includes(code);
  const protocolRan = planned.filter((r) => answered(r, 'protocol_check'));
  const protocolFindings = protocolRan.flatMap((r) =>
    findingsOf(r, 'protocol_check'),
  );
  const languageSessions = planned.filter((r) => {
    const prof = firstPlan(r)?.profile ?? {};
    return !!(prof.indic || prof.code_mixed);
  });
  const languageMiss = (r: StageRun) => {
    const o = debriefOutcome(r);
    return (
      o.hardFails.includes('wrong_language') ||
      o.blocking.includes(DebriefCheckCode.WRONG_LANGUAGE) ||
      o.blocking.includes(DebriefCheckCode.QUOTE_MISMATCH)
    );
  };
  const languageScored = languageSessions.filter(
    (r) => debriefOutcome(r).ready,
  );
  const longHistory = judgedReady.filter(
    (r) => Number(firstPlan(r)?.profile?.past_debriefs ?? 0) >= 3,
  );

  return {
    runs: planned.length,
    planner: {
      ...stepHealth(planned, 'planner'),
      fallbackRate: rate(fellBack.length, firsts.length),
      timeoutRate: rate(timedOut.length, firsts.length),
      fallbackReasons: tallyCodes(
        fellBack.map((p) => [p.fallbackCode ?? 'unknown']),
      ),
      agentsChosenMean: meanOf(counts),
      agentsChosenP50: pct(counts, 0.5),
      droppedForBudgetRate: droppedFor('budget'),
      droppedForTimeRate: droppedFor('time'),
      droppedUnavailableRate: droppedFor('unavailable'),
      chosen: tallyCodes(
        planned.map((r) => [...new Set(plansOf(r).flatMap(chosenIn))]),
      ),
    },
    topUp: {
      reachedRate: rate(reached.length, planned.length),
      addedRate: rate(added.length, reached.length),
      passAfterTopUpRate: rate(
        addedScored.filter(Boolean).length,
        addedScored.length,
      ),
    },
    skippedThenMissed: {
      overall: share(skippedAny, (r) =>
        watched.some((a) => skipped(r, a) && agentMissShown(r, a)),
      ),
      byAgent,
    },
    agents,
    protocolCheck: {
      contradictsProtocolRate: share(
        judgedReady.filter((r) => answered(r, 'protocol_check')),
        (r) => hasHardFail(r, 'contradicts_protocol'),
      ),
      contradictsProtocolWithoutRate: share(
        judgedReady.filter(
          (r) =>
            offeredTo(r, 'protocol_check') && !answered(r, 'protocol_check'),
        ),
        (r) => hasHardFail(r, 'contradicts_protocol'),
      ),
      appliedRate: share(
        protocolRan,
        (r) => findingsOf(r, 'protocol_check').length > 0,
      ),
      protocolNamedRate: share(protocolFindings, (f) =>
        /^protocol:\S+/.test(f.source ?? ''),
      ),
    },
    languageSpecialist: {
      sessions: languageSessions.length,
      missWithRate: share(
        languageScored.filter((r) => answered(r, 'language_specialist')),
        languageMiss,
      ),
      missWithoutRate: share(
        languageScored.filter((r) => !answered(r, 'language_specialist')),
        languageMiss,
      ),
    },
    historyDeep: {
      unsupportedProgressWithRate: share(
        longHistory.filter((r) => answered(r, 'history_deep')),
        (r) => hasHardFail(r, 'unsupported_progress_claim'),
      ),
      unsupportedProgressWithoutRate: share(
        longHistory.filter((r) => !answered(r, 'history_deep')),
        (r) => hasHardFail(r, 'unsupported_progress_claim'),
      ),
    },
    aggregates: ['cohort_comparison', 'course_patterns'].map((agent) => {
      const ran = planned.filter((r) =>
        (r.steps ?? []).some(
          (s) =>
            s.step === agent && (s.status === 'done' || s.status === 'failed'),
        ),
      );
      const stepOf = (r: StageRun) =>
        (r.steps ?? []).find((s) => s.step === agent && s.status === 'done') as
          | (StageStep & { output?: string })
          | undefined;
      return {
        agent,
        ran: ran.length,
        noQuoteRate: share(
          ran.filter((r) => answered(r, agent)),
          (r) =>
            findingsOf(r, agent).every(
              (f) =>
                !f.quote && (f.turnIndex === null || f.turnIndex === undefined),
            ),
        ),
        smallGroupRefusedRate: share(ran, (r) =>
          /^refused/i.test(stepOf(r)?.output ?? ''),
        ),
      };
    }),
  };
}

/** A dropped agent's reason code; records from before codes existed are read from the text. */
export function dropCode(d: { code?: string; why?: string }): string {
  if (d.code) return d.code;
  const why = d.why ?? '';
  if (/run budget/i.test(why)) return 'budget';
  if (/deadline/i.test(why)) return 'time';
  if (/not available/i.test(why)) return 'unavailable';
  if (/^refused/i.test(why)) return 'refused';
  if (/already ran/i.test(why)) return 'already_ran';
  if (/already has \d+ agents/i.test(why)) return 'limit';
  if (/^needs /i.test(why)) return 'requires';
  if (/no known price/i.test(why)) return 'no_price';
  return 'other';
}

function registryAgentMetrics(
  planned: StageRun[],
  agent: string,
): RegistryAgentMetrics {
  const floor = DEBRIEF_FLOOR_AGENTS.includes(agent);
  const offered = planned.filter((r) =>
    plansOf(r).some(
      (p) =>
        chosenIn(p).includes(agent) ||
        (p.considered ?? []).some((c) => c.agent === agent) ||
        (p.dropped ?? []).some(
          (d) =>
            d.agent === agent &&
            !['refused', 'unavailable', 'already_ran'].includes(dropCode(d)),
        ),
    ),
  );
  const chosen = offered.filter((r) =>
    plansOf(r).some(
      (p) =>
        chosenIn(p).includes(agent) ||
        (p.dropped ?? []).some(
          (d) =>
            d.agent === agent &&
            ['budget', 'time', 'limit', 'requires', 'no_price'].includes(
              dropCode(d),
            ),
        ),
    ),
  );
  const ran = planned.filter((r) => answered(r, agent));
  const findings = ran.map((r) => findingsOf(r, agent));
  const quoted = findings.flat().filter((f) => !!f.quote).length;
  const droppedQuotes = ran.reduce(
    (a, r) => a + Number(r.workspace?.findings?.[agent]?.droppedQuotes ?? 0),
    0,
  );
  const readyRan = ran.filter((r) => debriefOutcome(r).ready);
  const anchored = readyRan.flatMap((r) => {
    const anchors = cardAnchors(r.cards);
    return findingsOf(r, agent)
      .filter(
        (f) => typeof f.turnIndex === 'number' || (f.quote ?? '').trim() !== '',
      )
      .map((f) => findingUsed(f, anchors));
  });
  const judged = ran.filter((r) => {
    const o = debriefOutcome(r);
    return o.ready && o.judged;
  });
  return {
    agent,
    floor,
    ...stepHealth(planned, agent),
    offered: offered.length,
    chosenRate: floor ? rate(0, 0) : rate(chosen.length, offered.length),
    findingsPerRunMean: meanOf(findings.map((f) => f.length)),
    droppedQuoteRate: rate(droppedQuotes, quoted + droppedQuotes),
    usedByWriterRate: rate(anchored.filter(Boolean).length, anchored.length),
    judgedHardFailRate: share(
      judged,
      (r) => debriefOutcome(r).hardFails.length > 0,
    ),
    topHardFails: tallyCodes(judged.map((r) => debriefOutcome(r).hardFails)),
  };
}
