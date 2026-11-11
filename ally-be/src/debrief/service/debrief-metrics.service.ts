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
import {
  askAllyReplyOutcome,
  passRollup,
  pmIdeaOutcome,
  RolledRun,
} from '../util/debrief-outcome.util';
import { stageMetrics, StageRun } from '../util/debrief-stage-metrics.util';
import { CHECK_FALLBACK } from '../constants/debrief-reply.constants';
import {
  MetricsFilter,
  cardSkillsSql,
  metricsFilterSql,
  pageFilter,
  SESSION_LENGTH_BANDS,
} from '../util/debrief-metrics-filter.util';
import { lengthBand } from '../util/debrief-metrics.util';
import { computeCostUsd } from '../../analytics/constants/llm-pricing.constants';

/** PRD: an Ask Ally reply costs at most this much. */
export const ASK_ALLY_COST_TARGET_USD = 0.05;
import { cardSkills, DebriefCards } from '../util/debrief-cards.util';

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

  async view(weeks = 12, filter: MetricsFilter = {}) {
    // Page-wide filters narrow every live metric; the pass-rate segments (skill, scenario, course,
    // session length, step model, risk) narrow only the pass rate, where the Analytics tab puts them.
    const fsql = metricsFilterSql(pageFilter(filter));
    const qsql = metricsFilterSql(filter);
    const w = Math.max(4, Math.min(52, Math.round(weeks)));
    const s = await this.settings.get();
    const weights = {
      judge: s.steeringWeightJudge,
      practise: s.steeringWeightPractise,
      thumbs: s.steeringWeightThumbs,
    };
    const rows = await this.weekly(w, s.flagReviewSlaHours, fsql);
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
    const [
      byLanguage,
      byPlatform,
      baselines,
      uptake,
      safety,
      quality,
      qualityAll,
      stages,
      askAlly,
      pmAgent,
    ] = await Promise.all([
      this.breakdown(w, s.flagReviewSlaHours, 'language', fsql),
      this.breakdown(w, s.flagReviewSlaHours, 'platform', fsql),
      this.baselines(),
      this.uptakeByMonth(6),
      this.latestSafetyRecall(),
      this.quality(w, qsql),
      // With a pass-rate segment set, the headline tiles still read the whole (page-filtered) pass rate.
      qsql === fsql ? Promise.resolve(null) : this.quality(w, fsql),
      this.stages(w, fsql),
      this.askAlly(w, fsql),
      this.pmAgent(),
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
      /** The pass rate without the segment filters; present only when one is set. */
      ...(qualityAll ? { qualityAll } : {}),
      agents: { stages, askAlly, pmAgent },
      filter,
      /** Read across all organisations and versions whatever the filter says. */
      unfiltered: ['baselines', 'uptake', 'pmAgent'],
      filterOptions: await this.filterOptions(w),
      generatedAt: new Date().toISOString(),
    };
  }

  /** Every per-run fact the weekly series and breakdowns are built from. */
  private runFacts(weeks: number, slaHours: number, fsql = '') {
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
          LEFT JOIN users u ON u.id = s."counselorId"
         WHERE r.mode = 'live' AND r.status <> 'skipped'${fsql}
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

  private weekly(weeks: number, slaHours: number, fsql = ''): Promise<any[]> {
    return this.dataSource.query(`
      ${this.runFacts(weeks, slaHours, fsql)},
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
  private async quality(weeks: number, fsql = '') {
    const rows: Array<Record<string, any>> = await this.dataSource.query(`
      SELECT date_trunc('week', r."createdAt") AS week, r.status, r.language,
             r.cards, r."checkFailures" AS check_failures,
             r.steps, r.workspace->'judge' AS judge,
             r."learnerTurns" AS learner_turns, r."hasRiskCue" AS risk,
             sc.title AS scenario,
             (SELECT array_agg(DISTINCT t.title) FROM track_items ti JOIN tracks t ON t.id = ti."trackId"
               WHERE ti."scenarioId" = s."scenarioId") AS courses
        FROM debrief_runs r
        JOIN scenario_sessions s ON s.id = r."scenarioSessionId"
        LEFT JOIN users u ON u.id = s."counselorId"
        LEFT JOIN scenarios sc ON sc.id = s."scenarioId"
       WHERE r.mode = 'live'
         AND r."createdAt" >= date_trunc('week', now()) - make_interval(weeks => ${weeks - 1})${fsql}`);
    const runs: RolledRun[] = rows.map((r) => ({
      week: new Date(r.week).toISOString().slice(0, 10),
      language: r.language ?? null,
      status: r.status,
      cards: r.cards ?? null,
      checkFailures: Array.isArray(r.check_failures) ? r.check_failures : [],
      steps: Array.isArray(r.steps) ? r.steps : [],
      workspace: r.judge ? { judge: r.judge } : {},
      skills: [...new Set(cardSkills(r.cards as DebriefCards | null))],
      scenario: r.scenario ?? null,
      courses: Array.isArray(r.courses) ? r.courses.filter(Boolean) : [],
      learnerTurns:
        r.learner_turns == null ? undefined : Number(r.learner_turns),
      hasRiskCue: r.risk == null ? undefined : !!r.risk,
    }));
    return passRollup(runs, lengthBand);
  }

  /** Each agent inside a live debrief run, from its step trail (see debrief-stage-metrics.util). */
  private async stages(weeks: number, fsql = '') {
    const rows: Array<Record<string, any>> = await this.dataSource.query(`
      SELECT r.status, r."hasRiskCue" AS risk, r."skipReason" AS skip_reason,
             (r.cards IS NOT NULL) AS has_cards, r."checkFailures" AS check_failures,
             r."evaluatorHardFails" AS evaluator_hard_fails, r.steps,
             r.workspace->'judge' AS judge,
             lower(u.metadata->>'workerType') AS learner_level,
             (SELECT jsonb_agg(jsonb_build_object(
                       'kind', c.facets->>'kind', 'level', c.facets->'level',
                       'clinical', COALESCE((c.attributes->>'clinical')::boolean, false)))
                FROM jsonb_array_elements_text(COALESCE(r.workspace->'passages', '[]'::jsonb)) pid
                JOIN cl_chunks c ON c.id::text = pid) AS passages,
             -- The orchestrator's records, only for runs that planned.
             r.workspace->'plans' AS plans,
             CASE WHEN r.workspace ? 'plans' THEN r.workspace->'findings' END AS findings,
             CASE WHEN r.workspace ? 'plans' THEN r.cards END AS plan_cards,
             EXISTS (SELECT 1 FROM debrief_reviews v WHERE v."runId" = r.id) AS reviewed,
             (SELECT jsonb_agg(h) FROM debrief_reviews v,
                     jsonb_array_elements_text(COALESCE(v."hardFails", '[]'::jsonb)) h
               WHERE v."runId" = r.id) AS review_hard_fails,
             (SELECT jsonb_agg(c.tag) FROM debrief_review_comments c
               WHERE c."runId" = r.id AND c."parentId" IS NULL AND c.tag IS NOT NULL) AS review_tags
        FROM debrief_runs r
        JOIN scenario_sessions s ON s.id = r."scenarioSessionId"
        LEFT JOIN users u ON u.id = s."counselorId"
       WHERE r.mode = 'live'
         AND r."createdAt" >= date_trunc('week', now()) - make_interval(weeks => ${weeks - 1})${fsql}`);
    const runs: StageRun[] = rows.map((r) => ({
      status: r.status,
      cards: r.plan_cards ?? (r.has_cards ? {} : null),
      hasRiskCue: !!r.risk,
      skipReason: r.skip_reason,
      checkFailures: Array.isArray(r.check_failures) ? r.check_failures : [],
      evaluatorHardFails: Array.isArray(r.evaluator_hard_fails)
        ? r.evaluator_hard_fails
        : [],
      steps: Array.isArray(r.steps) ? r.steps : [],
      workspace: {
        ...(r.judge ? { judge: r.judge } : {}),
        ...(Array.isArray(r.plans) ? { plans: r.plans } : {}),
        ...(r.findings ? { findings: r.findings } : {}),
      },
      reviewed: !!r.reviewed,
      reviewHardFails: Array.isArray(r.review_hard_fails)
        ? r.review_hard_fails
        : [],
      reviewTags: Array.isArray(r.review_tags) ? r.review_tags : [],
      passages: Array.isArray(r.passages)
        ? r.passages.map((p: any) => ({
            kind: p.kind,
            level: Array.isArray(p.level) ? p.level : null,
            clinical: !!p.clinical,
          }))
        : [],
      learnerLevel: r.learner_level ?? null,
    }));
    return stageMetrics(runs);
  }

  /**
   * Ask Ally: replies to learners on live debriefs. A reply a code check
   * replaced reached the learner as the fallback, so it fails; a clean reply
   * has no verdict until an Ask Ally judge exists (askAllyReplyOutcome).
   */
  private async askAlly(weeks: number, fsql = '') {
    const [r] = await this.dataSource.query(
      `WITH runs AS (
         SELECT r.id, r."scenarioSessionId" AS session_id
           FROM debrief_runs r
           JOIN scenario_sessions s ON s.id = r."scenarioSessionId"
           LEFT JOIN users u ON u.id = s."counselorId"
          WHERE r.mode = 'live'${fsql}
       ),
       chats AS (
         SELECT c.id FROM scenario_session_chats c
          WHERE c."scenarioSessionId" IN (SELECT session_id FROM runs)
       ),
       msgs AS (
         SELECT m."senderId" AS sender, m.content
           FROM scenario_session_chat_messages m JOIN chats ON chats.id = m."chatId"
          WHERE m."createdAt" >= date_trunc('week', now()) - make_interval(weeks => $2)
       )
       SELECT count(*) FILTER (WHERE sender = -1)::int AS replies,
              count(*) FILTER (WHERE sender = -1 AND left(content, length($1)) = $1)::int AS replaced,
              count(*) FILTER (WHERE sender <> -1)::int AS questions,
              (SELECT count(*)::int FROM debrief_run_feedback f
                WHERE f.section = 'ask_ally' AND f.kind = 'flag'
                  AND f."runId" IN (SELECT id FROM runs)
                  AND f."createdAt" >= date_trunc('week', now()) - make_interval(weeks => $2)) AS distress_flags,
              (SELECT count(*)::int FROM llm_usage u WHERE u.task = 'debrief_reply'
                  AND u."scenarioSessionId" IN (SELECT session_id FROM runs)
                  AND u."createdAt" >= date_trunc('week', now()) - make_interval(weeks => $2)) AS calls
         FROM msgs`,
      [CHECK_FALLBACK, weeks - 1],
    );
    const replies = num(r?.replies);
    const replaced = num(r?.replaced);
    const outcomes = [
      ...Array.from({ length: replaced }, () =>
        askAllyReplyOutcome({ checkFailures: ['replaced'] }),
      ),
      ...Array.from({ length: replies - replaced }, () =>
        askAllyReplyOutcome({ checkFailures: [] }),
      ),
    ];
    // Only replaced replies get a verdict today, and they all fail, so a rate over the scored
    // ones alone reads 0%. Report it only when every reply has a verdict.
    const unscored = outcomes.some((o) => o.pass === null);
    return {
      replies,
      questions: num(r?.questions),
      checkPassRate: rate(replies - replaced, replies),
      /** Null until every reply has a verdict (needs the Ask Ally judge): only the checks can be read today. */
      passRate:
        outcomes.length && !unscored
          ? rate(outcomes.filter((o) => o.pass).length, outcomes.length)
          : null,
      distressFlags: num(r?.distress_flags),
      modelCalls: num(r?.calls),
      ...(await this.askAllyCost(weeks, fsql, replies)),
    };
  }

  /**
   * What a reply costs (PRD: at most $0.05): the window's Ask Ally model spend on the same live
   * debriefs, priced from tokens like the learning budget, over the replies sent. Replaced replies
   * count too: they cost a call as well. Null with no replies.
   */
  private async askAllyCost(weeks: number, fsql: string, replies: number) {
    const usage: Array<{ model: string; p: number; c: number }> =
      await this.dataSource.query(
        `SELECT lu.model, sum(lu."promptTokens")::bigint AS p, sum(lu."completionTokens")::bigint AS c
           FROM llm_usage lu
          WHERE lu.task = 'debrief_reply'
            AND lu."createdAt" >= date_trunc('week', now()) - make_interval(weeks => $1)
            AND lu."scenarioSessionId" IN (
              SELECT r."scenarioSessionId" FROM debrief_runs r
                JOIN scenario_sessions s ON s.id = r."scenarioSessionId"
                LEFT JOIN users u ON u.id = s."counselorId"
               WHERE r.mode = 'live'${fsql})
          GROUP BY lu.model`,
        [weeks - 1],
      );
    const spendUsd = usage.reduce(
      (n, u) => n + computeCostUsd(u.model, Number(u.p), Number(u.c)).costUsd,
      0,
    );
    return {
      spendUsd,
      costPerReplyMean: replies > 0 ? spendUsd / replies : null,
      costPerReplyTarget: ASK_ALLY_COST_TARGET_USD,
    };
  }

  /**
   * The PM agent's ideas and where they ended (pmIdeaOutcome): live, "right"
   * is a promotion that still stands 14 days on without a revert.
   */
  private async pmAgent() {
    const rows: Array<Record<string, any>> = await this.dataSource.query(
      `SELECT l.status, l.evidence->'canary'->>'status' AS canary_status,
              rel."promotedAt" AS promoted_at,
              EXISTS (SELECT 1 FROM agent_release_audit a
                       WHERE a."releaseId" = l."releaseId"
                         AND a.action IN ('rolled_back','emergency_rollback','canary_reverted')) AS rolled_back,
              (l.evidence ? 'screen') AS screened, (l.evidence ? 'gate') AS gated
         FROM agent_lessons l
         LEFT JOIN agent_releases rel ON rel.id = l."releaseId"
        WHERE l."agentKey" = 'debrief'`,
    );
    const outcomes = rows.map((r) =>
      pmIdeaOutcome({
        status: r.status,
        canaryStatus: r.canary_status,
        rolledBack: !!r.rolled_back,
        promotedAt: r.promoted_at,
      }),
    );
    const scored = outcomes.filter((o) => o.pass !== null);
    const count = (d: string) =>
      outcomes.filter((o) => o.decision === d).length;
    return {
      ideas: rows.length,
      screened: rows.filter((r) => r.screened).length,
      gated: rows.filter((r) => r.gated).length,
      promoted: count('promoted'),
      reverted: count('reverted'),
      rejected: count('rejected'),
      pending: count('pending'),
      holdRate: rate(scored.filter((o) => o.pass).length, scored.length),
    };
  }

  /**
   * The values each filter can take in this window (live runs), so the
   * Console offers only filters that would match something.
   */
  private async filterOptions(weeks: number) {
    const since = `date_trunc('week', now()) - make_interval(weeks => ${weeks - 1})`;
    const q = (sql: string) => this.dataSource.query(sql) as Promise<any[]>;
    const live = `r.mode = 'live' AND r."createdAt" >= ${since}`;
    const [
      orgs,
      languages,
      levels,
      recipes,
      releases,
      judges,
      skills,
      scenarios,
      courses,
      stepModels,
      bands,
      risks,
    ] = await Promise.all([
      q(`SELECT r.tenant_id AS id, COALESCE(t.name, r.tenant_id) AS name, count(*)::int AS n
           FROM debrief_runs r LEFT JOIN tenants t ON t.id::text = r.tenant_id
          WHERE r.mode = 'live' AND r.tenant_id IS NOT NULL AND r."createdAt" >= ${since}
          GROUP BY 1, 2 ORDER BY n DESC`),
      q(`SELECT DISTINCT r.language AS v FROM debrief_runs r
          WHERE r.mode = 'live' AND r.language IS NOT NULL AND r."createdAt" >= ${since} ORDER BY 1`),
      q(`SELECT DISTINCT lower(COALESCE(u.metadata->>'workerType', 'LAY')) AS v
           FROM debrief_runs r JOIN scenario_sessions s ON s.id = r."scenarioSessionId"
           LEFT JOIN users u ON u.id = s."counselorId"
          WHERE r.mode = 'live' AND r."createdAt" >= ${since} ORDER BY 1`),
      q(`SELECT DISTINCT r."recipeKey" AS v FROM debrief_runs r
          WHERE r.mode = 'live' AND r."recipeKey" IS NOT NULL AND r."createdAt" >= ${since} ORDER BY 1`),
      q(`SELECT DISTINCT r."releaseVersion" AS v FROM debrief_runs r
          WHERE r.mode = 'live' AND r."releaseVersion" IS NOT NULL AND r."createdAt" >= ${since} ORDER BY 1 DESC`),
      q(`SELECT DISTINCT (r.workspace->'judge'->>'model') || '/' || COALESCE(r.workspace->'judge'->>'promptVersion', '?') AS v
           FROM debrief_runs r
          WHERE r.mode = 'live' AND r.workspace ? 'judge' AND r."createdAt" >= ${since} ORDER BY 1`),
      q(`SELECT k.sk AS v, count(DISTINCT r.id)::int AS n
             FROM debrief_runs r, LATERAL ${cardSkillsSql('r')} k
            WHERE ${live} AND k.sk IS NOT NULL AND btrim(k.sk) <> ''
            GROUP BY 1 ORDER BY n DESC, 1`),
      q(`SELECT sc.id, sc.title AS name, count(*)::int AS n
             FROM debrief_runs r JOIN scenario_sessions s ON s.id = r."scenarioSessionId"
             JOIN scenarios sc ON sc.id = s."scenarioId"
            WHERE ${live} GROUP BY 1, 2 ORDER BY n DESC, 2`),
      q(`SELECT t.id, t.title AS name, count(DISTINCT r.id)::int AS n
             FROM debrief_runs r JOIN scenario_sessions s ON s.id = r."scenarioSessionId"
             JOIN track_items ti ON ti."scenarioId" = s."scenarioId" JOIN tracks t ON t.id = ti."trackId"
            WHERE ${live} GROUP BY 1, 2 ORDER BY n DESC, 2`),
      q(`SELECT (st->>'step') || ': ' || (st->>'model') AS v, count(DISTINCT r.id)::int AS n
             FROM debrief_runs r,
                  jsonb_array_elements(CASE WHEN jsonb_typeof(r.steps) = 'array' THEN r.steps ELSE '[]'::jsonb END) st
            WHERE ${live} AND st->>'status' = 'done' AND st->>'step' IS NOT NULL AND st->>'model' IS NOT NULL
            GROUP BY 1 ORDER BY 1`),
      q(`SELECT DISTINCT r."learnerTurns"::int AS v FROM debrief_runs r
            WHERE ${live} AND r."learnerTurns" IS NOT NULL`),
      q(`SELECT DISTINCT r."hasRiskCue" AS v FROM debrief_runs r
            WHERE ${live} AND r."hasRiskCue" IS NOT NULL`),
    ]);
    const bandsSeen = new Set(
      bands.map((b) => lengthBand(Math.max(1, Number(b.v)))),
    );
    const vals = (rows: any[]) => rows.map((r) => r.v).filter((v) => v != null);
    return {
      organisations: orgs.map((o) => ({
        id: String(o.id),
        name: String(o.name),
      })),
      languages: vals(languages).map(String),
      learnerLevels: vals(levels).map(String),
      recipes: vals(recipes).map(String),
      releaseVersions: vals(releases).map(Number),
      judgeVersions: vals(judges).map(String),
      skills: vals(skills).map(String),
      scenarios: scenarios.map((x) => ({
        id: Number(x.id),
        name: String(x.name),
      })),
      courses: courses.map((x) => ({ id: Number(x.id), name: String(x.name) })),
      sessionLengths: SESSION_LENGTH_BANDS.map((b) => b.band).filter((b) =>
        bandsSeen.has(b),
      ),
      stepModels: vals(stepModels).map(String),
      risks: [
        ...(risks.some((x) => x.v === true) ? ['risk'] : []),
        ...(risks.some((x) => x.v === false) ? ['no_risk'] : []),
      ],
    };
  }

  /** Experience over the whole window, per language or per device (v9 §3.3). */
  private async breakdown(
    weeks: number,
    slaHours: number,
    by: 'language' | 'platform',
    fsql = '',
  ): Promise<
    Array<{ key: string; debriefs: number; experience: ExperienceRates }>
  > {
    const col =
      by === 'language' ? `COALESCE(language, 'unknown')` : 'platform';
    const rows: any[] = await this.dataSource.query(`
      ${this.runFacts(weeks, slaHours, fsql)}
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
