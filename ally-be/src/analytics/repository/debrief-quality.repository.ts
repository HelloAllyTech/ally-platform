import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { resolveWorkerType } from '../../user/enum/user.enum';
import { excludeTestTenants } from '../util/test-tenant.util';
import { JudgeAttemptFamily } from '../constants/judge-scheduling.constants';
import {
  DEBRIEF_QUALITY_DIMENSIONS,
  DEBRIEF_QUALITY_PASS,
  DebriefQualityDimension,
  debriefOverallSql,
} from '../constants/debrief-quality.constants';
import { judgeAttemptGate } from '../util/judge-attempts.util';
import { settledEndedSessionPredicate } from '../util/session-eligibility.util';
import {
  DebriefSource,
  RenderedDebrief,
  renderDebrief,
} from '../util/debrief-render.util';

/** A session with a debrief worth scoring. */
export interface DebriefQualitySessionRow {
  id: string;
  tenant_id: string;
  scenario_id: number | null;
  scenario_version_id: string | null;
  language: string;
  llm_model: string | null;
  worker_type: string;
  learner_turns: number;
  occurred_at: Date;
}

/** Every turn, both speakers, numbered from 1 — the debrief's anchors resolve to these. */
export interface DebriefTranscriptTurn {
  role: 'client' | 'counselor';
  text: string;
  turn_index: number;
}

export interface DebriefDimensionScore {
  dimension: DebriefQualityDimension;
  score: number;
  reasoning?: string | null;
}

export interface DebriefHardFail {
  code: string;
  evidence: string;
}

/** Raw aggregate for one group of scored debriefs; rates are applied in the service. */
export interface DebriefQualityAggregate {
  key: string;
  n: number;
  p25: number | null;
  p50: number | null;
  p75: number | null;
  passed: number;
  hard_failed: number;
}

/** The slice a summary can be cut by, and the SQL expression for each. */
const SLICE_KEY_SQL = {
  language: `COALESCE(scored."language", 'unknown')`,
  workerType: `COALESCE(scored."workerType", 'unknown')`,
  // Short sessions get the short recipe (fewer than 6 learner turns), so that
  // boundary is kept; the rest are split where length stops mattering.
  sessionLength: `CASE
      WHEN scored."learnerTurns" IS NULL THEN 'unknown'
      WHEN scored."learnerTurns" < 6 THEN '1-5 turns'
      WHEN scored."learnerTurns" <= 15 THEN '6-15 turns'
      WHEN scored."learnerTurns" <= 30 THEN '16-30 turns'
      ELSE '31+ turns' END`,
  debriefSource: `scored."debriefSource"`,
} as const;

export type DebriefQualitySlice = keyof typeof SLICE_KEY_SQL;

/**
 * Data access for the debrief-quality judge.
 *
 * Same division as the other judges: ally-be owns the data and does all
 * selection, assembly and persistence; ally-ai is a stateless judge that never
 * touches this database.
 */
@Injectable()
export class DebriefQualityRepository {
  constructor(private readonly dataSource: DataSource) {}

  /** The rubric from the Skills Store; null falls back to ally-ai's inline default. */
  async fetchRubric(): Promise<string | null> {
    const rows = await this.dataSource.query(
      `SELECT pv.prompt
         FROM prompts p
         JOIN prompts_versions pv
           ON pv."promptId" = p.id AND pv.version = p."currentVersion"
        WHERE p."promptCode" = 'debrief_quality_rubric'
        LIMIT 1`,
    );
    return rows?.[0]?.prompt ?? null;
  }

  /**
   * Sessions whose debrief can be scored: feedback with a supervisor note or a
   * positives list, AND transcript messages. Scoring a debrief against an
   * empty transcript would fail every accuracy check and manufacture a
   * quality crisis out of sessions where the agent never joined.
   */
  async selectSessions(opts: {
    sinceDays?: number | null;
    limit?: number | null;
    /** "Already judged" means judged under THIS pair; makes a re-run resumable. */
    unjudgedForVersion?: {
      judgeModel: string;
      judgePromptVersion: string;
    } | null;
    /** Scheduled runs only — see ScheduledSelection.honourAttemptLedger. */
    honourAttemptLedger?: boolean;
  }): Promise<DebriefQualitySessionRow[]> {
    const params: unknown[] = [];
    const p = (v: unknown) => {
      params.push(v);
      return `$${params.length}`;
    };

    let sql = `
      SELECT s.id,
             s.tenant_id AS tenant_id,
             s."scenarioId" AS scenario_id,
             s."scenarioVersionId" AS scenario_version_id,
             COALESCE(l.value, 'en') AS language,
             (SELECT mode() WITHIN GROUP (ORDER BY m."llmModel")
                FROM scenario_session_turn_metrics m
               WHERE m."scenarioSessionId" = s.id
                 AND m."llmModel" IS NOT NULL) AS llm_model,
             u.metadata AS user_metadata,
             (SELECT count(*)::int FROM scenario_session_messages m
               WHERE m."scenarioSessionId" = s.id AND m."senderId" <> -1) AS learner_turns,
             COALESCE(d."createdAt", s."createdAt") AS occurred_at
        FROM scenario_sessions s
        JOIN scenario_session_details d ON d."scenarioSessionId" = s.id
        LEFT JOIN users u ON u.id = s."counselorId"
        LEFT JOIN languages l
          ON l.id = NULLIF(s.metadata->>'languageId', '')::int
       WHERE s."roomId" NOT LIKE 'preview-%'
         AND s."roomId" NOT LIKE 'seed-room-%'
         AND (d.summary->'feedback' ? 'supervisorNote'
              OR d.summary->'feedback' ? 'supervisor_note'
              OR d.summary->'feedback' ? 'positives')
         AND ${settledEndedSessionPredicate('s')}
         AND ${excludeTestTenants('s."tenant_id"')}
         AND EXISTS (
           SELECT 1 FROM scenario_session_messages m
            WHERE m."scenarioSessionId" = s.id)`;

    if (opts.sinceDays != null) {
      sql += ` AND s."createdAt" >= now() - make_interval(days => ${p(
        opts.sinceDays,
      )})`;
    }
    if (opts.unjudgedForVersion) {
      sql += ` AND NOT EXISTS (
                 SELECT 1 FROM debrief_quality_judgment j
                  WHERE j."scenarioSessionId" = s.id
                    AND j."judgeModel" = ${p(opts.unjudgedForVersion.judgeModel)}
                    AND j."judgePromptVersion" = ${p(
                      opts.unjudgedForVersion.judgePromptVersion,
                    )})`;
    }
    if (opts.honourAttemptLedger) {
      sql += ` AND ${judgeAttemptGate(
        JudgeAttemptFamily.DEBRIEF_QUALITY,
        's.id',
        p,
      )}`;
    }
    sql += ` ORDER BY s."createdAt" DESC`;
    if (opts.limit) sql += ` LIMIT ${p(opts.limit)}`;

    const rows: Array<
      Omit<DebriefQualitySessionRow, 'worker_type'> & {
        user_metadata: Record<string, unknown> | null;
      }
    > = await this.dataSource.query(sql, params);
    return rows.map(({ user_metadata, ...r }) => ({
      ...r,
      learner_turns: Number(r.learner_turns ?? 0),
      worker_type: resolveWorkerType(user_metadata),
    }));
  }

  /**
   * The whole conversation, every turn numbered from 1, plus the map the
   * debrief's `[[msg:<id>]]` anchors resolve through.
   */
  async buildTranscript(sessionId: string): Promise<{
    turns: DebriefTranscriptTurn[];
    turnByMessageId: Map<number, number>;
  }> {
    const rows = await this.dataSource.query(
      `SELECT id, "senderId" AS sender_id, content
         FROM scenario_session_messages
        WHERE "scenarioSessionId" = $1
        ORDER BY "createdAt" ASC, id ASC`,
      [sessionId],
    );
    const turns: DebriefTranscriptTurn[] = [];
    const turnByMessageId = new Map<number, number>();
    for (const r of rows as Array<{
      id: number;
      sender_id: number;
      content: string;
    }>) {
      const text = (r.content ?? '').trim();
      if (!text) continue;
      const turnIndex = turns.length + 1;
      turnByMessageId.set(Number(r.id), turnIndex);
      turns.push({
        role: Number(r.sender_id) === -1 ? 'client' : 'counselor',
        text,
        turn_index: turnIndex,
      });
    }
    return { turns, turnByMessageId };
  }

  /** The debrief as the learner reads it, or null when there is none to score. */
  async buildDebrief(
    sessionId: string,
    turnByMessageId: Map<number, number>,
  ): Promise<RenderedDebrief | null> {
    const rows = await this.dataSource.query(
      `SELECT d.summary->'feedback' AS feedback
         FROM scenario_session_details d
        WHERE d."scenarioSessionId" = $1
        LIMIT 1`,
      [sessionId],
    );
    return renderDebrief(rows?.[0]?.feedback ?? null, turnByMessageId);
  }

  /**
   * The scored rows for one judge pair over a window, with the overall
   * computed by the same formula the TypeScript uses. Every summary query
   * reads from this, so they cannot disagree about what "scored" means.
   */
  private scoredCte(): string {
    return `
      WITH scored AS (
        SELECT j.*,
               ${debriefOverallSql('j')} AS overall,
               jsonb_array_length(COALESCE(j."hardFails", '[]'::jsonb)) > 0 AS has_hard_fail
          FROM debrief_quality_judgment j
         WHERE j."judgeModel" = $1
           AND j."judgePromptVersion" = $2
           AND j."occurredAt" >= now() - make_interval(days => $3)
           AND ${excludeTestTenants('j."tenant_id"')}
      )`;
  }

  /** Distribution, pass and hard-fail counts, overall or per slice. */
  async aggregate(
    pair: { judgeModel: string; judgePromptVersion: string },
    sinceDays: number,
    slice?: DebriefQualitySlice,
  ): Promise<DebriefQualityAggregate[]> {
    const key = slice ? SLICE_KEY_SQL[slice] : `'all'`;
    const rows = await this.dataSource.query(
      `${this.scoredCte()}
       SELECT ${key} AS key,
              count(*)::int AS n,
              percentile_cont(0.25) WITHIN GROUP (ORDER BY overall) AS p25,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY overall) AS p50,
              percentile_cont(0.75) WITHIN GROUP (ORDER BY overall) AS p75,
              count(*) FILTER (WHERE overall >= ${DEBRIEF_QUALITY_PASS} AND NOT has_hard_fail)::int AS passed,
              count(*) FILTER (WHERE has_hard_fail)::int AS hard_failed
         FROM scored
        GROUP BY 1
        ORDER BY n DESC`,
      [pair.judgeModel, pair.judgePromptVersion, sinceDays],
    );
    return rows.map((r: Record<string, unknown>) => ({
      key: String(r.key),
      n: Number(r.n),
      p25: r.p25 == null ? null : Number(r.p25),
      p50: r.p50 == null ? null : Number(r.p50),
      p75: r.p75 == null ? null : Number(r.p75),
      passed: Number(r.passed),
      hard_failed: Number(r.hard_failed),
    }));
  }

  /** Mean score per rubric dimension, in rubric order. */
  async dimensionMeans(
    pair: { judgeModel: string; judgePromptVersion: string },
    sinceDays: number,
  ): Promise<Array<{ dimension: string; mean: number | null }>> {
    const cols = DEBRIEF_QUALITY_DIMENSIONS.map(
      (d, i) => `round(avg("${d.column}")::numeric, 2) AS d${i}`,
    ).join(', ');
    const rows = await this.dataSource.query(
      `${this.scoredCte()} SELECT ${cols} FROM scored`,
      [pair.judgeModel, pair.judgePromptVersion, sinceDays],
    );
    const r = rows?.[0] ?? {};
    return DEBRIEF_QUALITY_DIMENSIONS.map((d, i) => ({
      dimension: d.dimension,
      mean: r[`d${i}`] == null ? null : Number(r[`d${i}`]),
    }));
  }

  /** How often each hard fail occurs, most frequent first. */
  async hardFailCounts(
    pair: { judgeModel: string; judgePromptVersion: string },
    sinceDays: number,
  ): Promise<Array<{ code: string; n: number }>> {
    const rows = await this.dataSource.query(
      `${this.scoredCte()}
       SELECT f->>'code' AS code, count(DISTINCT scored.id)::int AS n
         FROM scored, jsonb_array_elements(scored."hardFails") f
        GROUP BY 1
        ORDER BY n DESC, code`,
      [pair.judgeModel, pair.judgePromptVersion, sinceDays],
    );
    return rows.map((r: { code: string; n: number }) => ({
      code: r.code,
      n: Number(r.n),
    }));
  }

  /** Every judge pair with rows in the window; more than one means two series. */
  async judgeVersions(
    sinceDays: number,
  ): Promise<
    Array<{ judgeModel: string; judgePromptVersion: string; n: number }>
  > {
    const rows = await this.dataSource.query(
      `SELECT "judgeModel", "judgePromptVersion", count(*)::int AS n
         FROM debrief_quality_judgment
        WHERE "occurredAt" >= now() - make_interval(days => $1)
        GROUP BY 1, 2
        ORDER BY n DESC`,
      [sinceDays],
    );
    return rows.map(
      (r: { judgeModel: string; judgePromptVersion: string; n: number }) => ({
        ...r,
        n: Number(r.n),
      }),
    );
  }

  /**
   * Persist one scored debrief. Upsert on (session, judgeModel,
   * judgePromptVersion): a re-judge under the same version corrects itself in
   * place; a new rubric version writes alongside.
   */
  async upsertJudgment(
    session: DebriefQualitySessionRow,
    debrief: { text: string; source: DebriefSource; generator: string },
    dimensions: DebriefDimensionScore[],
    hardFails: DebriefHardFail[],
    judgeModel: string,
    judgePromptVersion: string,
  ): Promise<void> {
    const byDimension = new Map(dimensions.map((d) => [d.dimension, d]));
    const columns = DEBRIEF_QUALITY_DIMENSIONS.map((d) => d.column);
    const scores = DEBRIEF_QUALITY_DIMENSIONS.map((d) => {
      const s = byDimension.get(d.dimension);
      if (!s) throw new Error(`missing score for ${d.dimension}`);
      return s.score;
    });
    const reasoning = Object.fromEntries(
      dimensions.map((d) => [d.dimension, d.reasoning ?? '']),
    );

    const fixed = [
      session.tenant_id,
      session.id,
      debrief.source,
      debrief.generator,
    ];
    const tail = [
      JSON.stringify(hardFails),
      JSON.stringify(reasoning),
      debrief.text,
      session.language,
      session.worker_type,
      session.learner_turns,
      session.scenario_id,
      session.scenario_version_id,
      session.llm_model,
      session.occurred_at,
      judgeModel,
      judgePromptVersion,
    ];
    const values = [...fixed, ...scores, ...tail];
    const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
    const scoreCols = columns.map((c) => `"${c}"`).join(', ');
    const updates = [
      ...columns.map((c) => `"${c}" = EXCLUDED."${c}"`),
      `"hardFails" = EXCLUDED."hardFails"`,
      `"reasoning" = EXCLUDED."reasoning"`,
      `"debriefText" = EXCLUDED."debriefText"`,
      `"debriefSource" = EXCLUDED."debriefSource"`,
      `"updatedAt" = now()`,
    ].join(', ');

    await this.dataSource.query(
      `INSERT INTO debrief_quality_judgment (
         "tenant_id", "scenarioSessionId", "debriefSource", "generator",
         ${scoreCols},
         "hardFails", "reasoning", "debriefText", "language", "workerType",
         "learnerTurns", "scenarioId", "scenarioVersionId", "llmModel",
         "occurredAt", "judgeModel", "judgePromptVersion"
       ) VALUES (${placeholders})
       ON CONFLICT ("scenarioSessionId", "judgeModel", "judgePromptVersion")
       DO UPDATE SET ${updates}`,
      values,
    );
  }
}
