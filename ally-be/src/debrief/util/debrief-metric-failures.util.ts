import type { ExperienceRates } from '../service/debrief-metrics.service';
import { MIN_RATE_SAMPLE, Rate, rate } from './debrief-metrics.util';
import type { StageMetrics } from './debrief-stage-metrics.util';

/**
 * Metric failure points (spec C2): what the PM agent reads as "something is
 * off", computed from the Metrics service's view so the Console and the agent
 * read one definition. Each point has a stable `name` the agent cites as
 * evidence and as the metric an idea should move (C5 reads it back).
 */

/** v9 §3.3 experience targets (the Console Metrics tab shows the same). */
export const EXPERIENCE_TARGETS: Record<
  keyof ExperienceRates,
  { atLeast?: number; atMost?: number } | null
> = {
  openedWithin24h: { atLeast: 0.85 },
  readThrough: { atLeast: 0.7 },
  practiseClickThrough: { atLeast: 0.25 },
  reflectionAnswered: { atLeast: 0.15 },
  abandonedBeforeReady: { atMost: 0.1 },
  flagsWithinSla: { atLeast: 0.95 },
  listened: null,
  replied: null,
};

/** The judge's bar (PRD §8). */
const JUDGE_BAR = 8;
/** A weekly median this much above the earlier weeks' mean is drift. */
const DRIFT_SHARE = 0.2;
/** Steering points lost week on week before it counts as falling. */
const STEERING_DROP = 3;
/** A stage that fails more often than this is a failure point. */
const STAGE_FAIL_RATE = 0.05;

export type FailureKind =
  | 'experience_off_target'
  | 'guardrail_breached'
  | 'efficiency_drift'
  | 'steering_falling'
  | 'stage_failing';

export interface MetricFailurePoint {
  kind: FailureKind;
  /** Stable name, e.g. `read_through`, `hard_fail_rate`, `writer.first_draft_pass_rate`. */
  name: string;
  /** e.g. `language=hi`, `platform=android`, `all`. */
  segment: string;
  value: number | null;
  n: number | null;
  target: string;
  why: string;
}

/** Every metric name an idea may name as its expected effect, with which way is better. */
export const PM_AGENT_METRICS: Record<string, 'up' | 'down'> = {
  opened_within_24h: 'up',
  read_through: 'up',
  practise_click_through: 'up',
  reflection_answered: 'up',
  abandoned_before_ready: 'down',
  flags_within_sla: 'up',
  listened: 'up',
  replied: 'up',
  judge_p50: 'up',
  hard_fail_rate: 'down',
  fabricated_quotes: 'down',
  thumbs_down_rate: 'down',
  cost_p50: 'down',
  revision_rounds_p50: 'down',
  visible_seconds_p50: 'down',
  steering: 'up',
  'writer.first_draft_pass_rate': 'up',
  'reviser.fix_rate': 'up',
  'reviser.regression_rate': 'down',
  'safety_reader.fail_rate': 'down',
  'analyst.fail_rate': 'down',
  'writer.fail_rate': 'down',
  'evaluator.fail_rate': 'down',
  'guidance_lookup.found_rate': 'up',
};

const snake = (k: string) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

/** The parts of `DebriefMetricsService.view()` this reads. */
export interface MetricsViewLike {
  series: Array<{
    week: string;
    debriefs: number;
    steering: { value: number | null };
    guardrails: {
      judgeP50: number | null;
      judged: number;
      hardFailRate: Rate;
      fabricatedQuotes: number;
      thumbsDownRate: Rate;
      costP50: number | null;
      visibleSecondsP50: number | null;
    };
    efficiency: { revisionRoundsP50: number | null };
    experience: ExperienceRates;
  }>;
  byLanguage: Array<{
    key: string;
    debriefs: number;
    experience: ExperienceRates;
  }>;
  byPlatform: Array<{
    key: string;
    debriefs: number;
    experience: ExperienceRates;
  }>;
  baselines: { legacyHardFailRate: Rate; legacyThumbsDownRate: Rate };
  agents: { stages: StageMetrics };
}

const sumRates = (rates: Rate[]): Rate =>
  rate(
    rates.reduce((a, r) => a + r.n, 0),
    rates.reduce((a, r) => a + r.of, 0),
  );

const mean = (xs: Array<number | null>): number | null => {
  const v = xs.filter((x): x is number => x != null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};

const r3 = (x: number | null) =>
  x == null ? null : Math.round(x * 1000) / 1000;

function experiencePoints(
  segment: string,
  e: ExperienceRates,
): MetricFailurePoint[] {
  const out: MetricFailurePoint[] = [];
  for (const key of Object.keys(EXPERIENCE_TARGETS) as Array<
    keyof ExperienceRates
  >) {
    const t = EXPERIENCE_TARGETS[key];
    const r = e[key];
    if (!t || !r || r.value == null || r.of < MIN_RATE_SAMPLE) continue;
    const missed =
      (t.atLeast != null && r.value < t.atLeast) ||
      (t.atMost != null && r.value > t.atMost);
    if (!missed) continue;
    out.push({
      kind: 'experience_off_target',
      name: snake(key),
      segment,
      value: r3(r.value),
      n: r.of,
      target: t.atLeast != null ? `>= ${t.atLeast}` : `<= ${t.atMost}`,
      why: `${snake(key)} is off its v9 target for ${segment}`,
    });
  }
  return out;
}

/** The current value of every named metric over the window, for C5's before/after. */
export function metricValues(
  view: MetricsViewLike,
): Record<string, number | null> {
  const s = view.series;
  const last = s[s.length - 1];
  const exp = (k: keyof ExperienceRates) =>
    sumRates(s.map((w) => w.experience[k])).value;
  const st = view.agents.stages;
  return {
    opened_within_24h: exp('openedWithin24h'),
    read_through: exp('readThrough'),
    practise_click_through: exp('practiseClickThrough'),
    reflection_answered: exp('reflectionAnswered'),
    abandoned_before_ready: exp('abandonedBeforeReady'),
    flags_within_sla: exp('flagsWithinSla'),
    listened: exp('listened'),
    replied: exp('replied'),
    judge_p50: last?.guardrails.judgeP50 ?? null,
    hard_fail_rate: sumRates(s.map((w) => w.guardrails.hardFailRate)).value,
    fabricated_quotes: s.reduce((a, w) => a + w.guardrails.fabricatedQuotes, 0),
    thumbs_down_rate: sumRates(s.map((w) => w.guardrails.thumbsDownRate)).value,
    cost_p50: last?.guardrails.costP50 ?? null,
    revision_rounds_p50: last?.efficiency.revisionRoundsP50 ?? null,
    visible_seconds_p50: last?.guardrails.visibleSecondsP50 ?? null,
    steering: last?.steering.value ?? null,
    'writer.first_draft_pass_rate':
      st?.writer?.firstDraftPassRate?.value ?? null,
    'reviser.fix_rate': st?.reviser?.fixRate?.value ?? null,
    'reviser.regression_rate': st?.reviser?.regressionRate?.value ?? null,
    'safety_reader.fail_rate': st?.safetyReader?.failRate?.value ?? null,
    'analyst.fail_rate': st?.analyst?.failRate?.value ?? null,
    'writer.fail_rate': st?.writer?.failRate?.value ?? null,
    'evaluator.fail_rate': st?.evaluator?.failRate?.value ?? null,
    'guidance_lookup.found_rate': st?.guidanceLookup?.foundRate?.value ?? null,
  };
}

/**
 * C2's failure points. Thin samples (under MIN_RATE_SAMPLE) are left out
 * rather than raised: a missing score is not a low score (METRICS.md). The
 * orchestrator's "plan skipped an agent experts later said was missed" point
 * waits for the orchestrator (spec Part A, step 7).
 */
export function metricFailurePoints(
  view: MetricsViewLike,
): MetricFailurePoint[] {
  const points: MetricFailurePoint[] = [];
  const s = view.series;
  if (!s.length) return points;
  const last = s[s.length - 1];
  const earlier = s.slice(0, -1);

  // Experience, overall and per language and device.
  const overall = Object.fromEntries(
    (Object.keys(EXPERIENCE_TARGETS) as Array<keyof ExperienceRates>).map(
      (k) => [k, sumRates(s.map((w) => w.experience[k]))],
    ),
  ) as unknown as ExperienceRates;
  points.push(...experiencePoints('all', overall));
  for (const b of view.byLanguage) {
    points.push(...experiencePoints(`language=${b.key}`, b.experience));
  }
  for (const b of view.byPlatform) {
    points.push(...experiencePoints(`platform=${b.key}`, b.experience));
  }

  // Guardrails.
  const hf = sumRates(s.map((w) => w.guardrails.hardFailRate));
  const legacyHf = view.baselines.legacyHardFailRate.value;
  if (
    hf.value != null &&
    hf.of >= MIN_RATE_SAMPLE &&
    legacyHf != null &&
    hf.value > legacyHf
  ) {
    points.push({
      kind: 'guardrail_breached',
      name: 'hard_fail_rate',
      segment: 'all',
      value: r3(hf.value),
      n: hf.of,
      target: `<= ${r3(legacyHf)} (pre-launch)`,
      why: 'judge hard-fail rate is above the pre-launch baseline',
    });
  }
  const fabricated = s.reduce((a, w) => a + w.guardrails.fabricatedQuotes, 0);
  if (fabricated > 0) {
    points.push({
      kind: 'guardrail_breached',
      name: 'fabricated_quotes',
      segment: 'all',
      value: fabricated,
      n: null,
      target: '0',
      why: 'the judge found quotes that are not in the transcript',
    });
  }
  const td = sumRates(s.map((w) => w.guardrails.thumbsDownRate));
  const preTd = view.baselines.legacyThumbsDownRate.value;
  if (
    td.value != null &&
    td.of >= MIN_RATE_SAMPLE &&
    preTd != null &&
    td.value > preTd
  ) {
    points.push({
      kind: 'guardrail_breached',
      name: 'thumbs_down_rate',
      segment: 'all',
      value: r3(td.value),
      n: td.of,
      target: `<= ${r3(preTd)} (pre-launch)`,
      why: 'thumbs-down rate is above the pre-launch baseline',
    });
  }
  if (
    last.guardrails.judgeP50 != null &&
    last.guardrails.judged >= MIN_RATE_SAMPLE &&
    last.guardrails.judgeP50 < JUDGE_BAR
  ) {
    points.push({
      kind: 'guardrail_breached',
      name: 'judge_p50',
      segment: `week=${last.week}`,
      value: last.guardrails.judgeP50,
      n: last.guardrails.judged,
      target: `>= ${JUDGE_BAR}`,
      why: "the judge's median is below the bar",
    });
  }

  // Efficiency drift: the latest week against the earlier weeks' mean.
  const drift = (
    name: string,
    pick: (w: MetricsViewLike['series'][number]) => number | null,
  ) => {
    const now = pick(last);
    const before = mean(earlier.map(pick));
    if (
      now != null &&
      before != null &&
      before > 0 &&
      now > before * (1 + DRIFT_SHARE)
    ) {
      points.push({
        kind: 'efficiency_drift',
        name,
        segment: `week=${last.week}`,
        value: now,
        n: last.debriefs,
        target: `<= ${r3(before * (1 + DRIFT_SHARE))} (earlier weeks +${DRIFT_SHARE * 100}%)`,
        why: `${name} rose against the earlier weeks`,
      });
    }
  };
  drift('cost_p50', (w) => w.guardrails.costP50);
  drift('revision_rounds_p50', (w) => w.efficiency.revisionRoundsP50);
  drift('visible_seconds_p50', (w) => w.guardrails.visibleSecondsP50);

  // Steering falling: down week on week by more than STEERING_DROP points.
  const prev = earlier[earlier.length - 1];
  if (
    prev?.steering.value != null &&
    last.steering.value != null &&
    prev.steering.value - last.steering.value > STEERING_DROP
  ) {
    points.push({
      kind: 'steering_falling',
      name: 'steering',
      segment: `week=${last.week}`,
      value: last.steering.value,
      n: last.debriefs,
      target: `>= ${prev.steering.value - STEERING_DROP} (last week ${prev.steering.value})`,
      why: 'the steering score fell week on week',
    });
  }

  // Stages failing more often (an agent with more hard fails).
  const st = view.agents.stages;
  const stage = (name: string, r: Rate | undefined) => {
    if (
      r?.value != null &&
      r.of >= MIN_RATE_SAMPLE &&
      r.value > STAGE_FAIL_RATE
    ) {
      points.push({
        kind: 'stage_failing',
        name: `${name}.fail_rate`,
        segment: 'all',
        value: r3(r.value),
        n: r.of,
        target: `<= ${STAGE_FAIL_RATE}`,
        why: `the ${name} step fails on its own often`,
      });
    }
  };
  stage('safety_reader', st?.safetyReader?.failRate);
  stage('analyst', st?.analyst?.failRate);
  stage('writer', st?.writer?.failRate);
  stage('evaluator', st?.evaluator?.failRate);
  const fdp = st?.writer?.firstDraftPassRate;
  if (fdp?.value != null && fdp.of >= MIN_RATE_SAMPLE && fdp.value < 0.5) {
    points.push({
      kind: 'stage_failing',
      name: 'writer.first_draft_pass_rate',
      segment: 'all',
      value: r3(fdp.value),
      n: fdp.of,
      target: '>= 0.5',
      why: `most first drafts fail a blocking check (top: ${(
        st.writer.firstDraftFailures ?? []
      )
        .slice(0, 3)
        .map((f) => f.code)
        .join(', ')})`,
    });
  }
  const reg = st?.reviser?.regressionRate;
  if (
    reg?.value != null &&
    reg.of >= MIN_RATE_SAMPLE &&
    reg.value > STAGE_FAIL_RATE
  ) {
    points.push({
      kind: 'stage_failing',
      name: 'reviser.regression_rate',
      segment: 'all',
      value: r3(reg.value),
      n: reg.of,
      target: `<= ${STAGE_FAIL_RATE}`,
      why: 'revisions introduce new blocking failures',
    });
  }
  return points;
}
