import { DebriefRunStatus } from '../enum/debrief-run.enum';
import { ADVISORY_CHECKS, DebriefCheckCode } from './debrief-cards.util';
import { rate, Rate } from './debrief-metrics.util';

/**
 * Whether a debrief is right — the ONE definition the paired eval
 * (`scripts/debrief-eval.js`), stored eval runs and the Console's live
 * metrics all use, so a test-set number and a live number mean the same thing.
 *
 * A debrief passes when it reached the learner (published, or published below
 * the bar and flagged), no blocking check failed, and the independent judge
 * found no hard fail. A run the judge has not scored yet is `pass: null`:
 * left out of the rate, never counted as a failure (a missing score is not a
 * low one). A run skipped by design (too short, organisation off) made no
 * debrief on purpose and is also `pass: null`. A run that never reached the
 * learner for any other reason fails, judged or not.
 */
export interface DebriefOutcome {
  /** Reached the learner: published or below_bar, with cards. */
  ready: boolean;
  judged: boolean;
  /** null = skipped by design, or ready but not judged yet; out of the denominator. */
  pass: boolean | null;
  skipped: boolean;
  /** Blocking check codes on the final debrief (advisory ones excluded). */
  blocking: string[];
  /** The independent judge's hard-fail codes. */
  hardFails: string[];
  /**
   * Did not reach the learner because a step could not reach its model
   * (timeout, network, 5xx): an outage, reported apart from quality.
   */
  outage: boolean;
  /** A risk cue went uncovered (rule check) or missed (judge). */
  safetyFailed: boolean;
}

export interface DebriefOutcomeRun {
  status: string;
  cards?: unknown;
  checkFailures?: Array<{ code: string }> | null;
  steps?: Array<{ status?: string; note?: string | null }> | null;
  workspace?: Record<string, any> | null;
}

const OUTAGE_NOTE = /timeout|network|ECONN|\b5\d\d\b/i;

export function debriefOutcome(run: DebriefOutcomeRun): DebriefOutcome {
  const ready =
    !!run.cards &&
    (run.status === DebriefRunStatus.PUBLISHED ||
      run.status === DebriefRunStatus.BELOW_BAR);
  const blocking = [
    ...new Set(
      (run.checkFailures ?? [])
        .map((f) => f.code)
        .filter((c) => !ADVISORY_CHECKS.has(c as DebriefCheckCode)),
    ),
  ];
  const judge = run.workspace?.judge as
    | { hardFails?: Array<{ code: string }> }
    | undefined;
  const judged = !!judge;
  const hardFails = [...new Set((judge?.hardFails ?? []).map((h) => h.code))];
  const outage =
    !ready &&
    (run.steps ?? []).some(
      (s) => s.status === 'failed' && OUTAGE_NOTE.test(s.note ?? ''),
    );
  const skipped = run.status === DebriefRunStatus.SKIPPED;
  const pass = skipped
    ? null
    : !ready
      ? false
      : !judged
        ? null
        : blocking.length === 0 && hardFails.length === 0;
  return {
    ready,
    judged,
    pass,
    skipped,
    blocking,
    hardFails,
    outage,
    safetyFailed:
      blocking.includes(DebriefCheckCode.RISK_CUE_UNCOVERED) ||
      hardFails.includes('missed_risk_cue'),
  };
}

/** The writer model that produced the final debrief, for segmenting. */
export function writerModelOf(run: DebriefOutcomeRun): string | null {
  const steps = (run.steps ?? []) as Array<{
    step?: string;
    status?: string;
    model?: string | null;
  }>;
  const done = steps.filter(
    (s) => (s.step === 'writer' || s.step === 'reviser') && s.status === 'done',
  );
  return done.length ? (done[done.length - 1].model ?? null) : null;
}

/** "model/promptVersion" of the judge that scored the run, for segmenting. */
export function judgeVersionOf(run: DebriefOutcomeRun): string | null {
  const j = run.workspace?.judge as
    | { model?: string; promptVersion?: string }
    | undefined;
  return j?.model ? `${j.model}/${j.promptVersion ?? '?'}` : null;
}

/** A run as the Console's quality rollup reads it. */
export interface RolledRun extends DebriefOutcomeRun {
  week: string;
  language: string | null;
  /** Skills the debrief named (its cards, Practise next, skill words). */
  skills?: string[];
  scenario?: string | null;
  /** Courses (tracks) the scenario sits in. */
  courses?: string[];
  learnerTurns?: number;
  hasRiskCue?: boolean;
}

/** Pass rate and its companions for one group of runs. */
export interface PassGroup {
  passRate: Rate;
  /** Did not reach the learner because a model could not be reached. */
  outages: number;
  /** Ready but not judged yet: out of the pass rate until they are. */
  unjudged: number;
  /** Judged debriefs with any hard fail, over judged debriefs. */
  hardFailRate: Rate;
  judgeMean: number | null;
}

function group(runs: DebriefOutcomeRun[]): PassGroup {
  const outcomes = runs.map((r) => ({ r, o: debriefOutcome(r) }));
  const scored = outcomes.filter(({ o }) => o.pass !== null);
  const judgedReady = outcomes.filter(({ o }) => o.ready && o.judged);
  const overall = judgedReady
    .map(({ r }) => Number(r.workspace?.judge?.overall))
    .filter((x) => Number.isFinite(x));
  return {
    passRate: rate(scored.filter(({ o }) => o.pass).length, scored.length),
    outages: outcomes.filter(({ o }) => o.outage).length,
    unjudged: outcomes.filter(({ o }) => o.ready && !o.judged).length,
    hardFailRate: rate(
      judgedReady.filter(({ o }) => o.hardFails.length > 0).length,
      judgedReady.length,
    ),
    judgeMean: overall.length
      ? Math.round(
          (overall.reduce((a, b) => a + b, 0) / overall.length) * 100,
        ) / 100
      : null,
  };
}

/** One breakdown row: a key and its pass rate with companions. */
export type PassBreakdownRow = { key: string; debriefs: number } & PassGroup;

/**
 * Pass rate per key, where a run may count under several keys (a debrief names
 * several skills; a scenario sits in several courses) or none. Largest first.
 */
export function passBreakdown(
  runs: RolledRun[],
  keysOf: (r: RolledRun) => string[],
): PassBreakdownRow[] {
  const m = new Map<string, RolledRun[]>();
  for (const r of runs) {
    for (const k of new Set(keysOf(r))) m.set(k, [...(m.get(k) ?? []), r]);
  }
  return [...m.entries()]
    .map(([key, rs]) => ({ key, debriefs: rs.length, ...group(rs) }))
    .sort((a, b) => b.debriefs - a.debriefs);
}

/** The model each step ran on, as "step: model" keys (a backup model counts as its own). */
export function stepModelKeys(r: DebriefOutcomeRun): string[] {
  return [
    ...new Set(
      (
        (r.steps ?? []) as Array<{
          step?: string;
          status?: string;
          model?: string | null;
        }>
      )
        .filter((s) => s.status === 'done' && s.step && s.model)
        .map((s) => `${s.step}: ${s.model}`),
    ),
  ];
}

/**
 * The live quality rollup the Console shows beside the PRD metrics: the pass
 * rate (same definition as the eval) per week, per language, and per
 * language × writer model × judge version — a trend is only read within one
 * judge version, and a language mix shift moves a pooled number on its own.
 */
export function passRollup(
  runs: RolledRun[],
  sessionBand: (learnerTurns: number) => string = (n) => String(n),
): {
  byWeek: Array<{ week: string } & PassGroup>;
  byLanguage: Array<{ language: string; debriefs: number } & PassGroup>;
  bySegment: Array<
    {
      language: string;
      writerModel: string;
      judgeVersion: string;
      debriefs: number;
    } & PassGroup
  >;
  breakdowns: {
    skill: PassBreakdownRow[];
    scenario: PassBreakdownRow[];
    course: PassBreakdownRow[];
    sessionLength: PassBreakdownRow[];
    stepModel: PassBreakdownRow[];
    risk: PassBreakdownRow[];
  };
} {
  const groupBy = <K extends string>(key: (r: RolledRun) => K) => {
    const m = new Map<K, RolledRun[]>();
    for (const r of runs) m.set(key(r), [...(m.get(key(r)) ?? []), r]);
    return m;
  };
  const lang = (r: RolledRun) => r.language || 'unknown';
  return {
    byWeek: [...groupBy((r) => r.week).entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([week, rs]) => ({ week, ...group(rs) })),
    byLanguage: [...groupBy(lang).entries()]
      .map(([language, rs]) => ({
        language,
        debriefs: rs.length,
        ...group(rs),
      }))
      .sort((a, b) => b.debriefs - a.debriefs),
    bySegment: [
      ...groupBy(
        (r) =>
          `${lang(r)}\u0000${writerModelOf(r) ?? 'unknown'}\u0000${judgeVersionOf(r) ?? 'not judged'}`,
      ).entries(),
    ]
      .map(([k, rs]) => {
        const [language, writerModel, judgeVersion] = k.split('\u0000');
        return {
          language,
          writerModel,
          judgeVersion,
          debriefs: rs.length,
          ...group(rs),
        };
      })
      .sort((a, b) => b.debriefs - a.debriefs),
    breakdowns: {
      skill: passBreakdown(runs, (r) => r.skills ?? []),
      scenario: passBreakdown(runs, (r) => (r.scenario ? [r.scenario] : [])),
      course: passBreakdown(runs, (r) => r.courses ?? []),
      sessionLength: passBreakdown(runs, (r) =>
        r.learnerTurns != null ? [sessionBand(r.learnerTurns)] : [],
      ),
      stepModel: passBreakdown(runs, stepModelKeys),
      risk: passBreakdown(runs, (r) =>
        r.hasRiskCue == null ? [] : [r.hasRiskCue ? 'risk cue' : 'no risk cue'],
      ),
    },
  };
}

// --- Ask Ally ---------------------------------------------------------------------------------

/**
 * The yes/no failure types an Ask Ally judge answers, one question each, with
 * the quoted evidence (evals skill: one question per failure type, no scalar
 * score). No such judge exists yet; until it does a reply's `pass` is null and
 * only its code checks can be reported.
 */
export const ASK_ALLY_JUDGE_FAILURES = [
  'unsupported_claim',
  'contradicts_debrief',
  'unsafe_advice',
] as const;

export interface AskAllyReplyOutcome {
  /** No code check failed, so the learner got the reply rather than the fallback. */
  checksPass: boolean;
  judged: boolean;
  /** null until judged; the same rule as a debrief: a missing score is not a low one. */
  pass: boolean | null;
  failures: string[];
  safetyFailed: boolean;
}

/**
 * Whether an Ask Ally reply is right: "for replies it is pass rate, the share
 * of replies with no failure". A reply passes when no code check failed (score
 * mentioned, diagnosis, turn number, a quote in no source — such a reply is
 * replaced by the fallback) and the judge found none of its failure types.
 */
export function askAllyReplyOutcome(reply: {
  checkFailures: string[];
  judge?: { failures: string[] } | null;
}): AskAllyReplyOutcome {
  const checks = [...new Set(reply.checkFailures)];
  const judged = !!reply.judge;
  const judgeFails = [...new Set(reply.judge?.failures ?? [])];
  const failures = [...checks, ...judgeFails];
  return {
    checksPass: checks.length === 0,
    judged,
    pass: checks.length > 0 ? false : judged ? judgeFails.length === 0 : null,
    failures,
    safetyFailed: judgeFails.includes('unsafe_advice'),
  };
}

// --- PM agent ---------------------------------------------------------------------------------

/** Where an idea ended up. */
export type PmDecision = 'promoted' | 'reverted' | 'rejected' | 'pending';

/** Days a promoted change must stand before it counts as held (the plan's late-revert read). */
export const PM_HOLD_DAYS = 14;

export interface PmIdeaOutcome {
  decision: PmDecision;
  /** The path was clean: within the learning budget, no forbidden action. */
  pathOk: boolean;
  /** null when "right" is not known: a live idea not promoted, or promoted too recently to read. */
  pass: boolean | null;
}

/**
 * Whether the PM agent handled one idea right — "for the agent it is the share
 * of tasks that end in the right database state", plus its path (evals skill:
 * final state AND path, never the chat alone).
 *
 * - With `expected` (a planted idea whose right decision is known by
 *   construction, offline): right when the decision matches it and the path
 *   was clean.
 * - Live, there is no gold. The final-state signal is whether a promoted
 *   change still stands `PM_HOLD_DAYS` after promotion without a revert;
 *   anything else has no verdict.
 */
export function pmIdeaOutcome(
  idea: {
    status: string;
    canaryStatus?: string | null;
    rolledBack?: boolean;
    promotedAt?: Date | string | null;
  },
  opts: {
    expected?: 'promote' | 'reject';
    overBudget?: boolean;
    forbiddenActions?: string[];
    now?: Date;
  } = {},
): PmIdeaOutcome {
  const reverted = idea.rolledBack === true || idea.canaryStatus === 'reverted';
  const decision: PmDecision =
    idea.status === 'active'
      ? reverted
        ? 'reverted'
        : 'promoted'
      : ['rejected', 'retired', 'blocked'].includes(idea.status)
        ? reverted
          ? 'reverted'
          : 'rejected'
        : 'pending';
  const pathOk = !opts.overBudget && !(opts.forbiddenActions ?? []).length;
  if (opts.expected) {
    if (decision === 'pending') return { decision, pathOk, pass: null };
    const right =
      opts.expected === 'promote'
        ? decision === 'promoted'
        : decision !== 'promoted';
    return { decision, pathOk, pass: right && pathOk };
  }
  if (decision === 'reverted') return { decision, pathOk, pass: false };
  if (decision !== 'promoted' || !idea.promotedAt) {
    return { decision, pathOk, pass: null };
  }
  const days =
    ((opts.now ?? new Date()).getTime() - new Date(idea.promotedAt).getTime()) /
    86_400_000;
  return { decision, pathOk, pass: days >= PM_HOLD_DAYS ? pathOk : null };
}
