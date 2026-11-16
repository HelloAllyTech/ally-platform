import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { LoggerService } from '../../logger/logger.service';
import { scheduledTaskRegistry } from '../../scheduler/registry/scheduled-task.registry';
import { DEBRIEF_QUALITY_PASS } from '../../analytics/constants/debrief-quality.constants';
import { DebriefRun } from '../entity/debrief-run.entity';
import {
  baselineOf,
  judgeDrift,
  NightlyAlert,
  NightlyMetrics,
  nightlyAlerts,
  nightlyMetrics,
  NightlyRun,
} from '../util/debrief-nightly.util';
import { DebriefNotifier } from './debrief-notifier.service';
import { DebriefRunJudgeService } from './debrief-run-judge.service';
import { DebriefSettingsService } from './debrief-settings.service';

/** Days of earlier measures a day is compared with. */
export const NIGHTLY_BASELINE_DAYS = 14;
/** A judge-drift reading counts for the autonomy re-lock this long. */
export const JUDGE_DRIFT_FRESH_DAYS = 14;

const IST_OFFSET_MS = 330 * 60_000;

/** `YYYY-MM-DD` of the India-time day `daysAgo` days before `at`. */
export function istDay(at: Date, daysAgo = 0): string {
  return new Date(at.getTime() + IST_OFFSET_MS - daysAgo * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/** The instants an India-time day runs between, [from, to). */
export function istDayBounds(day: string): { from: Date; to: Date } {
  const from = new Date(`${day}T00:00:00+05:30`);
  return { from, to: new Date(from.getTime() + 86_400_000) };
}

/**
 * Judge drift for the autonomy re-lock, read straight from the table so the
 * autonomy service needs no dependency on this one: true when the latest
 * weekly reading (within {@link JUDGE_DRIFT_FRESH_DAYS}) was beyond the
 * owner's limit, false when within, null when there is no recent reading.
 */
export async function readJudgeDrifted(
  dataSource: DataSource,
): Promise<boolean | null> {
  const [row] = await dataSource.query(
    `SELECT alerts FROM debrief_quality_daily
      WHERE slice = 'judge_drift' AND day >= (now() AT TIME ZONE 'Asia/Kolkata')::date - $1::int
      ORDER BY day DESC LIMIT 1`,
    [JUDGE_DRIFT_FRESH_DAYS],
  );
  if (!row) return null;
  return Array.isArray(row.alerts) && row.alerts.length > 0;
}

/** Why the nightly check sent a debrief to a person, as the queue shows it. */
export type NightlyReason =
  | 'judge_human_disagree'
  | 'thumbs_down_comment'
  | 'risk_cue_disagree';

export interface NightlyDayRow {
  day: string;
  slice: string;
  metrics: Record<string, unknown>;
  alerts: NightlyAlert[];
}

/**
 * The nightly check (v9 FR-49, plan §11.3; release-2 plan P3, decided Q5):
 * - Daily (`debrief-nightly-check`, no model): yesterday's live debriefs,
 *   measured overall, by language and by recipe, against the days before;
 *   drift raises alerts for Analytics › Debriefs › Nightly check and the PM
 *   agent. Data-quality counts come first. Debriefs a person should see join
 *   "Needs a person" tagged "From the nightly check" (a clinician and the
 *   judge disagreed; a learner's thumbs-down with a comment); a risk-cue
 *   disagreement goes to the clinical advisor's "Escalated to you".
 * - Weekly (`debrief-judge-anchor`, learning budget): the independent check
 *   scores a fixed anchor set again without storing it; the mean move is
 *   judge drift, which re-locks autonomy beyond the owner's limit.
 * Nothing here judges a debrief for the queue: no debrief is judged twice.
 */
@Injectable()
export class DebriefNightlyService implements OnModuleInit {
  private readonly logger = LoggerService.getInstance(
    DebriefNightlyService.name,
  );

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(DebriefRun)
    private readonly runs: Repository<DebriefRun>,
    private readonly settings: DebriefSettingsService,
    private readonly judge: DebriefRunJudgeService,
    private readonly notifier: DebriefNotifier,
  ) {}

  onModuleInit(): void {
    scheduledTaskRegistry.registerConfigurable(
      'debrief-nightly-check',
      async () => {
        const r = await this.runDay();
        return `${r.day}: ${r.runs} debriefs, ${r.alerts} alerts, ${r.routed} sent to a person`;
      },
    );
    scheduledTaskRegistry.registerConfigurable(
      'debrief-judge-anchor',
      async () => {
        const r = await this.runAnchor();
        return r
          ? `Judge drift ${r.drift >= 0 ? '+' : ''}${r.drift} over ${r.n} debriefs`
          : 'Too few anchor debriefs to measure drift yet';
      },
    );
  }

  // --- Daily -------------------------------------------------------------------

  private async runsBetween(from: Date, to: Date): Promise<NightlyRun[]> {
    const rows: Array<Record<string, any>> = await this.dataSource.query(
      `SELECT r.id, s."counselorId" AS learner, r.language, r."recipeKey" AS recipe,
              r.status, r.cards, r."evaluatorOverall"::float AS ev,
              (r.workspace->'judge'->>'overall')::float AS judge,
              (SELECT (d->>'score')::float
                 FROM jsonb_array_elements(coalesce(r.workspace->'judge'->'dimensions', '[]'::jsonb)) d
                WHERE d->>'dimension' = 'evidence_specificity' LIMIT 1) AS spec
         FROM debrief_runs r
         LEFT JOIN scenario_sessions s ON s.id = r."scenarioSessionId"
        WHERE r.mode = 'live' AND r."createdAt" >= $1 AND r."createdAt" < $2`,
      [from, to],
    );
    return rows.map((r) => ({
      id: r.id,
      learnerId: r.learner == null ? null : Number(r.learner),
      language: r.language
        ? String(r.language).split(/[-_]/)[0].toLowerCase()
        : null,
      recipeKey: r.recipe ?? null,
      status: r.status,
      cards: r.cards ?? null,
      evaluatorOverall: r.ev ?? null,
      judgeOverall: r.judge ?? null,
      judgeSpecificity: r.spec ?? null,
    }));
  }

  /** What is missing from the day's data, read before any analysis (R2-9). */
  private async dataQuality(from: Date, to: Date) {
    const [q] = await this.dataSource.query(
      `SELECT count(*)::int AS runs,
              count(*) FILTER (WHERE language IS NULL)::int AS no_language,
              count(*) FILTER (WHERE status IN ('published','below_bar')
                                 AND NOT (workspace ? 'judge'))::int AS unjudged,
              count(*) FILTER (WHERE status = 'running'
                                 AND "createdAt" < now() - interval '1 hour')::int AS stuck,
              count(*) FILTER (WHERE status = 'failed')::int AS failed
         FROM debrief_runs
        WHERE mode = 'live' AND "createdAt" >= $1 AND "createdAt" < $2`,
      [from, to],
    );
    return {
      runs: Number(q?.runs ?? 0),
      noLanguage: Number(q?.no_language ?? 0),
      unjudged: Number(q?.unjudged ?? 0),
      stuck: Number(q?.stuck ?? 0),
      failed: Number(q?.failed ?? 0),
    };
  }

  private async save(
    day: string,
    slice: string,
    metrics: Record<string, unknown>,
    alerts: NightlyAlert[] = [],
  ) {
    await this.dataSource.query(
      `INSERT INTO debrief_quality_daily (day, slice, metrics, alerts)
       VALUES ($1, $2, $3::jsonb, $4::jsonb)
       ON CONFLICT (day, slice) DO UPDATE
         SET metrics = EXCLUDED.metrics, alerts = EXCLUDED.alerts, "updatedAt" = now()`,
      [day, slice, JSON.stringify(metrics), JSON.stringify(alerts)],
    );
  }

  /** Measure one India-time day (default: yesterday), store it, route debriefs. */
  async runDay(
    day = istDay(new Date(), 1),
  ): Promise<{ day: string; runs: number; alerts: number; routed: number }> {
    const { from, to } = istDayBounds(day);
    const quality = await this.dataQuality(from, to);
    const runs = await this.runsBetween(from, to);
    const week = await this.runsBetween(
      new Date(from.getTime() - 6 * 86_400_000),
      to,
    );
    const s = await this.settings.get();
    const thresholds = {
      lengthCreepShare: Number(s.nightlyLengthCreepShare),
      samenessMax: Number(s.nightlySamenessMax),
      specificityDrop: Number(s.nightlySpecificityDrop),
      gapMax: Number(s.nightlyGapMax),
    };
    const before: Array<{ metrics: NightlyMetrics }> =
      await this.dataSource.query(
        `SELECT metrics FROM debrief_quality_daily
          WHERE slice = 'all' AND day < $1::date
            AND day >= $1::date - make_interval(days => $2)
          ORDER BY day`,
        [day, NIGHTLY_BASELINE_DAYS],
      );
    const all = nightlyMetrics(runs, week);
    const alerts = nightlyAlerts(
      all,
      baselineOf(before.map((b) => b.metrics)),
      thresholds,
    );
    await this.save(day, 'all', { ...all, dataQuality: quality }, alerts);
    // Slices, for the charts. Alerts stay on the whole day: a slice of a few
    // debriefs is too small to alert on alone.
    const slices = new Map<string, NightlyRun[]>();
    for (const r of runs) {
      for (const key of [
        r.language ? `language:${r.language}` : null,
        r.recipeKey ? `recipe:${r.recipeKey}` : null,
      ]) {
        if (key) slices.set(key, [...(slices.get(key) ?? []), r]);
      }
    }
    for (const [key, slice] of slices) {
      const [kind, value] = key.split(':');
      const weekSlice = week.filter((r) =>
        kind === 'language' ? r.language === value : r.recipeKey === value,
      );
      await this.save(day, key, { ...nightlyMetrics(slice, weekSlice) });
    }
    const routed = await this.route(from, to);
    return { day, runs: runs.length, alerts: alerts.length, routed };
  }

  /** Mark a live run for "Needs a person", once, with why. */
  private async mark(runId: string, reasons: NightlyReason[]) {
    const res = await this.dataSource.query(
      `UPDATE debrief_runs
          SET workspace = coalesce(workspace, '{}'::jsonb)
                || jsonb_build_object('nightly',
                     jsonb_build_object('at', now(), 'reasons', $2::jsonb))
        WHERE id = $1 AND mode = 'live' AND NOT (coalesce(workspace, '{}'::jsonb) ? 'nightly')
        RETURNING id`,
      [runId, JSON.stringify(reasons)],
    );
    return (Array.isArray(res?.[0]) ? res[0] : res).length > 0;
  }

  /**
   * The day's debriefs a person should see (Q5): a clinician's verdict the
   * judge disagrees with, a learner's thumbs-down with a comment, and — to
   * the clinical advisor — a risk cue the judge and the published debrief
   * (or the clinician) disagree on.
   */
  private async route(from: Date, to: Date): Promise<number> {
    const disagree: Array<{ id: string }> = await this.dataSource.query(
      `SELECT DISTINCT r.id FROM debrief_reviews v
         JOIN debrief_runs r ON r.id = v."runId"
        WHERE v."updatedAt" >= $1 AND v."updatedAt" < $2 AND r.mode = 'live'
          AND r.workspace ? 'judge'
          AND ((v.verdict = 'good' AND ((r.workspace->'judge'->>'overall')::float < $3
                 OR jsonb_array_length(coalesce(r.workspace->'judge'->'hardFails','[]'::jsonb)) > 0))
            OR (v.verdict = 'needs_work' AND (r.workspace->'judge'->>'overall')::float >= $3
                 AND jsonb_array_length(coalesce(r.workspace->'judge'->'hardFails','[]'::jsonb)) = 0))`,
      [from, to, DEBRIEF_QUALITY_PASS],
    );
    const thumbs: Array<{ id: string }> = await this.dataSource.query(
      `SELECT DISTINCT f."runId" AS id FROM debrief_run_feedback f
         JOIN debrief_runs r ON r.id = f."runId"
        WHERE f.kind = 'helpful' AND f.helpful = false
          AND length(trim(coalesce(f.note, ''))) > 0
          AND f."createdAt" >= $1 AND f."createdAt" < $2 AND r.mode = 'live'`,
      [from, to],
    );
    const reasons = new Map<string, NightlyReason[]>();
    const add = (id: string, r: NightlyReason) =>
      reasons.set(id, [...(reasons.get(id) ?? []), r]);
    disagree.forEach((d) => add(d.id, 'judge_human_disagree'));
    thumbs.forEach((t) => add(t.id, 'thumbs_down_comment'));
    let routed = 0;
    for (const [id, why] of reasons) {
      if (await this.mark(id, why)) routed += 1;
    }
    // Risk cues: the judge found a missed cue on a debrief that was published,
    // or a clinician marked one the judge did not. Escalated once.
    const risk: Array<{ id: string; sid: string }> =
      await this.dataSource.query(
        `SELECT r.id, r."scenarioSessionId" AS sid FROM debrief_runs r
        WHERE r.mode = 'live' AND r."createdAt" >= $1 AND r."createdAt" < $2
          AND NOT (coalesce(r.workspace, '{}'::jsonb) ? 'escalation')
          AND (
            (r.status IN ('published','below_bar')
              AND coalesce(r.workspace->'judge'->'hardFails','[]'::jsonb) @> '[{"code":"missed_risk_cue"}]')
            OR (EXISTS (SELECT 1 FROM debrief_reviews v WHERE v."runId" = r.id
                         AND v."hardFails" ? 'missed_risk_cue')
                AND NOT coalesce(r.workspace->'judge'->'hardFails','[]'::jsonb) @> '[{"code":"missed_risk_cue"}]'))`,
        [from, to],
      );
    for (const r of risk) {
      await this.dataSource.query(
        `UPDATE debrief_runs
            SET workspace = coalesce(workspace, '{}'::jsonb) || jsonb_build_object('escalation',
                  jsonb_build_object('by', null, 'at', now(), 'source', 'nightly',
                    'note', 'From the nightly check: the quality score and the debrief disagree on a risk cue.'))
          WHERE id = $1 AND NOT (coalesce(workspace, '{}'::jsonb) ? 'escalation')`,
        [r.id],
      );
      await this.mark(r.id, ['risk_cue_disagree']);
      await this.notifier.escalated({
        what: 'run',
        scenarioSessionId: r.sid,
        note: 'From the nightly check: the quality score and the debrief disagree on a risk cue.',
        by: 0,
      });
      routed += 1;
    }
    return routed;
  }

  // --- Weekly: judge drift ------------------------------------------------------

  /** The anchor set's run ids: chosen once from published debriefs with a score, then kept. */
  private async anchorIds(size: number): Promise<string[]> {
    const [row] = await this.dataSource.query(
      `SELECT metrics FROM debrief_quality_daily WHERE slice = 'anchor_set'
        ORDER BY day DESC LIMIT 1`,
    );
    const kept: string[] = Array.isArray(row?.metrics?.runIds)
      ? row.metrics.runIds
      : [];
    if (kept.length >= size) return kept.slice(0, size);
    const picked: Array<{ id: string }> = await this.dataSource.query(
      `SELECT id FROM debrief_runs
        WHERE mode = 'live' AND status IN ('published','below_bar')
          AND (workspace->'judge'->>'overall') IS NOT NULL
          AND NOT (id = ANY($2::uuid[]))
        ORDER BY "createdAt" DESC LIMIT $1`,
      [size - kept.length, kept],
    );
    const ids = [...kept, ...picked.map((p) => p.id)];
    await this.save(istDay(new Date()), 'anchor_set', { runIds: ids });
    return ids;
  }

  /** Score the anchor set again, without storing; the mean move is judge drift. */
  async runAnchor(): Promise<{ drift: number; n: number } | null> {
    const s = await this.settings.get();
    const ids = await this.anchorIds(Number(s.judgeAnchorSize));
    if (!ids.length) return null;
    const runs = await this.runs.find({ where: { id: In(ids) } });
    const pairs: Array<{ before: number; after: number }> = [];
    for (const run of runs) {
      const before = Number(run.workspace?.judge?.overall);
      if (!Number.isFinite(before)) continue;
      const again = await this.judge
        .judge(run, { store: false })
        .catch(() => null);
      if (again?.overall == null) continue;
      pairs.push({ before, after: again.overall });
    }
    const drift = judgeDrift(pairs);
    if (!drift) return null;
    const max = Number(s.judgeDriftMax);
    const alerts: NightlyAlert[] =
      Math.abs(drift.drift) > max
        ? [
            {
              code: 'judge_drift',
              detail: `The quality score moved ${drift.drift >= 0 ? '+' : ''}${drift.drift} points scoring the same ${drift.n} debriefs again (limit ±${max}).`,
              value: drift.drift,
              baseline: 0,
            },
          ]
        : [];
    await this.save(
      istDay(new Date()),
      'judge_drift',
      { ...drift, max },
      alerts,
    );
    return drift;
  }

  /**
   * Judge drift for the autonomy re-lock: true when the latest weekly reading
   * (within {@link JUDGE_DRIFT_FRESH_DAYS}) was beyond the limit, false when
   * it was within, null when there is no recent reading.
   */
  judgeDrifted(): Promise<boolean | null> {
    return readJudgeDrifted(this.dataSource);
  }

  // --- Reads ------------------------------------------------------------------

  /** The days for Analytics › Debriefs › Nightly check, oldest first. */
  async days(days = 56): Promise<NightlyDayRow[]> {
    const rows: Array<Record<string, any>> = await this.dataSource.query(
      `SELECT to_char(day, 'YYYY-MM-DD') AS day, slice, metrics, alerts
         FROM debrief_quality_daily
        WHERE slice <> 'anchor_set'
          AND day >= (now() AT TIME ZONE 'Asia/Kolkata')::date - $1::int
        ORDER BY day, slice`,
      [Math.max(1, Math.min(days, 366))],
    );
    return rows.map((r) => ({
      day: r.day,
      slice: r.slice,
      metrics: r.metrics ?? {},
      alerts: Array.isArray(r.alerts) ? r.alerts : [],
    }));
  }

  /** The last week's nightly check, for the PM agent's inputs (R2-9). */
  async forPmAgent(): Promise<{
    days: Array<{ day: string; metrics: Record<string, unknown> }>;
    alerts: Array<NightlyAlert & { day: string }>;
  }> {
    const rows = (await this.days(8)).filter(
      (r) => r.slice === 'all' || r.slice === 'judge_drift',
    );
    return {
      days: rows
        .filter((r) => r.slice === 'all')
        .map((r) => ({ day: r.day, metrics: r.metrics })),
      alerts: rows.flatMap((r) => r.alerts.map((a) => ({ ...a, day: r.day }))),
    };
  }
}
