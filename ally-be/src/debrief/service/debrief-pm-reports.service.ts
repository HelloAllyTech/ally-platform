import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { computeCostUsd } from '../../analytics/constants/llm-pricing.constants';
import { DEBRIEF_AGENT_KEY } from '../constants/debrief-release.constants';
import {
  isValidPeriod,
  monthOf,
  periodBounds,
  periodTitle,
  PmReportKind,
  reviewedMonth,
  standingAt14Days,
  StandingStatus,
  STANDING_DAYS,
  weekOf,
} from '../util/debrief-pm-reports.util';
import { DebriefSettingsService } from './debrief-settings.service';

/** Judging a replay costs about what judging today's debrief does (as the learning budget counts it). */
const REPLAY_JUDGE_USD = 0.04;
const DAY_MS = 86_400_000;

export interface PmReportListItem {
  kind: PmReportKind;
  period: string;
  title: string;
  /** When the PM agent wrote it; null for a month whose review isn't out yet. */
  publishedAt: string | null;
  hasReview: boolean;
}

type Who = { id: number; name: string | null } | null;

export interface PmReportChanged {
  from: string;
  to: string;
  liveForEveryone: {
    count: number;
    byPerson: number;
    items: Array<{
      releaseId: string;
      version: number;
      ideaId: string | null;
      title: string;
      at: string;
      /** The person who put it live; null when it went live on its own. */
      approvedBy: Who;
      standing: StandingStatus;
    }>;
  };
  reverted: {
    count: number;
    items: Array<{
      releaseId: string | null;
      version: number | null;
      ideaId: string | null;
      title: string;
      at: string;
      /** `try_out_reverted`: the learner try-out was taken back on its own; `try_out_stopped`: a person or an expired approval stopped it. */
      how: 'try_out_reverted' | 'try_out_stopped' | 'rolled_back' | 'emergency';
      by: Who;
      reason: string | null;
    }>;
  };
  rejected: {
    count: number;
    items: Array<{
      ideaId: string;
      title: string;
      at: string;
      withdrawn: boolean;
      /** The person; null = the PM agent. */
      by: Who;
      reason: string | null;
    }>;
  };
  tests: {
    count: number;
    passed: number;
    quickChecks: number;
    passTests: number;
    trials: number;
  };
  sentToBuilder: { count: number };
  /** Monthly only: the learning budget for the month and what it went on. */
  budget: {
    spentUsd: number;
    capUsd: number;
    parts: { testsUsd: number; pmAgentUsd: number };
  } | null;
}

export interface PmReport {
  kind: PmReportKind;
  period: string;
  title: string;
  changed: PmReportChanged;
  review: { text: string; publishedAt: string } | null;
}

const iso = (d: Date | string) => new Date(d).toISOString();
const round2 = (n: number) => Math.round(n * 100) / 100;
const who = (id: unknown, name: unknown): Who =>
  id != null ? { id: Number(id), name: (name as string) ?? null } : null;

/**
 * PM agent › Reports (R2-25): the PM agent's weekly reports and monthly
 * reviews (its `curator_run` audit rows), and beside each a "What changed"
 * computed from the records alone — releases put live for everyone and
 * reverted (`agent_release_audit`), ideas rejected or withdrawn and tests
 * run (`agent_lesson_audit`, `agent_lessons.evidence`), Builder hand-offs,
 * and the learning budget (replay runs and `llm_usage`). Platform-wide like
 * every PM agent route: the Debrief agent and its ideas are one for all
 * organisations.
 */
@Injectable()
export class DebriefPmReportsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly ownerSettings: DebriefSettingsService,
  ) {}

  /** The PM agent's report rows of one kind, oldest first. */
  private async reportRows(
    review: PmReportKind,
  ): Promise<Array<{ report: string; createdAt: Date }>> {
    return this.dataSource.query(
      `SELECT detail->>'report' AS report, "createdAt" FROM agent_lesson_audit
        WHERE "agentKey" = $1 AND action = 'curator_run' AND detail->>'review' = $2
          AND COALESCE(detail->>'report', '') <> ''
        ORDER BY "createdAt" ASC`,
      [DEBRIEF_AGENT_KEY, review],
    );
  }

  /** Which report a run is: weekly by the week it was written in, monthly by the month it reviewed. */
  private static periodOfRun(kind: PmReportKind, at: Date): string {
    return kind === 'weekly' ? weekOf(at) : reviewedMonth(at);
  }

  /**
   * One review per period: a week's latest weekly report (a "Run now" can
   * add one mid-week), a month's first review after it ended.
   */
  private async reviews(
    kind: PmReportKind,
  ): Promise<Map<string, { text: string; publishedAt: string }>> {
    const out = new Map<string, { text: string; publishedAt: string }>();
    for (const r of await this.reportRows(kind)) {
      const period = DebriefPmReportsService.periodOfRun(
        kind,
        new Date(r.createdAt),
      );
      if (kind === 'monthly' && out.has(period)) continue;
      out.set(period, { text: r.report, publishedAt: iso(r.createdAt) });
    }
    return out;
  }

  /** Months with anything in "What changed" (IST). */
  private async monthsWithRecords(): Promise<Set<string>> {
    const rows: Array<{ t: Date }> = await this.dataSource.query(
      `SELECT DISTINCT date_trunc('minute', t) AS t FROM (
         SELECT "createdAt" AS t FROM agent_release_audit
          WHERE "agentKey" = $1
            AND action IN ('promoted','rolled_back','emergency_rollback','canary_reverted','canary_stopped')
         UNION ALL
         SELECT "createdAt" FROM agent_lesson_audit
          WHERE "agentKey" = $1
            AND (action IN ('rejected','retired','approved')
                 OR (action = 'pipeline_step' AND detail->>'step' IN ('quick_test','gate')))
         UNION ALL
         SELECT (evidence->'trial'->>'startedAt')::timestamptz FROM agent_lessons
          WHERE "agentKey" = $1 AND evidence->'trial' ? 'startedAt'
       ) x WHERE t IS NOT NULL`,
      [DEBRIEF_AGENT_KEY],
    );
    return new Set(
      rows
        .filter((r) => r.t && !Number.isNaN(new Date(r.t).getTime()))
        .map((r) => monthOf(new Date(r.t))),
    );
  }

  /** `GET pm-agent/reports`: every report there is, newest first. */
  async list(): Promise<PmReportListItem[]> {
    const [weekly, monthly, recordMonths] = await Promise.all([
      this.reviews('weekly'),
      this.reviews('monthly'),
      this.monthsWithRecords(),
    ]);
    const items: PmReportListItem[] = [...weekly].map(([period, r]) => ({
      kind: 'weekly',
      period,
      title: periodTitle('weekly', period),
      publishedAt: r.publishedAt,
      hasReview: true,
    }));
    // A month is listed when it was reviewed, has records, or had a weekly
    // report (so Weekly → Monthly always has somewhere to go).
    const months = new Set<string>([
      ...monthly.keys(),
      ...recordMonths,
      ...[...weekly.keys()].map((w) => w.slice(0, 7)),
    ]);
    for (const period of months) {
      const r = monthly.get(period);
      items.push({
        kind: 'monthly',
        period,
        title: periodTitle('monthly', period),
        publishedAt: r?.publishedAt ?? null,
        hasReview: !!r,
      });
    }
    // Newest first by when the period starts; a month before its weeks.
    const start = (i: PmReportListItem) =>
      periodBounds(i.kind, i.period).from.getTime();
    return items.sort(
      (a, b) => start(b) - start(a) || b.kind.localeCompare(a.kind),
    );
  }

  /** `GET pm-agent/reports/:kind/:period`. */
  async get(
    kind: string,
    period: string,
    now: Date = new Date(),
  ): Promise<PmReport> {
    if (kind !== 'weekly' && kind !== 'monthly') {
      throw new BadRequestException('kind is weekly or monthly');
    }
    if (!isValidPeriod(kind, period)) {
      throw new BadRequestException(
        kind === 'monthly'
          ? 'a monthly period is YYYY-MM'
          : 'a weekly period is the Monday it starts, YYYY-MM-DD',
      );
    }
    const { from, to } = periodBounds(kind, period);
    const [changed, reviews] = await Promise.all([
      this.changed(from, to, kind === 'monthly', now),
      this.reviews(kind),
    ]);
    return {
      kind,
      period,
      title: periodTitle(kind, period),
      changed,
      review: reviews.get(period) ?? null,
    };
  }

  /** "What changed" between two instants, from the records only. */
  async changed(
    from: Date,
    to: Date,
    withBudget: boolean,
    now: Date = new Date(),
  ): Promise<PmReportChanged> {
    const range = [DEBRIEF_AGENT_KEY, iso(from), iso(to)];
    const [live, reverted, rejected, tests, trials, builder, budget] =
      await Promise.all([
        this.liveForEveryone(from, to, now),
        this.reverted(range),
        this.rejected(range),
        this.dataSource.query(
          `SELECT detail->>'step' AS step, count(*)::int AS n,
                  count(*) FILTER (WHERE detail->>'passed' = 'true')::int AS passed
             FROM agent_lesson_audit
            WHERE "agentKey" = $1 AND action = 'pipeline_step'
              AND detail->>'step' IN ('quick_test','gate')
              AND "createdAt" >= $2::timestamptz AND "createdAt" < $3::timestamptz
            GROUP BY 1`,
          range,
        ) as Promise<Array<{ step: string; n: number; passed: number }>>,
        this.dataSource.query(
          `SELECT count(*)::int AS n,
                  count(*) FILTER (WHERE evidence->'trial'->>'status' = 'passed')::int AS passed
             FROM agent_lessons
            WHERE "agentKey" = $1 AND evidence->'trial' ? 'startedAt'
              AND (evidence->'trial'->>'startedAt')::timestamptz >= $2::timestamptz
              AND (evidence->'trial'->>'startedAt')::timestamptz < $3::timestamptz`,
          range,
        ) as Promise<Array<{ n: number; passed: number }>>,
        this.dataSource.query(
          `SELECT count(*)::int AS n FROM agent_lesson_audit
            WHERE "agentKey" = $1 AND action = 'approved' AND detail->>'stage' = 'builder'
              AND "createdAt" >= $2::timestamptz AND "createdAt" < $3::timestamptz`,
          range,
        ) as Promise<Array<{ n: number }>>,
        withBudget ? this.budget(from, to) : Promise.resolve(null),
      ]);
    const step = (s: string) => tests.find((t) => t.step === s);
    const quick = step('quick_test');
    const gate = step('gate');
    const trial = trials[0] ?? { n: 0, passed: 0 };
    const testCount = (quick?.n ?? 0) + (gate?.n ?? 0) + Number(trial.n ?? 0);
    return {
      from: iso(from),
      to: iso(to),
      liveForEveryone: {
        count: live.length,
        byPerson: live.filter((l) => l.approvedBy).length,
        items: live,
      },
      reverted: { count: reverted.length, items: reverted },
      rejected: { count: rejected.length, items: rejected },
      tests: {
        count: testCount,
        passed:
          (quick?.passed ?? 0) +
          (gate?.passed ?? 0) +
          Number(trial.passed ?? 0),
        quickChecks: quick?.n ?? 0,
        passTests: gate?.n ?? 0,
        trials: Number(trial.n ?? 0),
      },
      sentToBuilder: { count: Number(builder[0]?.n ?? 0) },
      budget,
    };
  }

  /** The idea each release came from: the one whose release, draft or canary it was. */
  private async ideasFor(
    releaseIds: string[],
  ): Promise<Map<string, { id: string; text: string }>> {
    const out = new Map<string, { id: string; text: string }>();
    if (!releaseIds.length) return out;
    const rows: Array<Record<string, any>> = await this.dataSource.query(
      `SELECT id, text, "releaseId", change->>'releaseId' AS "draftId",
              evidence->'canary'->>'releaseId' AS "canaryId"
         FROM agent_lessons
        WHERE "agentKey" = $1
          AND ("releaseId"::text = ANY($2::text[]) OR change->>'releaseId' = ANY($2::text[])
               OR evidence->'canary'->>'releaseId' = ANY($2::text[]))`,
      [DEBRIEF_AGENT_KEY, releaseIds],
    );
    for (const r of rows) {
      for (const id of [r.releaseId, r.draftId, r.canaryId]) {
        if (id && !out.has(id)) out.set(id, { id: r.id, text: r.text });
      }
    }
    return out;
  }

  private static releaseTitle(
    version: number | null,
    notes: string | null,
    idea: { text: string } | undefined,
  ): string {
    return (
      idea?.text ?? notes ?? (version != null ? `Release v${version}` : '')
    );
  }

  private async liveForEveryone(from: Date, to: Date, now: Date) {
    const rows: Array<Record<string, any>> = await this.dataSource.query(
      `SELECT a."releaseId", a."actorKind", a."actorUserId", u.name AS "actorName",
              a."createdAt", r.version, r.notes
         FROM agent_release_audit a
         JOIN agent_releases r ON r.id = a."releaseId"
         LEFT JOIN users u ON u.id = a."actorUserId"
        WHERE a."agentKey" = $1 AND a.action = 'promoted'
          AND a."createdAt" >= $2::timestamptz AND a."createdAt" < $3::timestamptz
        ORDER BY a."createdAt" ASC`,
      [DEBRIEF_AGENT_KEY, iso(from), iso(to)],
    );
    if (!rows.length) return [];
    // Roll backs that could undo one of them within its first 14 days.
    const rollBacks: Array<{ createdAt: Date; toVersion: string | null }> =
      await this.dataSource.query(
        `SELECT "createdAt", detail->>'toVersion' AS "toVersion" FROM agent_release_audit
          WHERE "agentKey" = $1 AND action IN ('rolled_back','emergency_rollback')
            AND NOT (COALESCE(detail, '{}'::jsonb) ? 'canaryStopped')
            AND "createdAt" >= $2::timestamptz AND "createdAt" < $3::timestamptz`,
        [
          DEBRIEF_AGENT_KEY,
          iso(from),
          iso(new Date(to.getTime() + STANDING_DAYS * DAY_MS)),
        ],
      );
    const undo = rollBacks.map((r) => ({
      at: new Date(r.createdAt),
      toVersion: r.toVersion != null ? Number(r.toVersion) : null,
    }));
    const ideas = await this.ideasFor(rows.map((r) => r.releaseId));
    return rows.map((r) => {
      const idea = ideas.get(r.releaseId);
      const version = Number(r.version);
      return {
        releaseId: r.releaseId as string,
        version,
        ideaId: idea?.id ?? null,
        title: DebriefPmReportsService.releaseTitle(version, r.notes, idea),
        at: iso(r.createdAt),
        approvedBy:
          r.actorKind === 'human' ? who(r.actorUserId, r.actorName) : null,
        standing: standingAt14Days(
          { at: new Date(r.createdAt), version },
          undo,
          now,
        ),
      };
    });
  }

  private async reverted(range: string[]) {
    const rows: Array<Record<string, any>> = await this.dataSource.query(
      `SELECT a.action, a."releaseId", a."actorKind", a."actorUserId", u.name AS "actorName",
              a."createdAt", a.detail,
              r.version AS "releaseVersion", r.notes AS "releaseNotes",
              f.id AS "fromId", f.version AS "fromVersion", f.notes AS "fromNotes"
         FROM agent_release_audit a
         LEFT JOIN agent_releases r ON r.id = a."releaseId"
         LEFT JOIN agent_releases f ON f.id::text = a.detail->>'fromReleaseId'
         LEFT JOIN users u ON u.id = a."actorUserId"
        WHERE a."agentKey" = $1
          AND a.action IN ('canary_reverted','canary_stopped','rolled_back','emergency_rollback')
          AND NOT (a.action = 'emergency_rollback' AND COALESCE(a.detail, '{}'::jsonb) ? 'canaryStopped')
          AND a."createdAt" >= $2::timestamptz AND a."createdAt" < $3::timestamptz
        ORDER BY a."createdAt" ASC`,
      range,
    );
    // A roll back undoes the release that was live (`fromReleaseId`); a
    // try-out is its own release.
    const undone = (r: Record<string, any>) =>
      r.action === 'rolled_back' || r.action === 'emergency_rollback'
        ? {
            id: (r.fromId as string) ?? null,
            version: r.fromVersion != null ? Number(r.fromVersion) : null,
            notes: (r.fromNotes as string) ?? null,
          }
        : {
            id: r.releaseId as string,
            version: r.releaseVersion != null ? Number(r.releaseVersion) : null,
            notes: (r.releaseNotes as string) ?? null,
          };
    const ideas = await this.ideasFor(
      rows.map((r) => undone(r).id).filter((x): x is string => !!x),
    );
    const ideaTexts = new Map<string, string>();
    const byDetail = rows
      .map((r) => r.detail?.ideaId as string | undefined)
      .filter((x): x is string => !!x);
    if (byDetail.length) {
      const found: Array<{ id: string; text: string }> =
        await this.dataSource.query(
          `SELECT id, text FROM agent_lessons WHERE id::text = ANY($1::text[])`,
          [byDetail],
        );
      for (const f of found) ideaTexts.set(f.id, f.text);
    }
    return rows.map((r) => {
      const rel = undone(r);
      const detailIdea = r.detail?.ideaId as string | undefined;
      const idea =
        (detailIdea && ideaTexts.has(detailIdea)
          ? { id: detailIdea, text: ideaTexts.get(detailIdea)! }
          : undefined) ?? (rel.id ? ideas.get(rel.id) : undefined);
      const how =
        r.action === 'canary_reverted'
          ? ('try_out_reverted' as const)
          : r.action === 'canary_stopped'
            ? ('try_out_stopped' as const)
            : r.action === 'rolled_back'
              ? ('rolled_back' as const)
              : ('emergency' as const);
      return {
        releaseId: rel.id,
        version: rel.version,
        ideaId: idea?.id ?? null,
        title: DebriefPmReportsService.releaseTitle(
          rel.version,
          rel.notes,
          idea,
        ),
        at: iso(r.createdAt),
        how,
        by: r.actorKind === 'human' ? who(r.actorUserId, r.actorName) : null,
        reason: (r.detail?.reason as string) ?? null,
      };
    });
  }

  private async rejected(range: string[]) {
    const rows: Array<Record<string, any>> = await this.dataSource.query(
      `SELECT a.action, a."lessonId", a."actorUserId", u.name AS "actorName", a."createdAt",
              a.detail, l.text, l.evidence
         FROM agent_lesson_audit a
         JOIN agent_lessons l ON l.id = a."lessonId"
         LEFT JOIN users u ON u.id = a."actorUserId"
        WHERE a."agentKey" = $1
          AND ((a.action = 'rejected'
                AND COALESCE(a.detail->>'reason', '') <> 'expired_no_decision')
               OR (a.action = 'retired'
                   AND (a.detail->>'withdrawn' = 'true' OR l.evidence ? 'withdrawn')))
          AND a."createdAt" >= $2::timestamptz AND a."createdAt" < $3::timestamptz
        ORDER BY a."createdAt" ASC`,
      range,
    );
    return rows.map((r) => {
      const withdrawn = r.action === 'retired';
      return {
        ideaId: r.lessonId as string,
        title: r.text as string,
        at: iso(r.createdAt),
        withdrawn,
        by: who(r.actorUserId, r.actorName),
        reason:
          (r.detail?.reason as string | undefined) ??
          (withdrawn
            ? ((r.evidence?.withdrawn?.reason as string | undefined) ?? null)
            : ((r.evidence?.rejection?.reason as string | undefined) ?? null)),
      };
    });
  }

  /**
   * The learning budget over a month, counted as `learningSpentThisMonth`
   * counts it: tests are the replay runs (quick checks, pass tests and
   * side-by-side trials replay debriefs) plus judging them; PM agent runs
   * are the `debrief_improver` model calls. The cap is today's monthly
   * amount plus the skim of that month's production ceilings.
   */
  private async budget(from: Date, to: Date) {
    const range = [iso(from), iso(to)];
    const [replay, usage, ceilings, settings] = await Promise.all([
      this.dataSource.query(
        `SELECT COALESCE(sum(COALESCE("actualCostUsd","estimatedCostUsd")),0)::float AS usd,
                count(*) FILTER (WHERE workspace ? 'judge')::int AS judged
           FROM debrief_runs
          WHERE mode = 'replay'
            AND "createdAt" >= $1::timestamptz AND "createdAt" < $2::timestamptz`,
        range,
      ) as Promise<Array<{ usd: number; judged: number }>>,
      this.dataSource.query(
        `SELECT model, sum("promptTokens")::bigint AS p, sum("completionTokens")::bigint AS c
           FROM llm_usage
          WHERE task = 'debrief_improver'
            AND "occurredAt" >= $1::timestamptz AND "occurredAt" < $2::timestamptz
          GROUP BY model`,
        range,
      ) as Promise<Array<{ model: string; p: number; c: number }>>,
      this.dataSource.query(
        `SELECT COALESCE(sum(COALESCE("ceilingUsd", 0)::float), 0) AS ceilings
           FROM debrief_runs
          WHERE mode IN ('shadow','live') AND status <> 'skipped'
            AND "createdAt" >= $1::timestamptz AND "createdAt" < $2::timestamptz`,
        range,
      ) as Promise<Array<{ ceilings: number }>>,
      this.ownerSettings.get(),
    ]);
    const testsUsd =
      Number(replay[0]?.usd ?? 0) +
      Number(replay[0]?.judged ?? 0) * REPLAY_JUDGE_USD;
    const pmAgentUsd = usage.reduce(
      (n, u) => n + computeCostUsd(u.model, Number(u.p), Number(u.c)).costUsd,
      0,
    );
    return {
      spentUsd: round2(testsUsd + pmAgentUsd),
      capUsd: round2(
        settings.learningBudgetUsd +
          Number(ceilings[0]?.ceilings ?? 0) * settings.learningSkimPct,
      ),
      parts: { testsUsd: round2(testsUsd), pmAgentUsd: round2(pmAgentUsd) },
    };
  }
}
