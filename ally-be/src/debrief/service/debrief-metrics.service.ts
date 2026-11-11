import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  Rate,
  rate,
  steeringScore,
  SteeringScore,
  uptakeLift,
  UptakeResult,
  UptakeRun,
} from '../util/debrief-metrics.util';
import { DebriefSettingsService } from './debrief-settings.service';
import { passRollup, RolledRun } from '../util/debrief-outcome.util';

/** Live debriefs a learner can read. */
const READABLE = `r.mode = 'live' AND r.status IN ('published','below_bar')`;
/** A flag becomes reviewable once its 10-minute withdraw window has passed. */
const FLAG_WITHDRAW_MINUTES = 10;

export interface DebriefMetricsWeek {
  week: string;
  debriefs: number;
  steering: SteeringScore;
  guardrails: {
    judgeP50: number | null;
    judgeMean: number | null;
    judged: number;
    hardFailRate: Rate;
    fabricatedQuotes: number;
    thumbsDownRate: Rate;
    visibleSecondsP50: number | null;
    visibleSecondsP90: number | null;
    costP50: number | null;
    costP90: number | null;
    evaluatorJudgeGap: number | null;
  };
  efficiency: {
    savedUsdMean: number | null;
    revisionRoundsP50: number | null;
    stepsP50: number | null;
    within10Min: Rate;
  };
  experience: ExperienceRates;
}

export interface ExperienceRates {
  openedWithin24h: Rate;
  readThrough: Rate;
  practiseClickThrough: Rate;
  reflectionAnswered: Rate;
  abandonedBeforeReady: Rate;
  flagsWithinSla: Rate;
  listened: Rate;
  replied: Rate;
}

/**
 * The debrief's metrics (v9 §3.3, PRD §4) for the Console: weekly series of
 * the steering proxy, guardrails, agent efficiency and experience over live
 * debriefs, experience broken down by language and device, the two
 * baselines, and the monthly uptake lift. Reads only; nothing here costs a
 * model call.
 */
@Injectable()
export class DebriefMetricsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly settings: DebriefSettingsService,
  ) {}

  async view(weeks = 12) {
    const w = Math.max(4, Math.min(52, Math.round(weeks)));
    const s = await this.settings.get();
    const weights = {
      judge: s.steeringWeightJudge,
      practise: s.steeringWeightPractise,
      thumbs: s.steeringWeightThumbs,
    };
    const rows = await this.weekly(w, s.flagReviewSlaHours);
    const series: DebriefMetricsWeek[] = rows.map((r) => {
      const practise = rate(
        num(r.practise_clicks),
        num(r.opened_with_practise),
      );
      const thumbs = rate(
        num(r.thumbs_up),
        num(r.thumbs_up) + num(r.thumbs_down),
      );
      return {
        week: new Date(r.week).toISOString().slice(0, 10),
        debriefs: num(r.debriefs),
        steering: steeringScore(opt(r.judge_mean), practise, thumbs, weights),
        guardrails: {
          judgeP50: opt(r.judge_p50),
          judgeMean: opt(r.judge_mean),
          judged: num(r.judged),
          hardFailRate: rate(num(r.hard_failed), num(r.judged)),
          fabricatedQuotes: num(r.fabricated),
          thumbsDownRate: rate(
            num(r.thumbs_down),
            num(r.thumbs_up) + num(r.thumbs_down),
          ),
          visibleSecondsP50: opt(r.visible_p50),
          visibleSecondsP90: opt(r.visible_p90),
          costP50: opt(r.cost_p50),
          costP90: opt(r.cost_p90),
          evaluatorJudgeGap: opt(r.eval_gap),
        },
        efficiency: {
          savedUsdMean: opt(r.saved_mean),
          revisionRoundsP50: opt(r.revisions_p50),
          stepsP50: opt(r.steps_p50),
          within10Min: rate(num(r.within_10), num(r.no_risk_runs)),
        },
        experience: experience(r),
      };
    });
    const [byLanguage, byPlatform, baselines, uptake, safety, quality] =
      await Promise.all([
        this.breakdown(w, s.flagReviewSlaHours, 'language'),
        this.breakdown(w, s.flagReviewSlaHours, 'platform'),
        this.baselines(),
        this.uptakeByMonth(6),
        this.latestSafetyRecall(),
        this.quality(w),
      ]);
    return {
      weeks: w,
      weights,
      flagReviewSlaHours: s.flagReviewSlaHours,
      series,
      byLanguage,
      byPlatform,
      baselines,
      uptake,
      safetyRecall: safety,
      quality,
      generatedAt: new Date().toISOString(),
    };
  }

  /** Every per-run fact the weekly series and breakdowns are built from. */
  private runFacts(weeks: number, slaHours: number) {
    return `
      WITH runs AS (
        SELECT r.id, r."scenarioSessionId" AS session_id, r."createdAt",
               r."finishedAt", r.status, r.language, r."hasRiskCue" AS risk,
               r."revisionRounds" AS revisions,
               COALESCE(jsonb_array_length(CASE WHEN jsonb_typeof(r.steps) = 'array' THEN r.steps END), 0) AS steps,
               COALESCE(r."actualCostUsd", r."estimatedCostUsd")::float AS cost,
               r."ceilingUsd"::float AS ceiling,
               r."evaluatorOverall"::float AS evaluator,
               (r.workspace->'judge'->>'overall')::float AS judge,
               COALESCE(jsonb_array_length(r.workspace->'judge'->'hardFails'), 0) AS hard_fails,
               COALESCE(r.workspace->'judge'->'hardFails' @> '[{"code":"fabricated_quote"}]', false) AS fabricated,
               (r.cards ? 'practise_next' AND r.cards->'practise_next' <> 'null'::jsonb) AS has_practise,
               EXTRACT(EPOCH FROM (r."finishedAt" - s."endedAt"))::float AS visible_s,
               ${READABLE} AS readable
          FROM debrief_runs r
          JOIN scenario_sessions s ON s.id = r."scenarioSessionId"
         WHERE r.mode = 'live' AND r.status <> 'skipped'
           AND r."createdAt" >= date_trunc('week', now()) - make_interval(weeks => ${weeks - 1})
      ),
      ev AS (
        SELECT e."scenarioSessionId" AS session_id,
               max(e."createdAt") FILTER (WHERE e.kind = 'opened') AS opened_at,
               max(e.platform) FILTER (WHERE e.kind = 'opened') AS platform,
               bool_or(e.kind = 'read_through') AS read_through,
               bool_or(e.kind = 'listened') AS listened,
               bool_or(e.kind = 'practise_next_click') AS practise_click,
               bool_or(e.kind = 'reflection_answered') AS reflected,
               bool_or(e.kind = 'replied') AS replied,
               bool_or(e.kind = 'waited') AS waited,
               bool_or(e.kind = 'left_before_ready') AS left_early
          FROM debrief_learner_events e
         WHERE e."scenarioSessionId" IN (SELECT session_id FROM runs)
         GROUP BY 1
      ),
      thumbs AS (
        SELECT f."runId" AS run_id, bool_or(f.helpful) AS up, bool_or(NOT f.helpful) AS down
          FROM debrief_run_feedback f
         WHERE f.kind = 'helpful' AND f."runId" IN (SELECT id FROM runs)
         GROUP BY 1
      ),
      flags AS (
        SELECT f."runId" AS run_id,
               count(*) FILTER (WHERE f."createdAt" + make_interval(mins => ${FLAG_WITHDRAW_MINUTES}, hours => ${slaHours}) <= now()) AS due,
               count(*) FILTER (WHERE f."createdAt" + make_interval(mins => ${FLAG_WITHDRAW_MINUTES}, hours => ${slaHours}) <= now()
                                  AND f."resolvedAt" IS NOT NULL
                                  AND f."resolvedAt" <= f."createdAt" + make_interval(mins => ${FLAG_WITHDRAW_MINUTES}, hours => ${slaHours})) AS on_time
          FROM debrief_run_feedback f
         WHERE f.kind = 'flag' AND f.status <> 'withdrawn' AND f."runId" IN (SELECT id FROM runs)
         GROUP BY 1
      ),
      facts AS (
        SELECT runs.*, ev.opened_at, COALESCE(ev.platform, 'unknown') AS platform,
               COALESCE(ev.read_through, false) AS read_through,
               COALESCE(ev.listened, false) AS listened,
               COALESCE(ev.practise_click, false) AS practise_click,
               COALESCE(ev.reflected, false) AS reflected,
               COALESCE(ev.replied, false) AS replied,
               COALESCE(ev.waited, false) AS waited,
               COALESCE(ev.left_early, false) AS left_early,
               COALESCE(thumbs.up, false) AS thumbs_up,
               COALESCE(thumbs.down, false) AS thumbs_down,
               COALESCE(flags.due, 0) AS flags_due,
               COALESCE(flags.on_time, 0) AS flags_on_time
          FROM runs
          LEFT JOIN ev ON ev.session_id = runs.session_id
          LEFT JOIN thumbs ON thumbs.run_id = runs.id
          LEFT JOIN flags ON flags.run_id = runs.id
      )`;
  }

  /** The aggregates every group (a week, a language, a device) reports. */
  private static readonly AGGREGATES = `
      count(*) FILTER (WHERE readable)::int AS debriefs,
      count(*) FILTER (WHERE readable AND judge IS NOT NULL)::int AS judged,
      avg(judge) FILTER (WHERE readable) AS judge_mean,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY judge) FILTER (WHERE readable) AS judge_p50,
      count(*) FILTER (WHERE readable AND judge IS NOT NULL AND hard_fails > 0)::int AS hard_failed,
      count(*) FILTER (WHERE readable AND fabricated)::int AS fabricated,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY visible_s) FILTER (WHERE readable) AS visible_p50,
      percentile_cont(0.9) WITHIN GROUP (ORDER BY visible_s) FILTER (WHERE readable) AS visible_p90,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY cost) AS cost_p50,
      percentile_cont(0.9) WITHIN GROUP (ORDER BY cost) AS cost_p90,
      avg(evaluator - judge) FILTER (WHERE readable AND evaluator IS NOT NULL AND judge IS NOT NULL) AS eval_gap,
      avg(ceiling - cost) FILTER (WHERE ceiling IS NOT NULL AND cost IS NOT NULL) AS saved_mean,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY revisions) AS revisions_p50,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY steps) AS steps_p50,
      count(*) FILTER (WHERE NOT risk)::int AS no_risk_runs,
      count(*) FILTER (WHERE NOT risk AND readable AND visible_s <= 600)::int AS within_10,
      count(*) FILTER (WHERE readable AND "finishedAt" <= now() - interval '24 hours')::int AS due_24h,
      count(*) FILTER (WHERE readable AND "finishedAt" <= now() - interval '24 hours'
                         AND opened_at IS NOT NULL AND opened_at <= "finishedAt" + interval '24 hours')::int AS opened_24h,
      count(*) FILTER (WHERE readable AND opened_at IS NOT NULL)::int AS opened,
      count(*) FILTER (WHERE readable AND opened_at IS NOT NULL AND read_through)::int AS read_through,
      count(*) FILTER (WHERE readable AND opened_at IS NOT NULL AND has_practise)::int AS opened_with_practise,
      count(*) FILTER (WHERE readable AND opened_at IS NOT NULL AND has_practise AND practise_click)::int AS practise_clicks,
      count(*) FILTER (WHERE readable AND opened_at IS NOT NULL AND reflected)::int AS reflected,
      count(*) FILTER (WHERE readable AND opened_at IS NOT NULL AND listened)::int AS listened,
      count(*) FILTER (WHERE readable AND opened_at IS NOT NULL AND replied)::int AS replied,
      count(*) FILTER (WHERE waited)::int AS waited,
      count(*) FILTER (WHERE waited AND left_early)::int AS left_early,
      count(*) FILTER (WHERE readable AND thumbs_up)::int AS thumbs_up,
      count(*) FILTER (WHERE readable AND thumbs_down)::int AS thumbs_down,
      sum(flags_due)::int AS flags_due,
      sum(flags_on_time)::int AS flags_on_time`;

  private weekly(weeks: number, slaHours: number): Promise<any[]> {
    return this.dataSource.query(`
      ${this.runFacts(weeks, slaHours)},
      wk AS (SELECT generate_series(
               date_trunc('week', now()) - make_interval(weeks => ${weeks - 1}),
               date_trunc('week', now()), interval '1 week') AS week)
      SELECT wk.week, ${DebriefMetricsService.AGGREGATES}
        FROM wk LEFT JOIN facts ON date_trunc('week', facts."createdAt") = wk.week
       GROUP BY wk.week ORDER BY wk.week`);
  }

  /**
   * The pass rate — the same definition the paired eval reports
   * (`debriefOutcome`) — per week, per language and per language × writer
   * model × judge version, beside the PRD metrics above. Computed in code from
   * each live run so the eval and the Console can never define it twice.
   */
  private async quality(weeks: number) {
    const rows: Array<Record<string, any>> = await this.dataSource.query(`
      SELECT date_trunc('week', r."createdAt") AS week, r.status, r.language,
             (r.cards IS NOT NULL) AS has_cards, r."checkFailures" AS check_failures,
             r.steps, r.workspace->'judge' AS judge
        FROM debrief_runs r
       WHERE r.mode = 'live'
         AND r."createdAt" >= date_trunc('week', now()) - make_interval(weeks => ${weeks - 1})`);
    const runs: RolledRun[] = rows.map((r) => ({
      week: new Date(r.week).toISOString().slice(0, 10),
      language: r.language ?? null,
      status: r.status,
      cards: r.has_cards ? {} : null,
      checkFailures: Array.isArray(r.check_failures) ? r.check_failures : [],
      steps: Array.isArray(r.steps) ? r.steps : [],
      workspace: r.judge ? { judge: r.judge } : {},
    }));
    return passRollup(runs);
  }

  /** Experience over the whole window, per language or per device (v9 §3.3). */
  private async breakdown(
    weeks: number,
    slaHours: number,
    by: 'language' | 'platform',
  ): Promise<
    Array<{ key: string; debriefs: number; experience: ExperienceRates }>
  > {
    const col =
      by === 'language' ? `COALESCE(language, 'unknown')` : 'platform';
    const rows: any[] = await this.dataSource.query(`
      ${this.runFacts(weeks, slaHours)}
      SELECT ${col} AS key, ${DebriefMetricsService.AGGREGATES}
        FROM facts GROUP BY 1 ORDER BY count(*) DESC LIMIT 20`);
    return rows.map((r) => ({
      key: String(r.key),
      debriefs: num(r.debriefs),
      experience: experience(r),
    }));
  }

  /**
   * The guardrails' two baselines (PRD §4): today's debrief's hard-fail rate
   * under the same judge, and its thumbs-down rate, both over the 28 days
   * before the first organisation was switched on (or the last 28 days when
   * none is).
   */
  private async baselines() {
    const [first] = await this.dataSource.query(
      `SELECT min("createdAt") AS at FROM debrief_runs WHERE mode = 'live'`,
    );
    const until = first?.at ? new Date(first.at) : new Date();
    const [hf] = await this.dataSource.query(
      `SELECT count(*)::int AS n,
              count(*) FILTER (WHERE jsonb_array_length(COALESCE("hardFails", '[]'::jsonb)) > 0)::int AS failed
         FROM debrief_quality_judgment
        WHERE "createdAt" >= $1::timestamp - interval '28 days' AND "createdAt" < $1::timestamp`,
      [until.toISOString()],
    );
    const [th] = await this.dataSource.query(
      `SELECT count(*) FILTER (WHERE rating = 'positive')::int AS up,
              count(*) FILTER (WHERE rating = 'negative')::int AS down
         FROM debrief_feedback
        WHERE "deletedAt" IS NULL
          AND "createdAt" >= $1::timestamp - interval '28 days' AND "createdAt" < $1::timestamp`,
      [until.toISOString()],
    );
    return {
      from: new Date(until.getTime() - 28 * 86_400_000).toISOString(),
      until: until.toISOString(),
      legacyHardFailRate: rate(num(hf?.failed), num(hf?.n)),
      legacyThumbsDownRate: rate(num(th?.down), num(th?.up) + num(th?.down)),
    };
  }

  /** The north star, per calendar month over the last `months` (v9 §3.3). */
  private async uptakeByMonth(
    months: number,
  ): Promise<Array<{ month: string } & UptakeResult>> {
    const rows: any[] = await this.dataSource.query(
      `SELECT s."counselorId" AS learner, s."endedAt" AS at,
              r.workspace->'evidence'->'behaviours' AS behaviours,
              r.cards->'work_on_this' AS work
         FROM debrief_runs r
         JOIN scenario_sessions s ON s.id = r."scenarioSessionId"
        WHERE ${READABLE}
          AND s."endedAt" >= date_trunc('month', now()) - make_interval(months => $1)`,
      [months - 1],
    );
    const runs: Array<UptakeRun & { month: string }> = rows
      .filter((r) => r.at)
      .map((r) => ({
        learnerId: Number(r.learner),
        at: new Date(r.at),
        month: new Date(r.at).toISOString().slice(0, 7),
        behaviours: Array.isArray(r.behaviours) ? r.behaviours : [],
        targeted: Array.isArray(r.work)
          ? r.work
              .map((c: { skill?: string }) => c?.skill ?? '')
              .filter(Boolean)
          : [],
      }));
    // Each learner's consecutive debriefed sessions, as a pair counted in
    // the month its first session is in (the second may fall in the next).
    const byLearner = new Map<number, typeof runs>();
    for (const r of runs) {
      const l = byLearner.get(r.learnerId) ?? [];
      l.push(r);
      byLearner.set(r.learnerId, l);
    }
    const pairsByMonth = new Map<string, UptakeRun[]>();
    let id = 0;
    for (const list of byLearner.values()) {
      list.sort((a, b) => a.at.getTime() - b.at.getTime());
      for (let i = 0; i + 1 < list.length; i++) {
        const pair = pairsByMonth.get(list[i].month) ?? [];
        id -= 1;
        // Its own two-run history, so pairs never chain across months.
        pair.push(
          { ...list[i], learnerId: id },
          { ...list[i + 1], learnerId: id },
        );
        pairsByMonth.set(list[i].month, pair);
      }
    }
    const out: Array<{ month: string } & UptakeResult> = [];
    const now = new Date();
    for (let i = months - 1; i >= 0; i--) {
      const month = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1),
      )
        .toISOString()
        .slice(0, 7);
      out.push({ month, ...uptakeLift(pairsByMonth.get(month) ?? []) });
    }
    return out;
  }

  /**
   * The safety-recall gate is an offline eval (`ally-ai/scripts/debrief_safety_recall.py`),
   * not a production number. Nothing records its runs yet, so the Console says so.
   */
  private async latestSafetyRecall() {
    return { recorded: false as const };
  }
}

function experience(r: any): ExperienceRates {
  return {
    openedWithin24h: rate(num(r.opened_24h), num(r.due_24h)),
    readThrough: rate(num(r.read_through), num(r.opened)),
    practiseClickThrough: rate(
      num(r.practise_clicks),
      num(r.opened_with_practise),
    ),
    reflectionAnswered: rate(num(r.reflected), num(r.opened)),
    abandonedBeforeReady: rate(num(r.left_early), num(r.waited)),
    flagsWithinSla: rate(num(r.flags_on_time), num(r.flags_due)),
    listened: rate(num(r.listened), num(r.opened)),
    replied: rate(num(r.replied), num(r.opened)),
  };
}

const num = (x: unknown): number => {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
};
const opt = (x: unknown): number | null => {
  if (x == null) return null;
  const n = Number(x);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
};
