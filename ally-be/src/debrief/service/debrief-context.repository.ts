import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { DebriefQualityRepository } from '../../analytics/repository/debrief-quality.repository';
import { resolveWorkerType } from '../../user/enum/user.enum';
import { TranscriptTurn } from '../util/debrief-cards.util';
import { guidancePassage } from '../util/debrief-guidance.util';
import { ClChunk } from '../../context-library/entity/cl-chunk.entity';
import {
  DEBRIEF_AGENT_KEY,
  DebriefProvider,
} from '../constants/debrief-release.constants';
import { allowlistFromValues } from '../util/debrief-provider-allowlist.util';
import { istMonth } from '../util/debrief-pm-reports.util';

export interface DebriefSessionContext {
  id: string;
  tenantId: string | null;
  counselorId: number | null;
  status: string;
  language: string;
  learnerLevel: string;
  learnerTurns: number;
  /** Null for a session whose scenario row is gone. */
  scenarioId: number | null;
  scenario: { title: string | null; description: string | null };
  expectedBehaviours: string[];
  /** Played for a course roleplay item in assessment mode: a graded attempt. */
  assessment: boolean;
  /** Played as one session of a case: earlier sessions are the client's memory. */
  inCase: boolean;
  /** False when the session recorded no language and `language` is only a default. */
  languageRecorded: boolean;
}

/** One event the live detector watched for during the roleplay. */
export interface LiveDetection {
  behaviour: string;
  description?: string;
  detected: boolean;
  times: number;
}

/** No cohort view below this many other trainees (v9 FR-17: minimum group 5). */
export const COHORT_MIN_LEARNERS = 5;

export interface CohortStats {
  /** Deliberately not a count: the Writer must never give one. */
  trainees: 'five or more';
  skills: Array<{ skill: string; how_often: string }>;
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
              l.value IS NOT NULL AS language_recorded,
              u.metadata AS user_metadata,
              s."scenarioId" AS scenario_id,
              sc.title, sc.description, sc."competencyIds" AS competency_ids,
              s."caseSessionItemId" IS NOT NULL AS in_case,
              COALESCE((ti."completionCriteria"->>'assessmentMode')::boolean, false) AS assessment,
              -- PRD §6.1: a blank line (an empty transcription) is not a
              -- learner turn; the transcript the Writer reads skips it too.
              (SELECT count(*)::int FROM scenario_session_messages m
                WHERE m."scenarioSessionId" = s.id AND m."senderId" <> -1
                  AND btrim(m.content) <> '') AS learner_turns
         FROM scenario_sessions s
         LEFT JOIN users u ON u.id = s."counselorId"
         LEFT JOIN scenarios sc ON sc.id = s."scenarioId"
         LEFT JOIN languages l ON l.id = NULLIF(s.metadata->>'languageId', '')::int
         LEFT JOIN track_item_progress tip ON tip.id = s."trackItemProgressId"
         LEFT JOIN track_items ti ON ti.id = tip."trackItemId"
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
      scenarioId: r.scenario_id == null ? null : Number(r.scenario_id),
      scenario: { title: r.title ?? null, description: r.description ?? null },
      expectedBehaviours: competencies.map((c: { name: string }) => c.name),
      assessment: r.assessment === true,
      inCase: r.in_case === true,
      languageRecorded: r.language_recorded === true,
    };
  }

  /**
   * The case's memory before this session: what the client carries from the
   * learner's earlier sessions in the same case, read as the roleplay read it
   * (the agent's end-of-session memory, else the legacy cumulative memory).
   */
  async caseMemory(sessionId: string): Promise<string | null> {
    const rows: Array<{ mem: string | null; cum: string | null }> =
      await this.dataSource.query(
        `SELECT d."sessionMemory"->>'summary' AS mem,
                d.summary->'feedback'->>'cumulativeMemory' AS cum
           FROM scenario_sessions s
           JOIN case_session_items ci ON ci.id = s."caseSessionItemId"
           JOIN case_session_items ci2 ON ci2."caseSessionId" = ci."caseSessionId"
           JOIN scenario_sessions s2 ON s2."caseSessionItemId" = ci2.id
           LEFT JOIN scenario_session_details d ON d."scenarioSessionId" = s2.id
          WHERE s.id = $1 AND s2.id <> s.id
            AND s2."endedAt" IS NOT NULL
            AND s2."endedAt" <= COALESCE(s."startedAt", s."createdAt")
          ORDER BY s2."endedAt" DESC
          LIMIT 3`,
        [sessionId],
      );
    for (const r of rows ?? []) {
      const memory = (r.mem ?? '').trim() || (r.cum ?? '').trim();
      if (memory) return memory;
    }
    return null;
  }

  /**
   * What the live detector recorded during the roleplay (v9 FR-17
   * get_live_detections): each event the scenario watches for, and any other
   * that fired in this session, with how often it fired. A second opinion for the Analyst, never ground
   * truth. Empty when the scenario watches for nothing.
   */
  async liveDetections(
    sessionId: string,
    scenarioId: number | null,
  ): Promise<LiveDetection[]> {
    const rows: Array<{
      name: string;
      description: string | null;
      fired: number;
    }> = await this.dataSource.query(
      `SELECT e.name, e.description, count(sse.id)::int AS fired
         FROM session_events e
         LEFT JOIN scenario_session_events sse
           ON sse."eventId" = e.id AND sse."scenarioSessionId" = $1
        WHERE e."deletedAt" IS NULL
          AND (sse.id IS NOT NULL
               OR e.id IN (SELECT se."eventId" FROM scenario_events se
                            WHERE se."scenarioId" = $2 AND se."deletedAt" IS NULL))
        GROUP BY e.id, e.name, e.description
        ORDER BY e.name
        LIMIT 30`,
      [sessionId, scenarioId ?? -1],
    );
    return (rows ?? []).map((r) => ({
      behaviour: r.name,
      ...(r.description ? { description: r.description.slice(0, 300) } : {}),
      detected: Number(r.fired) > 0,
      times: Number(r.fired) || 0,
    }));
  }

  /**
   * How the organisation's other trainees did on this roleplay (v9 FR-17
   * get_cohort_stats): per expected behaviour, how often trainees who had the
   * chance showed it, from each trainee's latest debrief in the last 90 days.
   * Words, never numbers, so no share can reach a learner; null under
   * COHORT_MIN_LEARNERS other trainees, so no one's result can be singled out.
   */
  async cohortStats(
    session: Pick<
      DebriefSessionContext,
      'id' | 'tenantId' | 'scenarioId' | 'counselorId' | 'expectedBehaviours'
    >,
  ): Promise<CohortStats | null> {
    if (!session.tenantId || session.scenarioId == null) return null;
    const wanted = new Map(
      session.expectedBehaviours.map((b) => [b.trim().toLowerCase(), b]),
    );
    if (wanted.size === 0) return null;
    const rows: Array<{
      learners: number;
      skill: string | null;
      chances: number;
      observed: number;
    }> = await this.dataSource.query(
      `WITH latest AS (
         SELECT DISTINCT ON (s."counselorId") s."counselorId" AS cid,
                r.workspace->'evidence'->'behaviours' AS b
           FROM debrief_runs r
           JOIN scenario_sessions s ON s.id = r."scenarioSessionId"
          WHERE s."scenarioId" = $1
            AND s.tenant_id = $2
            AND s."counselorId" IS NOT NULL
            AND s."counselorId" IS DISTINCT FROM $3
            AND r."scenarioSessionId" <> $4
            AND r.mode IN ('shadow','live')
            AND r.status IN ('published','below_bar')
            AND r."createdAt" > now() - interval '90 days'
          ORDER BY s."counselorId", r."createdAt" DESC
       )
       SELECT (SELECT count(*)::int FROM latest) AS learners,
              lower(trim(x->>'skill')) AS skill,
              count(*) FILTER (WHERE x->>'opportunity' = 'true')::int AS chances,
              count(*) FILTER (WHERE x->>'opportunity' = 'true'
                                 AND x->>'observation' = 'observed')::int AS observed
         FROM latest
         LEFT JOIN LATERAL jsonb_array_elements(
           CASE WHEN jsonb_typeof(latest.b) = 'array' THEN latest.b ELSE '[]'::jsonb END
         ) x ON true
        GROUP BY 2`,
      [session.scenarioId, session.tenantId, session.counselorId, session.id],
    );
    const learners = Number(rows?.[0]?.learners ?? 0);
    if (learners < COHORT_MIN_LEARNERS) return null;
    const skills: CohortStats['skills'] = [];
    for (const r of rows) {
      const name = r.skill ? wanted.get(r.skill) : undefined;
      if (!name || Number(r.chances) < COHORT_MIN_LEARNERS) continue;
      const share = Number(r.observed) / Number(r.chances);
      skills.push({
        skill: name,
        how_often:
          share >= 2 / 3
            ? 'most trainees show this'
            : share <= 1 / 3
              ? 'few trainees show this'
              : 'about half of trainees show this',
      });
    }
    return skills.length ? { trainees: 'five or more', skills } : null;
  }

  async transcript(sessionId: string): Promise<TranscriptTurn[]> {
    const { turns } = await this.transcripts.buildTranscript(sessionId);
    return turns;
  }

  /**
   * The organisation's own words for Ask Ally (from its Guide profile):
   * who their supervisor is, how to refer to them, its procedures and tone.
   * Null when it has set none.
   */
  async orgWording(tenantId: string): Promise<string | null> {
    const [row] = await this.dataSource.query(
      `SELECT profile FROM guide_org_profiles WHERE tenant_id = $1`,
      [tenantId],
    );
    const p = (row?.profile ?? {}) as Record<string, unknown>;
    const text = (v: unknown) =>
      typeof v === 'string' && v.trim() ? v.trim() : null;
    const lines = [
      text(p.supervisorWording) &&
        `How to refer to their supervisor: ${text(p.supervisorWording)}`,
      text(p.supervisorContact) &&
        `Supervisor contact: ${text(p.supervisorContact)}`,
      text(p.protocols) && `Procedures: ${text(p.protocols)}`,
      text(p.toneNotes) && `Tone: ${text(p.toneNotes)}`,
      Array.isArray(p.avoidTopics) && p.avoidTopics.length
        ? `Topics to avoid: ${(p.avoidTopics as string[]).join(', ')}`
        : null,
    ].filter(Boolean) as string[];
    return lines.length ? lines.join('\n').slice(0, 1500) : null;
  }

  /**
   * What the orchestrator's planner may build on (spec A5), as cheap counts:
   * the organisation's protocols in Debrief Guidance, the learner's past
   * debriefs, whether five or more other trainees in the organisation have
   * debriefs (cohort data), and whether the session belongs to a course.
   * Never a learner's words.
   */
  async availability(
    session: Pick<DebriefSessionContext, 'id' | 'tenantId' | 'counselorId'>,
  ): Promise<{
    org_protocols: number;
    past_debriefs: number;
    cohort: boolean;
    course: boolean;
  }> {
    const [r] = await this.dataSource.query(
      `SELECT
         (SELECT count(*)::int FROM cl_chunks c
           WHERE c.collection_id = 'debrief_guidance' AND c.status = 'active'
             AND c.facets->>'kind' = 'protocol'
             AND $1::text IS NOT NULL
             AND (c.owner_tenant_id::text = $1::text OR $1::text = ANY(c.tenant_ids))) AS org_protocols,
         (SELECT count(*)::int FROM debrief_runs r
            JOIN scenario_sessions s ON s.id = r."scenarioSessionId"
           WHERE s."counselorId" = $2 AND s.tenant_id IS NOT DISTINCT FROM $1::text
             AND r."scenarioSessionId" <> $3
             AND r.mode IN ('shadow','live') AND r.status IN ('published','below_bar')) AS past_debriefs,
         (SELECT count(DISTINCT s."counselorId")::int FROM debrief_runs r
            JOIN scenario_sessions s ON s.id = r."scenarioSessionId"
           WHERE s.tenant_id = $1::text AND s."counselorId" IS DISTINCT FROM $2
             AND r.mode IN ('shadow','live') AND r.status IN ('published','below_bar')
             AND r."createdAt" > now() - interval '90 days') AS peers,
         (SELECT ti."trackId" IS NOT NULL FROM scenario_sessions s
            LEFT JOIN track_item_progress tip ON tip.id = s."trackItemProgressId"
            LEFT JOIN track_items ti ON ti.id = tip."trackItemId"
           WHERE s.id = $3) AS course`,
      [session.tenantId, session.counselorId ?? -1, session.id],
    );
    return {
      org_protocols: Number(r?.org_protocols ?? 0),
      past_debriefs: session.counselorId ? Number(r?.past_debriefs ?? 0) : 0,
      cohort: Number(r?.peers ?? 0) >= COHORT_MIN_LEARNERS,
      course: r?.course === true,
    };
  }

  /**
   * The organisation's own protocols (spec A4 `get_org_protocols`): its
   * Debrief Guidance entries with facet kind `protocol`, read the way every
   * Debrief prompt reads a passage, plus the procedures in its Guide profile.
   * Organisation-scoped: global guidance is never a protocol here.
   */
  async orgProtocols(tenantId: string | null): Promise<{
    protocols: Array<{ code: string; title: string; text: string }>;
    procedures: string | null;
  }> {
    if (!tenantId) return { protocols: [], procedures: null };
    const rows: ClChunk[] = await this.dataSource.query(
      `SELECT code, statement, body, citation, attributes, facets
         FROM cl_chunks
        WHERE collection_id = 'debrief_guidance' AND status = 'active'
          AND facets->>'kind' = 'protocol'
          AND (owner_tenant_id::text = $1 OR $1 = ANY(tenant_ids))
        ORDER BY pinned DESC, code
        LIMIT 20`,
      [tenantId],
    );
    const [profile] = await this.dataSource.query(
      `SELECT profile->>'protocols' AS protocols FROM guide_org_profiles WHERE tenant_id = $1`,
      [tenantId],
    );
    const procedures = String(profile?.protocols ?? '').trim();
    return {
      protocols: (rows ?? []).map((c) => {
        const { title, text } = guidancePassage(c);
        return { code: c.code, title, text: text.slice(0, 1500) };
      }),
      procedures: procedures ? procedures.slice(0, 1500) : null,
    };
  }

  /**
   * The learner's last debriefs (spec A4 `get_learner_history`), newest first:
   * Work-on-this points, strengths and skill words per session. No quotes and
   * no transcript; only this learner, in this organisation.
   */
  async learnerHistory(
    counselorId: number,
    tenantId: string | null,
    beforeSessionId: string,
    limit = 8,
  ): Promise<
    Array<{
      date: string;
      recipe: string | null;
      work_on_this: Array<{ skill: string; point: string }>;
      strengths: string[];
      skills: Array<{ skill: string; word: string }>;
    }>
  > {
    const rows: Array<{
      createdAt: Date;
      recipeKey: string | null;
      cards: Record<string, any> | null;
    }> = await this.dataSource.query(
      `SELECT r."createdAt", r."recipeKey", r.cards
         FROM debrief_runs r
         JOIN scenario_sessions s ON s.id = r."scenarioSessionId"
        WHERE s."counselorId" = $1
          AND s.tenant_id IS NOT DISTINCT FROM $2
          AND r."scenarioSessionId" <> $3
          AND r.mode IN ('shadow','live')
          AND r.status IN ('published','below_bar')
        ORDER BY r."createdAt" DESC
        LIMIT $4`,
      [
        counselorId,
        tenantId,
        beforeSessionId,
        Math.max(1, Math.min(limit, 12)),
      ],
    );
    const list = (v: unknown): Array<Record<string, any>> =>
      Array.isArray(v) ? v : [];
    return (rows ?? []).map((r) => ({
      date: new Date(r.createdAt).toISOString().slice(0, 10),
      recipe: r.recipeKey ?? null,
      work_on_this: list(r.cards?.work_on_this)
        .filter((c) => c?.lead)
        .map((c) => ({ skill: String(c.skill ?? ''), point: String(c.lead) })),
      strengths: list(r.cards?.what_worked)
        .map((c) => String(c?.skill ?? ''))
        .filter(Boolean),
      skills: list(r.cards?.skill_words)
        .filter((c) => c?.skill && c?.word)
        .map((c) => ({ skill: String(c.skill), word: String(c.word) })),
    }));
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

  /** Each prompt's version live in the Skills Store now, by code (codes not in the store are left out). */
  async currentPromptVersions(
    codes: string[],
  ): Promise<Record<string, number>> {
    if (!codes.length) return {};
    const rows: Array<{ code: string; v: number | null }> =
      await this.dataSource.query(
        `SELECT "promptCode" AS code, "currentVersion" AS v FROM prompts WHERE "promptCode" = ANY($1)`,
        [codes],
      );
    const out: Record<string, number> = {};
    for (const r of rows) if (r.v != null) out[r.code] = Number(r.v);
    return out;
  }

  /**
   * Record, once, the exact Skills Store version of every prompt a release
   * left unpinned (plan §8.8), in `changeSet` beside the bundle so the
   * bundle and its content hash never change. Never overwrites.
   */
  async recordPromptPins(
    releaseId: string,
    pins: Record<string, number>,
    source: 'created' | 'go_live' | 'migration',
  ): Promise<void> {
    await this.dataSource.query(
      `UPDATE agent_releases
          SET "changeSet" = coalesce("changeSet", '{}'::jsonb)
                || jsonb_build_object('pinnedPrompts', $2::jsonb, 'pinSource', $3::text,
                                      'pinnedAt', now()::text)
        WHERE id = $1 AND NOT (coalesce("changeSet", '{}'::jsonb) ? 'pinnedPrompts')`,
      [releaseId, JSON.stringify(pins), source],
    );
  }

  /**
   * The organisation's model-provider allowlist (plan §8.9, FR-57): every
   * approved provider unless the owner restricted it. Unreadable reads as
   * "nothing allowed" — a run then waits for a person rather than reaching a
   * provider the contract may forbid.
   */
  async providerAllowlist(
    tenantId: string | null | undefined,
  ): Promise<DebriefProvider[]> {
    if (!tenantId) return allowlistFromValues(null);
    try {
      const [row] = await this.dataSource.query(
        `SELECT "values" FROM agent_config_overrides
          WHERE "agentKey" = $1 AND layer = 'org' AND "scopeId" = $2`,
        [DEBRIEF_AGENT_KEY, tenantId],
      );
      return allowlistFromValues(row?.values ?? null);
    } catch {
      return [];
    }
  }

  /** Production spend and volume so far this month, for the pool. */
  async monthToDate(): Promise<{ sessions: number; spentUsd: number }> {
    const rows = await this.dataSource.query(
      `SELECT count(*) FILTER (WHERE status <> 'skipped')::int AS sessions,
              COALESCE(sum(COALESCE("actualCostUsd", "estimatedCostUsd")), 0)::float AS spent
         FROM debrief_runs
        WHERE mode IN ('shadow','live')
          AND "createdAt" >= $1::timestamptz`,
      [istMonth().from.toISOString()],
    );
    return {
      sessions: Number(rows?.[0]?.sessions ?? 0),
      spentUsd: Number(rows?.[0]?.spent ?? 0),
    };
  }
}
