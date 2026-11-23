/**
 * Chart specs: a chart's data described as data, then compiled to SQL here.
 *
 * A spec names a measure, a dimension and an optional scope from small
 * allow-lists. Nothing the caller sends is ever placed in the SQL text: ids go
 * in as parameters, and measures and dimensions map to fixed fragments. This is
 * the one place that applies the tenant match (both spellings of the tenant id),
 * the window, and the course, simulation and learner scopes.
 *
 * Scores are the judged composite (`scenario_session_details.compositeScore`,
 * 0 to 100), the same measure the other Statistics charts use.
 */

export const SESSION_MEASURES = [
  'sessions',
  'averageScore',
  'learners',
] as const;
export type SessionMeasure = (typeof SESSION_MEASURES)[number];

export const SESSION_DIMENSIONS = ['scenario', 'week'] as const;
export type SessionDimension = (typeof SESSION_DIMENSIONS)[number];

/** What a chart is about. Every field narrows the match; none widens it. */
export interface ChartSelection {
  /** One simulation. */
  scenarioId?: number;
  /** One course (a track): only sessions run from one of its items. */
  courseId?: string;
  /** One learner. */
  learnerId?: number;
}

/**
 * Which sessions a chart counts.
 * - `scored`: sessions with a judged score, windowed on when they started.
 * - `completed`: sessions that ended and completed, windowed on when they
 *   ended: the rule the organisation metrics page uses, so a count here matches
 *   the number on that page.
 */
export type SessionBasis = 'scored' | 'completed';

interface SessionSpecBase {
  source: 'sessions';
  /** A group needs this many sessions to be shown. */
  minSessions?: number;
}

/** One row per group, ranked by the measure. */
export interface RankedSessionSpec extends SessionSpecBase {
  result: 'ranked';
  measure: SessionMeasure;
  dimension: SessionDimension;
  /** Defaults to `scored` for a score measure and `completed` otherwise. */
  basis?: SessionBasis;
  order: 'asc' | 'desc';
  limit: number;
}

/** Scored sessions in ten bands of ten points, and the median. */
export interface DistributionSessionSpec extends SessionSpecBase {
  result: 'distribution';
}

/** Session ratings: how many learners gave each of one to five stars. */
export interface StarsFeedbackSpec {
  source: 'feedback';
  result: 'stars';
}

export type ChartQuerySpec =
  | RankedSessionSpec
  | DistributionSessionSpec
  | StarsFeedbackSpec;

export interface CompileContext {
  tenantId: string;
  tenantCode: string;
  start: Date;
  endExclusive: Date;
  scope: ChartSelection;
}

export interface CompiledQuery {
  sql: string;
  params: unknown[];
}

const MEASURE_SQL: Record<SessionMeasure, string> = {
  sessions: 'COUNT(*)',
  averageScore: 'AVG(d."compositeScore")',
  learners: 'COUNT(DISTINCT s."counselorId")',
};

/** Group key, label and the extra joins a dimension needs. */
const DIMENSION_SQL: Record<
  SessionDimension,
  { key: string; label: string; join: string; group: string }
> = {
  scenario: {
    key: 's."scenarioId"::text',
    label: 'sc.title',
    join: 'JOIN scenarios sc ON sc.id = s."scenarioId"',
    group: 's."scenarioId", sc.title',
  },
  week: {
    key: `to_char(date_trunc('week', s."startedAt"), 'YYYY-MM-DD')`,
    label: `to_char(date_trunc('week', s."startedAt"), 'YYYY-MM-DD')`,
    join: '',
    group: `date_trunc('week', s."startedAt")`,
  },
};

const COURSE_JOIN = `JOIN track_item_progress tip ON tip.id = s."trackItemProgressId"
         JOIN track_items ti ON ti.id = tip."trackItemId"`;

/** Adds the scope filters, with ids as parameters. */
const scopeFilters = (
  scope: ChartSelection,
  params: unknown[],
  where: string[],
): void => {
  const { scenarioId, courseId, learnerId } = scope;
  if (scenarioId !== undefined) {
    params.push(scenarioId);
    where.push(`s."scenarioId" = $${params.length}`);
  }
  if (courseId !== undefined) {
    params.push(courseId);
    where.push(`ti."trackId" = $${params.length}::uuid`);
  }
  if (learnerId !== undefined) {
    params.push(learnerId);
    where.push(`s."counselorId" = $${params.length}`);
  }
};

/** Builds the FROM and WHERE shared by every session chart. */
const sessionBase = (
  ctx: CompileContext,
  extraJoin: string,
  basis: SessionBasis = 'scored',
): { from: string; params: unknown[] } => {
  const params: unknown[] = [
    ctx.tenantId,
    ctx.tenantCode,
    ctx.start,
    ctx.endExclusive,
  ];
  const joins = [
    basis === 'scored'
      ? 'JOIN scenario_session_details d ON d."scenarioSessionId" = s.id'
      : '',
    extraJoin,
    ctx.scope.courseId ? COURSE_JOIN : '',
  ].filter(Boolean);
  const where = ['s.tenant_id::text IN ($1, $2)'];
  if (basis === 'scored') {
    where.push(
      'd."compositeScore" IS NOT NULL',
      's."startedAt" >= $3 AND s."startedAt" < $4',
    );
  } else {
    where.push(
      `s.status = 'ENDED' AND s."eventStatus" = 'COMPLETED'`,
      'COALESCE(s."endedAt", s."createdAt") >= $3',
      'COALESCE(s."endedAt", s."createdAt") < $4',
    );
  }
  scopeFilters(ctx.scope, params, where);
  return {
    from: `FROM scenario_sessions s
         ${joins.join('\n         ')}
        WHERE ${where.join('\n          AND ')}`,
    params,
  };
};

/** SQL for a ranked chart: key, label, value and the sessions behind each row. */
export const compileRanked = (
  spec: RankedSessionSpec,
  ctx: CompileContext,
): CompiledQuery => {
  const dim = DIMENSION_SQL[spec.dimension];
  const basis: SessionBasis =
    spec.basis ?? (spec.measure === 'averageScore' ? 'scored' : 'completed');
  const { from, params } = sessionBase(ctx, dim.join, basis);
  const min = Math.max(1, Math.floor(spec.minSessions ?? 1));
  const limit = Math.max(1, Math.min(200, Math.floor(spec.limit)));
  const direction = spec.order === 'asc' ? 'ASC' : 'DESC';
  return {
    sql: `SELECT ${dim.key} AS key,
              ${dim.label} AS label,
              ${MEASURE_SQL[spec.measure]} AS value,
              COUNT(*) AS sessions
         ${from}
        GROUP BY ${dim.group}
       HAVING COUNT(*) >= ${min}
        ORDER BY ${MEASURE_SQL[spec.measure]} ${direction}
        LIMIT ${limit}`,
    params,
  };
};

/** SQL for the ten score bands. */
export const compileDistributionBins = (ctx: CompileContext): CompiledQuery => {
  const { from, params } = sessionBase(ctx, '');
  return {
    sql: `SELECT LEAST(FLOOR(d."compositeScore" / 10.0), 9)::int AS bin,
              COUNT(*) AS n
         ${from}
        GROUP BY 1`,
    params,
  };
};

/** SQL for the median score. */
export const compileMedian = (ctx: CompileContext): CompiledQuery => {
  const { from, params } = sessionBase(ctx, '');
  return {
    sql: `SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY d."compositeScore") AS median
         ${from}`,
    params,
  };
};

/** SQL for the star counts. Feedback belongs to a session, so the scope filters apply through it. */
export const compileStars = (ctx: CompileContext): CompiledQuery => {
  const params: unknown[] = [
    ctx.tenantId,
    ctx.tenantCode,
    ctx.start,
    ctx.endExclusive,
  ];
  const where = [
    'f.tenant_id::text IN ($1, $2)',
    'f.rating BETWEEN 1 AND 5',
    'f."createdAt" >= $3 AND f."createdAt" < $4',
  ];
  scopeFilters(ctx.scope, params, where);
  const scoped =
    ctx.scope.scenarioId !== undefined ||
    ctx.scope.courseId !== undefined ||
    ctx.scope.learnerId !== undefined;
  const joins = scoped
    ? [
        'JOIN scenario_sessions s ON s.id = f."scenarioSessionId"',
        ctx.scope.courseId ? COURSE_JOIN : '',
      ]
        .filter(Boolean)
        .join('\n         ')
    : '';
  return {
    sql: `SELECT f.rating AS rating, COUNT(*) AS n
         FROM scenario_session_feedbacks f
         ${joins}
        WHERE ${where.join('\n          AND ')}
        GROUP BY f.rating`,
    params,
  };
};
