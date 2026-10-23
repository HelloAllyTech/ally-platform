import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { countableSessionPredicate } from '../util/session-eligibility.util';
import { excludeTestTenants, scopeToTenant } from '../util/test-tenant.util';
import { getPlatformDataFloor } from '../util/data-floor.util';

/** One rating row as the feed shows it. */
export interface LearnerFeedbackRow {
  feedbackId: string;
  sessionId: string;
  sessionAt: string;
  ratedAt: string;
  rating: number;
  comment: string | null;
  tags: string[];
  learnerId: number | null;
  learnerName: string | null;
  tenantId: string | null;
  orgName: string | null;
  scenarioId: number | null;
  scenarioTitle: string | null;
  language: string | null;
}

/** Ratings per star in the window, before the feed's own filters. */
export interface LearnerFeedbackStarRow {
  rating: number;
  count: number;
  withComment: number;
}

/** The feed's own narrowing, applied to the list and its total only. */
export interface LearnerFeedbackFilters {
  ratings?: number[];
  commentsOnly: boolean;
  search?: string;
}

/** Escape LIKE wildcards so a search for "50%" means the text "50%". */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Post-session learner ratings and their comments, for the Analytics
 * "Ratings & comments" tab.
 *
 * ## Which rows count
 *
 * - **One rating per session: the latest.** A learner can re-submit; the
 *   session's current opinion is the last one, which is also what Roleplay Logs
 *   shows for that session.
 * - **Every countable session, not only completed ones.** The rating charts on
 *   Highlights read completed sessions, but a rating on a session that ended
 *   with no conversation is usually the complaint worth reading ("AI not
 *   responding"), so this feed keeps it. Its counts can therefore run slightly
 *   above the Average rating chart's.
 * - Preview and seed rooms, and test organisations, are excluded through the
 *   shared predicates.
 * - The window is on the session's end time (its creation when it never
 *   ended), matching the sentiment charts, not on when the rating was written.
 */
@Injectable()
export class LearnerFeedbackAnalyticsRepository {
  constructor(private readonly dataSource: DataSource) {}

  /** The left edge of an all-time window; the same floor every sibling uses. */
  async getDataFloor(): Promise<Date> {
    return getPlatformDataFloor(this.dataSource);
  }

  /**
   * The rated sessions in scope as a CTE body, with `$1` = window start and
   * `$2` = exclusive end, and the tenant (when given) appended to `params`.
   */
  private scopedRatings(
    params: unknown[],
    tenantId: string | undefined,
  ): string {
    let tenantPredicate = '';
    if (tenantId) {
      params.push(tenantId);
      tenantPredicate = `AND ${scopeToTenant('s."tenant_id"', `$${params.length}`)}`;
    }
    return `
      SELECT DISTINCT ON (f."scenarioSessionId")
        f.id                                          AS feedback_id,
        f."scenarioSessionId"                         AS session_id,
        f."createdAt"                                 AS rated_at,
        f.rating                                      AS rating,
        NULLIF(btrim(f.feedback), '')                 AS comment,
        COALESCE(f.tags, '[]'::jsonb)                 AS tags,
        COALESCE(s."endedAt", s."createdAt")          AS session_at,
        s."counselorId"                               AS learner_id,
        s."scenarioId"                                AS scenario_id,
        s."tenant_id"                                 AS tenant_id,
        s.metadata->>'languageId'                     AS language_id
      FROM scenario_session_feedbacks f
      JOIN scenario_sessions s ON s.id = f."scenarioSessionId"
      WHERE f.rating BETWEEN 1 AND 5
        AND COALESCE(s."endedAt", s."createdAt") >= $1
        AND COALESCE(s."endedAt", s."createdAt") < $2
        AND ${countableSessionPredicate('s')}
        AND ${excludeTestTenants('s."tenant_id"')}
        ${tenantPredicate}
      ORDER BY f."scenarioSessionId", f."createdAt" DESC`;
  }

  /** Count per star in the window, with how many of each carry a comment. */
  async getStarCounts(
    start: Date,
    end: Date,
    tenantId?: string,
  ): Promise<LearnerFeedbackStarRow[]> {
    const params: unknown[] = [start, end];
    const scoped = this.scopedRatings(params, tenantId);
    const rows: Record<string, unknown>[] = await this.dataSource.query(
      `
      WITH r AS (${scoped})
      SELECT rating::int                                  AS "rating",
             COUNT(*)::int                                AS "count",
             COUNT(*) FILTER (WHERE comment IS NOT NULL)::int AS "withComment"
      FROM r
      GROUP BY 1
      ORDER BY 1
      `,
      params,
    );
    return rows.map((r) => ({
      rating: Number(r.rating),
      count: Number(r.count) || 0,
      withComment: Number(r.withComment) || 0,
    }));
  }

  /** One page of the filtered feed, newest session first, plus its total. */
  async getPage(
    start: Date,
    end: Date,
    tenantId: string | undefined,
    filters: LearnerFeedbackFilters,
    limit: number,
    offset: number,
  ): Promise<{ rows: LearnerFeedbackRow[]; total: number }> {
    const params: unknown[] = [start, end];
    const scoped = this.scopedRatings(params, tenantId);

    const where: string[] = [];
    if (filters.commentsOnly) where.push('r.comment IS NOT NULL');
    if (filters.ratings?.length) {
      params.push(filters.ratings);
      where.push(`r.rating = ANY($${params.length}::int[])`);
    }
    if (filters.search) {
      params.push(`%${escapeLike(filters.search)}%`);
      const p = `$${params.length}`;
      where.push(
        `(r.comment ILIKE ${p} OR u.name ILIKE ${p} OR scn.title ILIKE ${p})`,
      );
    }
    params.push(limit, offset);
    const limitParam = `$${params.length - 1}`;
    const offsetParam = `$${params.length}`;

    // The total rides on each row (window function) so the page and its count
    // come from one pass over one population and cannot disagree.
    const rows: Record<string, unknown>[] = await this.dataSource.query(
      `
      WITH r AS (${scoped})
      SELECT
        r.feedback_id                       AS "feedbackId",
        r.session_id::text                  AS "sessionId",
        r.session_at                        AS "sessionAt",
        r.rated_at                          AS "ratedAt",
        r.rating::int                       AS "rating",
        r.comment                           AS "comment",
        r.tags                              AS "tags",
        r.learner_id                        AS "learnerId",
        u.name                              AS "learnerName",
        r.tenant_id                         AS "tenantId",
        t.name                              AS "orgName",
        r.scenario_id                       AS "scenarioId",
        scn.title                           AS "scenarioTitle",
        COALESCE(lang.label, lang.value)    AS "language",
        COUNT(*) OVER ()::int               AS "total"
      FROM r
      LEFT JOIN users u ON u.id = r.learner_id
      LEFT JOIN scenarios scn ON scn.id = r.scenario_id
      -- tenant_id is varchar holding a uuid or a code; compare as text.
      LEFT JOIN tenants t ON (t.id::text = r.tenant_id OR t.code = r.tenant_id)
      LEFT JOIN languages lang
        ON r.language_id ~ '^[0-9]+$' AND lang.id = r.language_id::int
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY r.session_at DESC, r.feedback_id
      LIMIT ${limitParam} OFFSET ${offsetParam}
      `,
      params,
    );

    // A page past the end has no row to carry the total; ask for page one's.
    if (!rows.length && offset > 0) {
      const first = await this.getPage(start, end, tenantId, filters, 1, 0);
      return { rows: [], total: first.total };
    }

    const toIso = (v: unknown): string =>
      v instanceof Date ? v.toISOString() : String(v);
    return {
      total: rows.length ? Number(rows[0].total) || 0 : 0,
      rows: rows.map((r) => ({
        feedbackId: String(r.feedbackId),
        sessionId: String(r.sessionId),
        sessionAt: toIso(r.sessionAt),
        ratedAt: toIso(r.ratedAt),
        rating: Number(r.rating),
        comment: (r.comment as string | null) ?? null,
        tags: Array.isArray(r.tags)
          ? (r.tags as unknown[]).filter(
              (x): x is string => typeof x === 'string',
            )
          : [],
        learnerId: r.learnerId === null ? null : Number(r.learnerId),
        learnerName: (r.learnerName as string | null) ?? null,
        tenantId: (r.tenantId as string | null) ?? null,
        orgName: (r.orgName as string | null) ?? null,
        scenarioId: r.scenarioId === null ? null : Number(r.scenarioId),
        scenarioTitle: (r.scenarioTitle as string | null) ?? null,
        language: (r.language as string | null) ?? null,
      })),
    };
  }
}
