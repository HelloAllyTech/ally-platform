import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { DataSource } from 'typeorm';
import { LoggerService } from '../../logger/logger.service';
import { excludeTestTenants } from '../../analytics/util/test-tenant.util';
import { settledEndedSessionPredicate } from '../../analytics/util/session-eligibility.util';
import { debriefOverallSql } from '../../analytics/constants/debrief-quality.constants';
import { DEBRIEF_AGENT_KEY } from '../constants/debrief-release.constants';

/**
 * The three test sets, built from real sessions (plan §9.5).
 *
 * - **open**: the Improver screens ideas on it and sees the results.
 * - **gate**: decides whether a change may reach learners; the Improver sees
 *   only pass or fail, never per-case results.
 * - **sealed**: never shown to the Improver; drills and the launch check only,
 *   so it stays a fair measure of whether improvements generalise.
 *
 * Stored in the agent harness's `agent_eval_suites` / `agent_eval_cases`
 * under agentKey `debrief`. A case references a session rather than copying
 * its transcript: replays read the transcript where it lives, and a deleted
 * session simply drops out of its set.
 */
export enum DebriefTestSet {
  OPEN = 'debrief_open',
  GATE = 'debrief_gate',
  SEALED = 'debrief_sealed',
}

const SUITE_NAMES: Record<DebriefTestSet, string> = {
  [DebriefTestSet.OPEN]: 'Debrief: open set (Improver screens)',
  [DebriefTestSet.GATE]: 'Debrief: gate set (release decisions)',
  [DebriefTestSet.SEALED]: 'Debrief: sealed set (drills, launch)',
};

/** Split by a hash of the session id, so a session's set never changes. */
export function setForSession(sessionId: string): DebriefTestSet {
  const n =
    parseInt(
      createHash('sha256').update(sessionId).digest('hex').slice(0, 8),
      16,
    ) % 100;
  if (n < 60) return DebriefTestSet.OPEN;
  if (n < 85) return DebriefTestSet.GATE;
  return DebriefTestSet.SEALED;
}

export function lengthBand(learnerTurns: number): string {
  if (learnerTurns < 6) return '1-5';
  if (learnerTurns <= 15) return '6-15';
  if (learnerTurns <= 30) return '16-30';
  return '31+';
}

/** Per stratum (language × length × today's quality band), at most this many sessions. */
const PER_STRATUM = 6;

@Injectable()
export class DebriefTestSetsService {
  private readonly logger = LoggerService.getInstance(
    DebriefTestSetsService.name,
  );

  constructor(private readonly dataSource: DataSource) {}

  private async ensureSuites(): Promise<Record<DebriefTestSet, string>> {
    const ids = {} as Record<DebriefTestSet, string>;
    for (const key of Object.values(DebriefTestSet)) {
      const rows = await this.dataSource.query(
        `INSERT INTO agent_eval_suites ("agentKey", key, name, kind)
         VALUES ($1, $2, $3, 'regression')
         ON CONFLICT ("agentKey", key) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [DEBRIEF_AGENT_KEY, key, SUITE_NAMES[key]],
      );
      ids[key] = rows[0].id;
    }
    return ids;
  }

  /**
   * Add real sessions to the sets, stratified so every language, session
   * length and quality band of today's debriefs is represented. Today's
   * band comes from the independent judge's baseline when it has scored the
   * session. Idempotent: a session already in a set is skipped.
   */
  async build(opts: { sinceDays?: number } = {}): Promise<{
    added: Record<DebriefTestSet, number>;
    total: Record<DebriefTestSet, number>;
  }> {
    const suites = await this.ensureSuites();
    const rows: Array<{
      id: string;
      tenant_id: string | null;
      language: string;
      learner_turns: number;
      band: string;
    }> = await this.dataSource.query(
      `WITH candidates AS (
         SELECT s.id, s.tenant_id,
                COALESCE(l.value, 'en') AS language,
                (SELECT count(*)::int FROM scenario_session_messages m
                  WHERE m."scenarioSessionId" = s.id AND m."senderId" <> -1) AS learner_turns,
                COALESCE((
                  SELECT CASE WHEN j_overall < 5 THEN 'low'
                              WHEN j_overall < 8 THEN 'mid' ELSE 'high' END
                    FROM (SELECT ${debriefOverallSql('j')} AS j_overall
                            FROM debrief_quality_judgment j
                           WHERE j."scenarioSessionId" = s.id
                           ORDER BY j."createdAt" DESC LIMIT 1) x), 'unscored') AS band
           FROM scenario_sessions s
           LEFT JOIN languages l ON l.id = NULLIF(s.metadata->>'languageId', '')::int
          WHERE ${settledEndedSessionPredicate('s')}
            AND s."createdAt" >= now() - make_interval(days => $1)
            AND s."roomId" NOT LIKE 'preview-%'
            AND s."roomId" NOT LIKE 'seed-room-%'
            AND ${excludeTestTenants('s."tenant_id"')}
       )
       SELECT * FROM (
         SELECT c.*, row_number() OVER (
                  PARTITION BY c.language,
                    CASE WHEN c.learner_turns < 6 THEN 1 WHEN c.learner_turns <= 15 THEN 2
                         WHEN c.learner_turns <= 30 THEN 3 ELSE 4 END,
                    c.band
                  ORDER BY md5(c.id::text)) AS rn
           FROM candidates c
          WHERE c.learner_turns > 0
       ) ranked
       WHERE rn <= $2`,
      [opts.sinceDays ?? 120, PER_STRATUM * 2],
    );

    const added = {
      [DebriefTestSet.OPEN]: 0,
      [DebriefTestSet.GATE]: 0,
      [DebriefTestSet.SEALED]: 0,
    };
    for (const r of rows) {
      const set = setForSession(r.id);
      const hash = createHash('sha256')
        .update(`debrief-case:${r.id}`)
        .digest('hex');
      const res = await this.dataSource.query(
        `INSERT INTO agent_eval_cases
           ("agentKey", "suiteId", source, status, category, safety, title,
            input, expectations, "contentHash", tenant_id)
         VALUES ($1, $2, 'trace', 'active', $3, false, $4, $5, '{}'::jsonb, $6, $7)
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [
          DEBRIEF_AGENT_KEY,
          suites[set],
          `${r.language}/${lengthBand(r.learner_turns)}`.slice(0, 40),
          `Session ${r.id.slice(0, 8)} · ${r.language} · ${r.learner_turns} turns · today's debrief: ${r.band}`,
          JSON.stringify({
            scenarioSessionId: r.id,
            language: r.language,
            learnerTurns: r.learner_turns,
            baselineBand: r.band,
          }),
          hash,
          r.tenant_id,
        ],
      );
      if (res.length) added[set]++;
    }
    const total = await this.counts();
    this.logger.info(
      `[debrief] test sets built: added ${JSON.stringify(added)}, totals ${JSON.stringify(total)}`,
    );
    return { added, total };
  }

  async counts(): Promise<Record<DebriefTestSet, number>> {
    const rows: Array<{ key: DebriefTestSet; n: number }> =
      await this.dataSource.query(
        `SELECT su.key, count(c.id)::int AS n
           FROM agent_eval_suites su
           LEFT JOIN agent_eval_cases c ON c."suiteId" = su.id AND c.status = 'active'
          WHERE su."agentKey" = $1
          GROUP BY su.key`,
        [DEBRIEF_AGENT_KEY],
      );
    const out = {
      [DebriefTestSet.OPEN]: 0,
      [DebriefTestSet.GATE]: 0,
      [DebriefTestSet.SEALED]: 0,
    };
    for (const r of rows) out[r.key] = r.n;
    return out;
  }

  /** Session ids in one set, in a stable order, still present in the database. */
  async sessions(set: DebriefTestSet, limit: number): Promise<string[]> {
    const rows = await this.dataSource.query(
      `SELECT c.input->>'scenarioSessionId' AS id
         FROM agent_eval_cases c
         JOIN agent_eval_suites su ON su.id = c."suiteId"
         JOIN scenario_sessions s ON s.id = (c.input->>'scenarioSessionId')::uuid
        WHERE su."agentKey" = $1 AND su.key = $2 AND c.status = 'active'
        ORDER BY c."contentHash"
        LIMIT $3`,
      [DEBRIEF_AGENT_KEY, set, limit],
    );
    return rows.map((r: { id: string }) => r.id);
  }
}
