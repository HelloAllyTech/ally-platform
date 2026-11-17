import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { PlanEventKind } from 'src/product-planning/enum/product-planning.enum';
import { IDLE_RELEASE_NOTE_PREFIX } from '../plan/plan-lead.service';
import { titleOf } from '../item/roadmap-item-query.util';
import {
  IdeaSpend,
  IdeaTimeline,
  PolicyLogRow,
  RoadmapMetrics,
  bothThenLater,
  computeRoadmapMetrics,
  earliest,
} from './roadmap-metrics.util';

type Row = Record<string, unknown>;

const date = (value: unknown): Date | null => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const reviewStateOf = (value: unknown): IdeaTimeline['reviewState'] =>
  value === 'pending' || value === 'accepted' || value === 'declined'
    ? value
    : null;

/** Outcome verdicts that mean the idea was measured; too early and broken were not. */
const MEASURED_VERDICTS = ['hit', 'partial', 'miss'];

/**
 * Roadmap v2 P8: loads what the Measures view needs from the existing tables
 * and hands it to the pure aggregation (roadmap-metrics.util). Reads only:
 * opportunities and their review columns (P0), plan sessions and plan events,
 * build runs, `item_linked_prs` / `item_releases` (P1), `release_policy_log`
 * (P5), outcome reviews and the spend ledger. No new table.
 *
 * Platform-wide like every product-roadmap read (the opportunity's tenant is
 * informational only); the route is Owner-only, and an org-restricted admin
 * is never an Owner. Reads no transcript, no decline reason, no draft text: a
 * private draft is counted, and its spend is listed by code with no title.
 */
@Injectable()
export class RoadmapMetricsService {
  constructor(private readonly dataSource: DataSource) {}

  async compute(input: {
    from: Date;
    to: Date;
    amberDays: number;
    now?: Date;
  }): Promise<RoadmapMetrics> {
    const now = input.now ?? new Date();
    const range = { from: input.from, to: input.to };
    const [ideas, policyLog, failingIdeasNow, idleLeadReleases, spend] =
      await Promise.all([
        this.timelines(range),
        this.policyLog(range),
        this.failingIdeasNow(),
        this.idleLeadReleases(range),
        this.spend(range),
      ]);
    return computeRoadmapMetrics({
      range,
      now,
      amberDays: input.amberDays,
      ideas,
      policyLog,
      failingIdeasNow,
      idleLeadReleases,
      spend,
    });
  }

  /**
   * Every idea that can matter to the range: opportunities filed before its
   * end, and drafts created inside it that have no opportunity yet.
   */
  private async timelines(range: { from: Date; to: Date }) {
    const opportunities: Row[] = await this.dataSource.query(
      `SELECT o.id, o."createdAt", o."reviewState", o."reviewedAt", o.stage,
              o."releasedAt", o."builderSessionId",
              s."createdAt" AS "sessionCreatedAt",
              (s.kind = 'plan' AND s.plan ? 'draftVersion') AS drafted,
              COALESCE(jsonb_typeof(s.plan->'closed') = 'object', false)
                AS "planClosed",
              s.plan->>'planningStartedAt' AS "planningStartedAt",
              s.plan->'externalBuild'->>'at' AS "externalBuildAt",
              s."lastRunSequence"
         FROM "roadmap_opportunities" o
         LEFT JOIN "builder_sessions" s ON s.id = o."builderSessionId"
        WHERE o."deletedAt" IS NULL AND o."createdAt" < $1`,
      [range.to],
    );
    const filedSessions = new Set(
      opportunities
        .map((o) => o.builderSessionId)
        .filter((id): id is string => typeof id === 'string'),
    );
    // Discarded drafts are hard-deleted and cannot be counted (P8-NOTES).
    const drafts: Row[] = await this.dataSource.query(
      `SELECT s.id, s."createdAt"
         FROM "builder_sessions" s
        WHERE s.kind = 'plan' AND s.plan ? 'draftVersion'
          AND s."createdAt" >= $1 AND s."createdAt" < $2`,
      [range.from, range.to],
    );
    const unfiled = drafts.filter((d) => !filedSessions.has(String(d.id)));

    const sessionIds = [...filedSessions];
    const opportunityIds = opportunities.map((o) => String(o.id));
    const [events, runs, prs, outcomes] = await Promise.all([
      sessionIds.length
        ? this.dataSource.query(
            `SELECT e."sessionId",
                    min(e.at) FILTER (WHERE e.kind = $2) AS "planningAt",
                    min(e.at) FILTER (WHERE e.kind = $3) AS "externalBuildAt",
                    min(e.at) FILTER (WHERE e.kind = $4
                      OR (e.kind = $5 AND e.detail->>'to' = 'building')) AS "buildingAt",
                    min(e.at) FILTER (WHERE e.kind = $5
                      AND e.detail->>'to' IN ('launching', 'measuring', 'learned')) AS "shippedAt"
               FROM "plan_events" e
              WHERE e."sessionId" = ANY($1::uuid[])
              GROUP BY e."sessionId"`,
            [
              sessionIds,
              PlanEventKind.PLANNING_STARTED,
              PlanEventKind.EXTERNAL_BUILD,
              PlanEventKind.BUILD_SENT,
              PlanEventKind.STAGE_CHANGED,
            ],
          )
        : Promise.resolve([]),
      sessionIds.length
        ? this.dataSource.query(
            `SELECT "sessionId", min("createdAt") AS "firstRunAt"
               FROM "builder_build_runs"
              WHERE "sessionId" = ANY($1::uuid[])
              GROUP BY "sessionId"`,
            [sessionIds],
          )
        : Promise.resolve([]),
      opportunityIds.length
        ? this.dataSource.query(
            `SELECT "opportunityId", min("createdAt") AS "firstPrAt"
               FROM "item_linked_prs"
              WHERE "opportunityId" = ANY($1::uuid[])
              GROUP BY "opportunityId"`,
            [opportunityIds],
          )
        : Promise.resolve([]),
      sessionIds.length
        ? this.dataSource.query(
            `SELECT "sessionId", min("createdAt") AS "measuredAt"
               FROM "plan_outcome_reviews"
              WHERE "sessionId" = ANY($1::uuid[]) AND verdict = ANY($2::text[])
              GROUP BY "sessionId"`,
            [sessionIds, MEASURED_VERDICTS],
          )
        : Promise.resolve([]),
    ]);

    const bySession = <T extends Row>(rows: T[], key = 'sessionId') =>
      new Map(rows.map((row) => [String(row[key]), row]));
    const eventsBy = bySession(events as Row[]);
    const runsBy = bySession(runs as Row[]);
    const prsBy = bySession(prs as Row[], 'opportunityId');
    const outcomesBy = bySession(outcomes as Row[]);

    const ideas: IdeaTimeline[] = opportunities.map((o) => {
      const sessionId = o.builderSessionId ? String(o.builderSessionId) : '';
      const e = eventsBy.get(sessionId) ?? {};
      const externalBuildAt = earliest(
        date(e.externalBuildAt),
        date(o.externalBuildAt),
      );
      return {
        capturedAt: o.drafted === true ? date(o.sessionCreatedAt) : null,
        submittedAt: date(o.createdAt),
        reviewState: reviewStateOf(o.reviewState),
        reviewedAt: date(o.reviewedAt),
        planningAt: earliest(
          date(e.planningAt),
          date(o.planningStartedAt),
          externalBuildAt,
        ),
        // Here: the first build run. In Claude Code: once the brief went and
        // a pull request exists (deriveItemStage's rule, §4.5b).
        buildingAt: earliest(
          date(runsBy.get(sessionId)?.firstRunAt),
          date(e.buildingAt),
          bothThenLater(
            externalBuildAt,
            date(prsBy.get(String(o.id))?.firstPrAt),
          ),
        ),
        shippedAt: earliest(date(o.releasedAt), date(e.shippedAt)),
        measuredAt: date(outcomesBy.get(sessionId)?.measuredAt),
        closed: o.stage === 'archived' || o.planClosed === true,
      };
    });
    for (const draft of unfiled) {
      ideas.push({
        capturedAt: date(draft.createdAt),
        submittedAt: null,
        reviewState: null,
        reviewedAt: null,
        planningAt: null,
        buildingAt: null,
        shippedAt: null,
        measuredAt: null,
        closed: false,
      });
    }
    return ideas;
  }

  private async policyLog(range: {
    from: Date;
    to: Date;
  }): Promise<PolicyLogRow[]> {
    const rows: Row[] = await this.dataSource.query(
      `SELECT kind, mode, decision, outcome, healthy, service,
              COALESCE("finishedAt", "createdAt") AS at
         FROM "release_policy_log"
        WHERE ((kind = 'decision' AND decision = 'held')
               OR (kind = 'observed_release'
                   AND (outcome = 'failed' OR healthy = false)))
          AND COALESCE("finishedAt", "createdAt") >= $1
          AND COALESCE("finishedAt", "createdAt") < $2`,
      [range.from, range.to],
    );
    return rows.map((row) => ({
      kind: String(row.kind),
      mode: row.mode == null ? null : String(row.mode),
      decision: row.decision == null ? null : String(row.decision),
      outcome: row.outcome == null ? null : String(row.outcome),
      healthy: typeof row.healthy === 'boolean' ? row.healthy : null,
      service: row.service == null ? null : String(row.service),
      at: date(row.at) ?? new Date(0),
    }));
  }

  private async failingIdeasNow(): Promise<number> {
    const [row] = await this.dataSource.query(
      `SELECT count(DISTINCT r."opportunityId")::int AS n
         FROM "item_releases" r
         JOIN "roadmap_opportunities" o ON o.id = r."opportunityId"
        WHERE r.state = 'failed' AND o."deletedAt" IS NULL`,
    );
    return Number(row?.n ?? 0);
  }

  /** Leads handed back by the idle sweep (rev 5.2's `sweepLeads`), by its note. */
  private async idleLeadReleases(range: {
    from: Date;
    to: Date;
  }): Promise<number | null> {
    const [row] = await this.dataSource.query(
      `SELECT count(*)::int AS n
         FROM "plan_events"
        WHERE kind = $1 AND at >= $2 AND at < $3
          AND detail->>'note' LIKE $4`,
      [
        PlanEventKind.AUTO_RELEASED,
        range.from,
        range.to,
        `${IDLE_RELEASE_NOTE_PREFIX}%`,
      ],
    );
    return row?.n === undefined ? null : Number(row.n);
  }

  /** Each idea's ledger spend in the range. A private draft gets no title. */
  private async spend(range: { from: Date; to: Date }): Promise<IdeaSpend[]> {
    const rows: Row[] = await this.dataSource.query(
      `SELECT p."sessionId",
              sum(p."costUsd")::float AS "totalUsd",
              bool_or(NOT p.priced) AS approximate,
              s.plan->>'code' AS "draftCode",
              o.code, o.description
         FROM "plan_spend_entries" p
         LEFT JOIN "builder_sessions" s ON s.id = p."sessionId"
         LEFT JOIN "roadmap_opportunities" o
                ON o."builderSessionId" = p."sessionId" AND o."deletedAt" IS NULL
        WHERE p."sessionId" IS NOT NULL AND p.at >= $1 AND p.at < $2
        GROUP BY p."sessionId", s.plan->>'code', o.code, o.description`,
      [range.from, range.to],
    );
    return rows.map((row) => ({
      code:
        (row.code as string | null) ?? (row.draftCode as string | null) ?? null,
      title: row.code ? titleOf(row.description as string | null) : null,
      totalUsd: Number(row.totalUsd) || 0,
      approximate: row.approximate === true,
    }));
  }
}
