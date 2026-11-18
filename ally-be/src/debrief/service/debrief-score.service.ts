import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AgentReleaseService } from '../../llm-agent/harness/release/agent-release.service';
import {
  DEBRIEF_AGENT_KEY,
  DEBRIEF_SESSION_BUDGET_DEFAULT,
} from '../constants/debrief-release.constants';
import { DEBRIEF_QUALITY_DIMENSIONS } from '../../analytics/constants/debrief-quality.constants';
import { debriefOutcome } from '../util/debrief-outcome.util';
import {
  GateRun,
  mondays,
  QualityBreakdown,
  qualityBreakdown,
  RollingPoint,
  rollingSeries,
  ROLLING_WEEKS,
  SCORE_MEASURE_LABELS,
  SCORE_MEASURES,
  ScoreFacts,
  ScoreGates,
  scoreGates,
  ScoreMeasure,
  ScoreRun,
  scoreWeightsOf,
  ScoreWeights,
  sliceFacts,
  sliceScore,
  trendOf,
} from '../util/debrief-score.util';
import { DebriefSettingsService } from './debrief-settings.service';

/** A live run as the score, the gates and the watch read it. */
export interface ScoredRun extends ScoreRun, GateRun {
  id: string;
  createdAt: Date;
  /** Monday of the run's week (YYYY-MM-DD). */
  week: string;
  language: string;
  recipe: string;
  releaseId: string | null;
}

/** `GET metrics/score` (Debrief v2 S3). */
export interface DebriefScoreView {
  current: number | null;
  previous: number | null;
  debriefs: number;
  byWeek: Array<{ week: string; score: number | null; n: number }>;
  markers: Array<{
    week: string;
    kind: 'live' | 'undone';
    changeId: string;
    title: string;
  }>;
  measures: Array<{
    key: ScoreMeasure;
    label: string;
    weight: number;
    value: number | null;
    display: string;
    trend: string;
    tone: 'up' | 'down' | 'flat';
  }>;
  gates: Array<{
    key: 'risk' | 'cost';
    label: string;
    ok: boolean;
    display: string;
  }>;
  byLanguage: Array<{ language: string; score: number | null; n: number }>;
  /** The improvement chart: one point a week, each over the four weeks ending then. */
  rolling: RollingPoint[];
  /** The quality score in detail over the last four weeks, against the four before. */
  quality: QualityBreakdown;
}

const DAY_MS = 86_400_000;

/**
 * The cumulative score over live debriefs (S1–S3): per run, per slice
 * (week × language × recipe × release), the two gates, and the Analytics
 * view. Reads only; no model call.
 */
/** The fewest debriefs each week needs before the two weeks are compared. */
export const SCORE_COMPARE_MIN_DEBRIEFS = 20;

@Injectable()
export class DebriefScoreService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly settings: DebriefSettingsService,
    private readonly releases: AgentReleaseService,
  ) {}

  async weights(): Promise<ScoreWeights> {
    return scoreWeightsOf(await this.settings.get());
  }

  /** The live release's session budget (the cost gate's limit). */
  async sessionBudgetUsd(): Promise<number> {
    const ga = await this.releases.getGa(DEBRIEF_AGENT_KEY).catch(() => null);
    const v = Number(
      (ga?.bundle as { settings?: { sessionBudgetUsd?: number } } | undefined)
        ?.settings?.sessionBudgetUsd,
    );
    return Number.isFinite(v) && v > 0 ? v : DEBRIEF_SESSION_BUDGET_DEFAULT;
  }

  /**
   * Live debriefs (skipped ones excluded) created in [from, to), optionally
   * on one release only. Each carries what the score and the gates read.
   */
  async runs(
    from: Date,
    to: Date | null = null,
    releaseId: string | null = null,
  ): Promise<ScoredRun[]> {
    const rows: Array<Record<string, any>> = await this.dataSource.query(
      `SELECT r.id, r."createdAt", r.status, r."releaseId",
              to_char(date_trunc('week', r."createdAt"), 'YYYY-MM-DD') AS week,
              COALESCE(r.language, 'unknown') AS language,
              COALESCE(r."recipeKey", 'standard') AS recipe,
              (r.cards IS NOT NULL) AS has_cards,
              r."checkFailures" AS check_failures,
              (r.workspace ? 'judge') AS judged,
              (r.workspace->'judge'->>'overall')::float AS quality,
              r.workspace->'judge'->'dimensions' AS dims,
              COALESCE(r.workspace->'judge'->'hardFails', '[]'::jsonb) AS hard_fails,
              (r.status IN ('published','below_bar')) AS shown,
              r.workspace->'safety'->'risk_cues' AS risk_cues,
              r.workspace->'riskCueOption'->>'handling' AS risk_handling,
              r.cards->'important_moment' AS important_moment,
              COALESCE(r."actualCostUsd", r."estimatedCostUsd")::float
                + COALESCE((r.workspace->>'askAllySpentUsd')::float, 0) AS session_cost,
              h.up, h.down,
              EXISTS (SELECT 1 FROM debrief_run_feedback f
                       WHERE f."runId" = r.id AND f.kind = 'flag' AND f.status <> 'withdrawn') AS flagged
         FROM debrief_runs r
         LEFT JOIN LATERAL (
           SELECT bool_or(f.helpful) AS up, bool_or(NOT f.helpful) AS down
             FROM debrief_run_feedback f
            WHERE f."runId" = r.id AND f.kind = 'helpful') h ON true
        WHERE r.mode = 'live' AND r.status <> 'skipped'
          AND r."createdAt" >= $1
          AND ($2::timestamp IS NULL OR r."createdAt" < $2::timestamp)
          AND ($3::uuid IS NULL OR r."releaseId" = $3::uuid)
        ORDER BY r."createdAt"`,
      [from.toISOString(), to ? to.toISOString() : null, releaseId],
    );
    return rows.map(toScoredRun);
  }

  /** The two gates over these runs, against a comparison (S2). */
  async gates(runs: GateRun[], before: GateRun[] | null): Promise<ScoreGates> {
    return scoreGates(runs, before, await this.sessionBudgetUsd());
  }

  /** `GET metrics/score?days=56`. */
  async view(days = 56, now = new Date()): Promise<DebriefScoreView> {
    const d = Math.max(14, Math.min(365, Math.round(days)));
    const w = await this.weights();
    const from = new Date(now.getTime() - d * DAY_MS);
    // The chart's first point reads the three weeks before the range too.
    const lead = (ROLLING_WEEKS - 1) * 7 + 7;
    const allRuns = await this.runs(new Date(from.getTime() - lead * DAY_MS));
    const runs = allRuns.filter((r) => r.createdAt >= from);
    const window = ROLLING_WEEKS * 7 * DAY_MS;
    const lastWindow = allRuns.filter(
      (r) => r.createdAt.getTime() >= now.getTime() - window,
    );
    const windowBefore = allRuns.filter(
      (r) =>
        r.createdAt.getTime() >= now.getTime() - 2 * window &&
        r.createdAt.getTime() < now.getTime() - window,
    );
    const weekAgo = now.getTime() - 7 * DAY_MS;
    const twoWeeksAgo = now.getTime() - 14 * DAY_MS;
    const thisWeek = runs.filter((r) => r.createdAt.getTime() >= weekAgo);
    const lastWeek = runs.filter(
      (r) =>
        r.createdAt.getTime() >= twoWeeksAgo && r.createdAt.getTime() < weekAgo,
    );
    const weeks = new Map<string, ScoredRun[]>();
    for (const r of runs) weeks.set(r.week, [...(weeks.get(r.week) ?? []), r]);
    const languages = new Map<string, ScoredRun[]>();
    for (const r of thisWeek) {
      languages.set(r.language, [...(languages.get(r.language) ?? []), r]);
    }
    const now7 = sliceFacts(thisWeek);
    const before7 = sliceFacts(lastWeek);
    const gates = await this.gates(thisWeek, lastWeek);
    return {
      current: sliceScore(thisWeek, w),
      // A week of a handful of debriefs is not a comparison (prod 2026-11-16:
      // 2 debriefs last week against 56 this week read as "fell 1.0").
      previous:
        lastWeek.length >= SCORE_COMPARE_MIN_DEBRIEFS &&
        thisWeek.length >= SCORE_COMPARE_MIN_DEBRIEFS
          ? sliceScore(lastWeek, w)
          : null,
      debriefs: thisWeek.length,
      byWeek: [...weeks.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([week, rs]) => ({
          week,
          score: sliceScore(rs, w),
          n: rs.length,
        })),
      markers: await this.markers(new Date(now.getTime() - d * DAY_MS)),
      measures: SCORE_MEASURES.map((key) =>
        measureRow(key, w[key], now7, before7),
      ),
      gates: gateRows(gates),
      byLanguage: [...languages.entries()]
        .map(([language, rs]) => ({
          language,
          score: sliceScore(rs, w),
          n: rs.length,
        }))
        .sort((a, b) => b.n - a.n),
      rolling: rollingSeries(allRuns, mondays(weekOf(from), weekOf(now)), w),
      quality: qualityBreakdown(
        lastWindow,
        windowBefore,
        DEBRIEF_QUALITY_DIMENSIONS,
        SCORE_COMPARE_MIN_DEBRIEFS,
      ),
    };
  }

  /** Changes that went live or were undone since `from`, by the week it happened. */
  private async markers(from: Date): Promise<DebriefScoreView['markers']> {
    const rows: Array<{
      id: string;
      title: string;
      live_at: string | null;
      undone_at: string | null;
    }> = await this.dataSource.query(
      `SELECT id, text AS title,
              evidence->'watch'->>'liveAt' AS live_at,
              evidence->'undo'->>'at' AS undone_at
         FROM agent_lessons
        WHERE "agentKey" = $1
          AND (COALESCE((evidence->'watch'->>'liveAt')::timestamptz, 'epoch') >= $2
               OR COALESCE((evidence->'undo'->>'at')::timestamptz, 'epoch') >= $2)`,
      [DEBRIEF_AGENT_KEY, from.toISOString()],
    );
    const out: DebriefScoreView['markers'] = [];
    for (const r of rows) {
      if (r.live_at && new Date(r.live_at) >= from) {
        out.push({
          week: weekOf(r.live_at),
          kind: 'live',
          changeId: r.id,
          title: r.title,
        });
      }
      if (r.undone_at && new Date(r.undone_at) >= from) {
        out.push({
          week: weekOf(r.undone_at),
          kind: 'undone',
          changeId: r.id,
          title: r.title,
        });
      }
    }
    return out.sort((a, b) => a.week.localeCompare(b.week));
  }
}

/** One row of the query as a scored run. */
export function toScoredRun(r: Record<string, any>): ScoredRun {
  const hardFails = Array.isArray(r.hard_fails) ? r.hard_fails : [];
  const outcome = debriefOutcome({
    status: r.status,
    cards: r.has_cards ? {} : null,
    checkFailures: Array.isArray(r.check_failures) ? r.check_failures : [],
    workspace: r.judged ? { judge: { hardFails } } : {},
  });
  const quality = r.quality == null ? null : Number(r.quality);
  const cost = r.session_cost == null ? null : Number(r.session_cost);
  return {
    id: r.id,
    createdAt: new Date(r.createdAt),
    week: r.week,
    language: r.language ?? 'unknown',
    recipe: r.recipe ?? 'standard',
    releaseId: r.releaseId ?? null,
    quality: Number.isFinite(quality as number) ? quality : null,
    pass: outcome.pass,
    helpful: r.up ? true : r.down ? false : null,
    flagged: !!r.flagged,
    dims: dimsOf(r.dims),
    missedClearRiskCue:
      !!r.shown &&
      // A roleplay that assesses risk cues as its practice has no important moment to cover them:
      // only the judge's own missed clear cue counts there.
      (uncoveredClearCue(
        r.risk_cues,
        r.important_moment,
        r.risk_handling === 'assessed',
      ) ||
        hardFails.some(
          (h: { code?: string }) => h?.code === 'missed_risk_cue',
        )),
    sessionCostUsd: Number.isFinite(cost as number) ? cost : null,
  };
}

/**
 * Whether the learner was shown a debrief that left out a clear risk cue: a
 * cue the safety reading rated clear (a cue with no strength counts as clear,
 * as in ally-ai's cue_strength) whose turn the important moment does not
 * cover, neither as its own turn nor among its `others`. Possible cues never
 * count. (Before 2026-11-17 the gate read the Evaluator's `reviewReason`,
 * which on older releases flagged possible cues too: three false alarms.)
 */
export function uncoveredClearCue(
  cues: unknown,
  moment: unknown,
  /** The roleplay assesses cues as part of the practice: a cue the reader marked so needs no moment. */
  assessed = false,
): boolean {
  if (!Array.isArray(cues)) return false;
  const m = (moment ?? null) as {
    turn_index?: unknown;
    others?: Array<{ turn_index?: unknown }>;
  } | null;
  const covered = new Set<number>();
  if (m && Number.isInteger(Number(m.turn_index)) && m.turn_index != null) {
    covered.add(Number(m.turn_index));
  }
  for (const o of Array.isArray(m?.others) ? m.others : []) {
    if (o?.turn_index != null && Number.isInteger(Number(o.turn_index))) {
      covered.add(Number(o.turn_index));
    }
  }
  return (
    cues as Array<{
      strength?: unknown;
      turn_index?: unknown;
      part_of_practice?: unknown;
    }>
  ).some(
    (c) =>
      c?.strength !== 'possible' &&
      !(assessed && c?.part_of_practice === true) &&
      c?.turn_index != null &&
      Number.isInteger(Number(c.turn_index)) &&
      !covered.has(Number(c.turn_index)),
  );
}

/** The judge's `[{dimension, score}]` as a map; null when not judged. */
export function dimsOf(v: unknown): Record<string, number> | null {
  if (!Array.isArray(v)) return null;
  const out: Record<string, number> = {};
  for (const x of v as Array<{ dimension?: unknown; score?: unknown }>) {
    const n = Number(x?.score);
    if (typeof x?.dimension === 'string' && Number.isFinite(n)) {
      out[x.dimension] = n;
    }
  }
  return Object.keys(out).length ? out : null;
}

/** Monday of the date's week (UTC, as Postgres' date_trunc('week') gives it). */
export function weekOf(iso: string | Date): string {
  const d = new Date(iso);
  const day = (d.getUTCDay() + 6) % 7;
  const monday = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day),
  );
  return monday.toISOString().slice(0, 10);
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** One measure's row: this week's value, against the week before. */
export function measureRow(
  key: ScoreMeasure,
  weight: number,
  now: ScoreFacts,
  before: ScoreFacts,
): DebriefScoreView['measures'][number] {
  const v = now[key];
  const b = before[key];
  const display =
    v == null
      ? 'No data yet'
      : key === 'quality'
        ? `${(Math.round(v * 10) / 10).toFixed(1)} / 10`
        : pct(v);
  const t =
    key === 'quality'
      ? trendOf(v, b, true, 0.05)
      : trendOf(
          v == null ? null : Math.round(v * 1000) / 10,
          b == null ? null : Math.round(b * 1000) / 10,
          key !== 'flags',
          1,
        );
  return {
    key,
    label: SCORE_MEASURE_LABELS[key],
    weight,
    value: v == null ? null : Math.round(v * 1000) / 1000,
    display,
    trend:
      key === 'quality' ||
      t.trend === 'no comparison yet' ||
      t.trend === 'about the same'
        ? t.trend
        : `${t.trend}%`,
    tone: t.tone,
  };
}

/** The gates in the owner's words. */
export function gateRows(g: ScoreGates): DebriefScoreView['gates'] {
  return [
    {
      key: 'risk',
      label: 'No missed clear risk cue',
      ok: g.risk.ok,
      display:
        g.risk.missed === 0
          ? 'None this week'
          : `${g.risk.missed} debrief${g.risk.missed === 1 ? '' : 's'} missed a clear risk cue this week${g.risk.before ? ` (${g.risk.before} the week before)` : ''}`,
    },
    {
      key: 'cost',
      label: 'Within the session budget',
      ok: g.cost.ok,
      display:
        g.cost.p90Usd == null
          ? 'No sessions this week'
          : `$${g.cost.p90Usd.toFixed(2)} a session (9 in 10 cost less), budget $${g.cost.budgetUsd.toFixed(2)}`,
    },
  ];
}
