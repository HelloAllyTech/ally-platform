import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { DebriefQualityRepository } from '../../analytics/repository/debrief-quality.repository';
import { resolveWorkerType } from '../../user/enum/user.enum';
import { TranscriptTurn } from '../util/debrief-cards.util';

export interface DebriefSessionContext {
  id: string;
  tenantId: string | null;
  counselorId: number | null;
  status: string;
  language: string;
  learnerLevel: string;
  learnerTurns: number;
  scenario: { title: string | null; description: string | null };
  expectedBehaviours: string[];
}

/**
 * Everything a run reads about a session, its learner and the prompts it runs.
 * The transcript is built exactly as the independent judge builds it, so the
 * Writer's turn numbers and the judge's are the same numbers.
 */
@Injectable()
export class DebriefContextRepository {
  private readonly transcripts: DebriefQualityRepository;

  constructor(private readonly dataSource: DataSource) {
    this.transcripts = new DebriefQualityRepository(dataSource);
  }

  async loadSession(sessionId: string): Promise<DebriefSessionContext | null> {
    const rows = await this.dataSource.query(
      `SELECT s.id, s.tenant_id, s."counselorId" AS counselor_id, s.status,
              COALESCE(l.value, 'en') AS language,
              u.metadata AS user_metadata,
              sc.title, sc.description, sc."competencyIds" AS competency_ids,
              (SELECT count(*)::int FROM scenario_session_messages m
                WHERE m."scenarioSessionId" = s.id AND m."senderId" <> -1) AS learner_turns
         FROM scenario_sessions s
         LEFT JOIN users u ON u.id = s."counselorId"
         LEFT JOIN scenarios sc ON sc.id = s."scenarioId"
         LEFT JOIN languages l ON l.id = NULLIF(s.metadata->>'languageId', '')::int
        WHERE s.id = $1`,
      [sessionId],
    );
    const r = rows?.[0];
    if (!r) return null;
    const ids: string[] = Array.isArray(r.competency_ids)
      ? r.competency_ids
      : [];
    const competencies = ids.length
      ? await this.dataSource.query(
          `SELECT name FROM competencies WHERE id = ANY($1::uuid[]) ORDER BY name`,
          [ids],
        )
      : [];
    return {
      id: r.id,
      tenantId: r.tenant_id ?? null,
      counselorId: r.counselor_id ?? null,
      status: r.status,
      language: String(r.language || 'en').slice(0, 10),
      learnerLevel: resolveWorkerType(r.user_metadata),
      learnerTurns: Number(r.learner_turns ?? 0),
      scenario: { title: r.title ?? null, description: r.description ?? null },
      expectedBehaviours: competencies.map((c: { name: string }) => c.name),
    };
  }

  async transcript(sessionId: string): Promise<TranscriptTurn[]> {
    const { turns } = await this.transcripts.buildTranscript(sessionId);
    return turns;
  }

  /** The learner's last few Work-on-this points, newest first, for the Progress reader. */
  async pastWorkOnThis(
    counselorId: number,
    tenantId: string | null,
    beforeSessionId: string,
    limit = 5,
  ): Promise<Array<{ date: string; skill: string; point: string }>> {
    const rows = await this.dataSource.query(
      `SELECT r."createdAt", r.cards->'work_on_this' AS wot
         FROM debrief_runs r
         JOIN scenario_sessions s ON s.id = r."scenarioSessionId"
        WHERE s."counselorId" = $1
          AND s.tenant_id IS NOT DISTINCT FROM $2
          AND r."scenarioSessionId" <> $3
          AND r.mode IN ('shadow','live')
          AND r.status IN ('published','below_bar')
        ORDER BY r."createdAt" DESC
        LIMIT $4`,
      [counselorId, tenantId, beforeSessionId, limit],
    );
    const out: Array<{ date: string; skill: string; point: string }> = [];
    for (const r of rows) {
      for (const c of (r.wot ?? []) as Array<{
        skill?: string;
        lead?: string;
      }>) {
        if (c?.lead) {
          out.push({
            date: new Date(r.createdAt).toISOString().slice(0, 10),
            skill: c.skill ?? '',
            point: c.lead,
          });
        }
      }
    }
    return out;
  }

  /**
   * Prompt text by code, at a pinned version or the store's current one.
   * Null when the store has no such prompt: ally-ai then uses its default.
   */
  async promptText(
    code: string,
    version: number | null,
  ): Promise<string | null> {
    const rows = await this.dataSource.query(
      `SELECT pv.prompt
         FROM prompts p
         JOIN prompts_versions pv ON pv."promptId" = p.id
        WHERE p."promptCode" = $1
          AND pv.version = COALESCE($2::int, p."currentVersion")
        LIMIT 1`,
      [code, version],
    );
    return rows?.[0]?.prompt ?? null;
  }

  /** Production spend and volume so far this month, for the pool. */
  async monthToDate(): Promise<{ sessions: number; spentUsd: number }> {
    const rows = await this.dataSource.query(
      `SELECT count(*) FILTER (WHERE status <> 'skipped')::int AS sessions,
              COALESCE(sum(COALESCE("actualCostUsd", "estimatedCostUsd")), 0)::float AS spent
         FROM debrief_runs
        WHERE mode IN ('shadow','live')
          AND "createdAt" >= date_trunc('month', now())`,
    );
    return {
      sessions: Number(rows?.[0]?.sessions ?? 0),
      spentUsd: Number(rows?.[0]?.spent ?? 0),
    };
  }
}
