import { Injectable } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  SCENARIO_SESSION_DEBRIEF_READY_EVENT,
  SCENARIO_SESSION_LEGACY_DEBRIEF_WRITTEN_EVENT,
  ScenarioSessionDebriefReadyEvent,
  ScenarioSessionLegacyDebriefWrittenEvent,
} from '../../learn/constants/scenario-session-events.constants';
import { LearnerSupervisorMemoryService } from '../../learn/service/learner-supervisor-memory.service';
import { LoggerService } from '../../logger/logger.service';
import { DebriefRun } from '../entity/debrief-run.entity';
import { DebriefRunMode, DebriefRunStatus } from '../enum/debrief-run.enum';
import { DebriefCards } from '../util/debrief-cards.util';
import {
  claimsFromCards,
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
 * on the new note, and the part of FR-4 that hands today's debrief's writes
 * over: once a live debrief is readable, the session's summary carries it —
 * its note, its strengths and points to work on, skill coverage computed from
 * its evidence map, a generator stamp — and the learner's supervisor memory
 * and the "debrief ready" event come from it, not from today's debrief.
 *
 * Today's debrief still runs for switched-on organisations (it alone writes
 * emotional movement, the transcript's tags and a case's memory), but its
 * note and skill coverage are kept on the run as `workspace.legacyNote` for
 * comparison. The two writers race on session end in either order, so every
 * write here is idempotent: whichever lands second, the summary ends with the
 * live debrief's fields and the legacy copy is taken only once.
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
      const skillCoverage = skillCoverageFromEvidence(run.workspace?.evidence);
      const ours = {
        supervisorNote: renderSupervisorNote(cards),
        positives,
        improvements,
        // An evidence map with no area tags (a run from before the Analyst
        // tagged them) leaves today's skill coverage in place rather than
        // writing an empty one the charts would read as "nothing shown".
        ...(skillCoverage.length ? { skillCoverage } : {}),
        debriefGenerator: stamp,
      };
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
                      coalesce(summary->'feedback', '{}'::jsonb) || $2::jsonb),
                    "updatedAt" = now()
              WHERE "scenarioSessionId" = $1`,
            [run.scenarioSessionId, JSON.stringify(ours)],
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
                       || (EXCLUDED.summary->'feedback'))`,
            [
              run.scenarioSessionId,
              JSON.stringify({ feedback: ours }),
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

  /**
   * Today's debrief finished writing a switched-on organisation's session.
   * When the live debrief landed first, its fields were just overwritten:
   * put them back (and take the legacy copy), without announcing again.
   */
  @OnEvent(SCENARIO_SESSION_LEGACY_DEBRIEF_WRITTEN_EVENT, { async: true })
  async onLegacyWritten(
    event: ScenarioSessionLegacyDebriefWrittenEvent,
  ): Promise<void> {
    if (!event?.scenarioSessionId) return;
    const run = await this.runs.findOne({
      where: {
        scenarioSessionId: event.scenarioSessionId,
        mode: DebriefRunMode.LIVE,
      },
    });
    if (run) await this.applyToSession(run, { announce: false });
  }
}
