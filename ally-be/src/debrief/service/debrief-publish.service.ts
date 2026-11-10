import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  SCENARIO_SESSION_DEBRIEF_READY_EVENT,
  ScenarioSessionDebriefReadyEvent,
} from '../../learn/constants/scenario-session-events.constants';
import { LearnerSupervisorMemoryService } from '../../learn/service/learner-supervisor-memory.service';
import { LoggerService } from '../../logger/logger.service';
import { DebriefRun } from '../entity/debrief-run.entity';
import { DebriefRunMode, DebriefRunStatus } from '../enum/debrief-run.enum';
import { DebriefCards } from '../util/debrief-cards.util';
import {
  areasOfGrowthFromCards,
  claimsFromCards,
  emotionalMovementFromEvidence,
  DebriefGeneratorStamp,
  memoryUpdateFromCards,
  renderSupervisorNote,
  skillCoverageFromEvidence,
} from '../util/debrief-publish.util';

/** The debrief a learner can read: a live run that was published, above or below the bar. */
const READABLE = new Set<string>([
  DebriefRunStatus.PUBLISHED,
  DebriefRunStatus.BELOW_BAR,
]);

/**
 * v9 FR-20 Publish, FR-42 analytics continuity, FR-45 the post-session judges
 * on the new note, and FR-4: for an organisation switched on for the Debrief
 * agent, today's debrief no longer runs, so a readable live run writes the
 * session's whole debrief where today's did — the note (in today's sectioned
 * format, with message anchors), strengths, points and growth areas, skill
 * coverage computed from its evidence map, emotional movement, a case's
 * memory, the note's language and a generator stamp — and the learner's
 * supervisor memory and the "debrief ready" event come from it.
 *
 * Feedback today's debrief wrote before (a session from before the switch)
 * is merged over, its note and skill coverage kept once on the run as
 * `workspace.legacyNote`. Every write is idempotent, so publishing again
 * (a person publishing, a card corrected) only refreshes the fields.
 */
@Injectable()
export class DebriefPublishService {
  private readonly logger = LoggerService.getInstance(
    DebriefPublishService.name,
  );

  constructor(
    @InjectRepository(DebriefRun)
    private readonly runs: Repository<DebriefRun>,
    private readonly memory: LearnerSupervisorMemoryService,
    private readonly events: EventEmitter2,
  ) {}

  /**
   * Write a readable live run's debrief into the session. `announce` fires
   * the memory update and the ready event; a re-apply after today's debrief
   * overwrote the summary does not repeat them. Never throws: publishing
   * downstream must not undo a debrief the learner already has.
   */
  async applyToSession(
    run: DebriefRun,
    opts: { announce: boolean } = { announce: true },
  ): Promise<boolean> {
    if (
      run.mode !== DebriefRunMode.LIVE ||
      !READABLE.has(run.status) ||
      !run.cards ||
      !run.tenantId
    ) {
      return false;
    }
    try {
      const cards = run.cards as unknown as DebriefCards;
      const stamp: DebriefGeneratorStamp = {
        agent: 'debrief',
        runId: run.id,
        releaseId: run.releaseId ?? null,
        version: run.releaseVersion ?? null,
        publishedAt: new Date().toISOString(),
      };
      const { positives, improvements } = claimsFromCards(cards);
      const evidence = run.workspace?.evidence;
      const skillCoverage = skillCoverageFromEvidence(evidence);
      const { messageFor, startFor } = await this.transcriptIndex(
        run.scenarioSessionId,
      );
      const emotionalMovement = emotionalMovementFromEvidence(
        evidence,
        messageFor,
        startFor,
      );
      const caseMemory =
        typeof evidence?.case_memory_update === 'string' &&
        evidence.case_memory_update.trim()
          ? evidence.case_memory_update.trim()
          : null;
      const ours = {
        supervisorNote: renderSupervisorNote(cards, messageFor),
        positives,
        improvements,
        areasOfGrowth: areasOfGrowthFromCards(cards),
        sessionGlimpse: (cards.opening ?? '').trim() || null,
        // v9 FR-4: what only today's debrief used to write. Left as they are
        // when the run has none (an Analyst from before it produced them).
        ...(emotionalMovement.length ? { emotionalMovement } : {}),
        ...(caseMemory ? { cumulativeMemory: caseMemory } : {}),
        // An evidence map with no area tags (a run from before the Analyst
        // tagged them) leaves today's skill coverage in place rather than
        // writing an empty one the charts would read as "nothing shown".
        ...(skillCoverage.length ? { skillCoverage } : {}),
        debriefGenerator: stamp,
      };
      // The note's language (normalised primary subtag), so the session view
      // never asks today's debrief to re-write it in the same language.
      const language =
        String(run.language ?? 'en')
          .replace(/_/g, '-')
          .split('-')[0]
          .trim()
          .toLowerCase() || 'en';
      await this.runs.manager.transaction(async (em) => {
        const [row] = await em.query(
          `SELECT summary FROM scenario_session_details
            WHERE "scenarioSessionId" = $1 FOR UPDATE`,
          [run.scenarioSessionId],
        );
        const feedback = (row?.summary?.feedback ?? {}) as Record<string, any>;
        // Today's debrief's note and skill coverage, kept once for comparison
        // (v9 FR-4 "its output goes only to legacyNote"), before ours replaces them.
        const legacyUntaken =
          !feedback.debriefGenerator &&
          (feedback.supervisorNote || feedback.skillCoverage);
        if (legacyUntaken) {
          await em.query(
            `UPDATE debrief_runs
                SET workspace = jsonb_set(coalesce(workspace, '{}'::jsonb), '{legacyNote}', $2::jsonb)
              WHERE id = $1`,
            [
              run.id,
              JSON.stringify({
                supervisorNote: feedback.supervisorNote ?? null,
                positives: feedback.positives ?? null,
                improvements: feedback.improvements ?? null,
                skillCoverage: feedback.skillCoverage ?? null,
                takenAt: stamp.publishedAt,
              }),
            ],
          );
        }
        if (row) {
          await em.query(
            `UPDATE scenario_session_details
                SET summary = jsonb_set(
                      coalesce(summary, '{}'::jsonb) - 'errorMessage',
                      '{feedback}',
                      coalesce(summary->'feedback', '{}'::jsonb) || $2::jsonb)
                      || jsonb_build_object('language', $3::text),
                    "updatedAt" = now()
              WHERE "scenarioSessionId" = $1`,
            [run.scenarioSessionId, JSON.stringify(ours), language],
          );
        } else {
          await em.query(
            `INSERT INTO scenario_session_details ("scenarioSessionId", summary, tenant_id)
             VALUES ($1, $2::jsonb, $3)
             ON CONFLICT ("scenarioSessionId") DO UPDATE
               SET summary = jsonb_set(
                     coalesce(scenario_session_details.summary, '{}'::jsonb) - 'errorMessage',
                     '{feedback}',
                     coalesce(scenario_session_details.summary->'feedback', '{}'::jsonb)
                       || (EXCLUDED.summary->'feedback'))
                   || jsonb_build_object('language', EXCLUDED.summary->>'language')`,
            [
              run.scenarioSessionId,
              JSON.stringify({ feedback: ours, language }),
              run.tenantId,
            ],
          );
        }
      });
      if (opts.announce) await this.announce(run, cards);
      return true;
    } catch (e) {
      this.logger.error(
        `[debrief] publishing run ${run.id} into session ${run.scenarioSessionId} failed: ${(e as Error).message}`,
      );
      return false;
    }
  }

  /**
   * Transcript turn → message id and message → start time, numbered exactly as
   * the run's transcript is (`DebriefQualityRepository.buildTranscript`:
   * every non-empty message in order, from 1), so anchors and emotion levels
   * land on the right messages.
   */
  private async transcriptIndex(sessionId: string): Promise<{
    messageFor: (turn: number) => number | undefined;
    startFor: (messageId: number) => number | undefined;
  }> {
    const rows: Array<{
      id: number;
      content: string | null;
      start: number | null;
    }> = await this.runs.query(
      `SELECT id, content, "startSeconds" AS start
           FROM scenario_session_messages
          WHERE "scenarioSessionId" = $1
          ORDER BY "createdAt" ASC, id ASC`,
      [sessionId],
    );
    const byTurn = new Map<number, number>();
    const startById = new Map<number, number>();
    for (const r of rows ?? []) {
      if (!(r.content ?? '').trim()) continue;
      byTurn.set(byTurn.size + 1, Number(r.id));
      if (r.start != null) startById.set(Number(r.id), Number(r.start));
    }
    return {
      messageFor: (turn) => byTurn.get(turn),
      startFor: (id) => startById.get(id),
    };
  }

  /** The supervisor memory update and the ready event, from the live debrief. */
  private async announce(run: DebriefRun, cards: DebriefCards): Promise<void> {
    const [session] = await this.runs.query(
      `SELECT "counselorId" AS counselor_id FROM scenario_sessions WHERE id = $1`,
      [run.scenarioSessionId],
    );
    if (session?.counselor_id) {
      await this.memory.recordFromEvaluation(
        Number(session.counselor_id),
        run.tenantId as string,
        run.scenarioSessionId,
        memoryUpdateFromCards(cards),
      );
    }
    this.events.emit(SCENARIO_SESSION_DEBRIEF_READY_EVENT, {
      scenarioSessionId: run.scenarioSessionId,
      tenantId: run.tenantId as string,
    } satisfies ScenarioSessionDebriefReadyEvent);
  }
}
