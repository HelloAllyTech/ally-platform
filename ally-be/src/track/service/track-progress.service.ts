import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource, EntityManager, Not } from 'typeorm';
import { SessionItemStatus } from 'src/common/type/common.type';
import { meetsMinimumScore } from 'src/common/util/progression.util';
import { AppConfigService } from 'src/config/config.service';
import { LoggerService } from 'src/logger/logger.service';
import { TrackEnrollment } from '../entity/track-enrollment.entity';
import { TrackItemProgress } from '../entity/track-item-progress.entity';
import { TrackItem } from '../entity/track-item.entity';
import { TrackSection } from '../entity/track-section.entity';
import { TrackTenant } from '../entity/track-tenant.entity';
import { TrackItemProgressRepository } from '../repository/track-item-progress.repository';
import { TrackItemRepository } from '../repository/track-item.repository';
import { TrackItemProgressMeta, TrackItemType } from '../type/track.type';

export const TRACK_EVENTS = {
  ITEM_COMPLETED: 'track.item.completed',
  SECTION_COMPLETED: 'track.section.completed',
  TRACK_COMPLETED: 'track.completed',
  /** A quiz attempt has a result (or is waiting for model grading). */
  QUIZ_GRADED: 'track.quiz.graded',
  /** A roleplay attempt ended, whether or not it completed the item. */
  ROLEPLAY_ATTEMPT_ENDED: 'track.roleplay.attempt.ended',
} as const;

/** Payload of TRACK_EVENTS.QUIZ_GRADED. */
export interface TrackQuizGradedEvent {
  userId: number;
  trackEnrollmentId: string;
  trackItemId: string;
  attemptId: string;
  status: string;
  passed: boolean | null;
  scorePct: number | null;
  attemptsUsed: number;
  maxAttempts: number | null;
}

/** Payload of TRACK_EVENTS.ROLEPLAY_ATTEMPT_ENDED. */
export interface TrackRoleplayAttemptEndedEvent {
  userId: number;
  trackEnrollmentId: string;
  trackItemId: string;
  trackItemProgressId: string;
  outcome: 'completed' | 'too_short' | 'below_score';
  score: number | null;
  callDurationMs: number;
}

export const CASE_SESSION_COMPLETED_EVENT = 'case.session.completed';

export interface CaseSessionCompletedEvent {
  caseSessionId: string;
  userId: number;
}

export interface CompleteItemResult {
  completed: boolean;
  unlockedItemIds: string[];
  sectionCompleted: boolean;
  trackCompleted: boolean;
}

const NOOP_RESULT: CompleteItemResult = {
  completed: false,
  unlockedItemIds: [],
  sectionCompleted: false,
  trackCompleted: false,
};

/**
 * The Track 2.0 progression engine. `completeItem` is the single place any
 * component type funnels into: it marks the progress row COMPLETED, unlocks
 * the next item (crossing section boundaries), and stamps section/track
 * completion. Idempotent — re-completing a COMPLETED item is a no-op, so
 * learners can freely replay finished components.
 */
@Injectable()
export class TrackProgressService {
  private readonly logger = LoggerService.getInstance(
    TrackProgressService.name,
  );

  constructor(
    private readonly dataSource: DataSource,
    private readonly configService: AppConfigService,
    private readonly eventEmitter: EventEmitter2,
    private readonly trackItemProgressRepository: TrackItemProgressRepository,
    private readonly trackItemRepository: TrackItemRepository,
  ) {}

  /**
   * Start-time gate for a roleplay played inside a track (called from
   * scenario-session.service validateStartScenarioSession). Throws
   * BadRequestException on any mismatch.
   */
  async validateRoleplayStart(
    trackItemProgressId: string,
    scenarioId: number,
    { userId, tenantId }: { userId: number; tenantId: string },
  ): Promise<void> {
    const progress = await this.trackItemProgressRepository.findOne({
      where: { id: trackItemProgressId },
    });
    if (!progress || progress.userId !== userId) {
      throw new BadRequestException('Track component progress not found');
    }
    if (progress.status === SessionItemStatus.LOCKED) {
      throw new BadRequestException('This track component is locked');
    }
    const item = await this.trackItemRepository.findOne({
      where: { id: progress.trackItemId },
    });
    if (!item || item.scenarioId !== scenarioId) {
      throw new BadRequestException(
        'Scenario does not match the track component',
      );
    }
    const trackTenant = await this.dataSource
      .getRepository(TrackTenant)
      .findOne({ where: { trackId: item.trackId, tenantId } });
    if (!trackTenant) {
      throw new BadRequestException(
        'Track is not available for your organization',
      );
    }
    if (item.completionCriteria?.assessmentMode) {
      await this.assertAssessmentAttemptAvailable(progress);
    }
  }

  /**
   * Assessment-mode gate: one attempt per learner. Counts the sessions
   * themselves rather than `attemptCount` (which only moves when a session's
   * end is processed), so a second start while the first is still live is
   * refused too. A session only uses the attempt if the learner actually took
   * part — at least one message of theirs in the transcript (the client's are
   * stored with senderId -1) — and it was not a room that closed with no
   * end-of-session at all (`eventStatus` ABANDONED: a crash, not a
   * submission). So a denied microphone, a failed connection or leaving before
   * saying anything never costs the learner their assessment. `startedAt` can't
   * be the signal: ending a session backfills it. Sessions before a trainer's
   * reopen don't count.
   */
  private async assertAssessmentAttemptAvailable(
    progress: TrackItemProgress,
  ): Promise<void> {
    const reopenedAt = progress.meta?.assessmentReopenedAt ?? null;
    const [row]: Array<{ live: number; ended: number }> =
      await this.dataSource.query(
        `SELECT COUNT(*) FILTER (WHERE s.status = 'ACTIVE')::int AS "live",
                COUNT(*) FILTER (
                  WHERE s.status = 'ENDED'
                    AND s."eventStatus" <> 'ABANDONED'
                    AND EXISTS (
                      SELECT 1 FROM scenario_session_messages m
                       WHERE m."scenarioSessionId" = s.id
                         AND m."senderId" <> -1
                    )
                )::int AS "ended"
           FROM scenario_sessions s
          WHERE s."trackItemProgressId" = $1
            AND ($2::timestamptz IS NULL OR s."createdAt" > $2::timestamptz)`,
        [progress.id, reopenedAt],
      );
    if ((row?.ended ?? 0) > 0) {
      throw new BadRequestException(
        'This roleplay is an assessment and you have already submitted your attempt.',
      );
    }
    if ((row?.live ?? 0) > 0) {
      throw new BadRequestException(
        'Your assessment attempt for this roleplay is already in progress.',
      );
    }
  }

  /**
   * The track item progress row a case session belongs to, if that case is
   * being played inside a track. Lets the case flow fall back to track-level
   * previous memory for the FIRST item of a nested case (which has no
   * within-case memory to inherit).
   */
  async getProgressIdByCaseSessionId(
    caseSessionId: string,
  ): Promise<string | null> {
    const progress = await this.trackItemProgressRepository.findOne({
      where: { caseSessionId },
    });
    return progress?.id ?? null;
  }

  /**
   * Sources of "previous memory" for a track item, most-recent-first: the
   * ROLEPLAY / CASE items that precede this one in track order, mapped to
   * this learner's progress rows. The learn side resolves each candidate to
   * an actual session memory (a candidate item may have been replayed or
   * left no memory, so callers take the first that resolves). Capped — a
   * long track only ever needs the nearest few conversation items.
   */
  async getPreviousMemoryCandidates(
    trackItemProgressId: string,
    limit = 5,
  ): Promise<Array<{ trackItemProgressId?: string; caseSessionId?: string }>> {
    const progress = await this.trackItemProgressRepository.findOne({
      where: { id: trackItemProgressId },
    });
    if (!progress) return [];
    const item = await this.trackItemRepository.findOne({
      where: { id: progress.trackItemId },
    });
    if (!item) return [];

    // Same ordered walk as completeItem: sections by order, items by order
    // within their section.
    const [sections, items, progressRows] = await Promise.all([
      this.dataSource.getRepository(TrackSection).find({
        where: { trackId: item.trackId },
        order: { order: 'ASC' },
      }),
      this.trackItemRepository.find({ where: { trackId: item.trackId } }),
      this.trackItemProgressRepository.find({
        where: { trackEnrollmentId: progress.trackEnrollmentId },
      }),
    ]);
    const orderedItems = sections.flatMap((section) =>
      items
        .filter((i) => i.trackSectionId === section.id)
        .sort((a, b) => a.order - b.order),
    );
    const progressByItemId = new Map(
      progressRows.map((row) => [row.trackItemId, row]),
    );

    const currentIndex = orderedItems.findIndex((i) => i.id === item.id);
    if (currentIndex <= 0) return [];

    const candidates: Array<{
      trackItemProgressId?: string;
      caseSessionId?: string;
    }> = [];
    for (let i = currentIndex - 1; i >= 0 && candidates.length < limit; i--) {
      const prev = orderedItems[i];
      const prevProgress = progressByItemId.get(prev.id);
      if (!prevProgress) continue;
      if (prev.type === TrackItemType.ROLEPLAY) {
        candidates.push({ trackItemProgressId: prevProgress.id });
      } else if (
        prev.type === TrackItemType.CASE &&
        prevProgress.caseSessionId
      ) {
        candidates.push({ caseSessionId: prevProgress.caseSessionId });
      }
    }
    return candidates;
  }

  /**
   * Roleplay played inside a track has ended. Mirrors the legacy
   * scenario-path semantics: callDuration arrives in **milliseconds**;
   * completion requires minimum duration AND (when set) minimum score.
   * A miss is not an error — the item stays UNLOCKED for a retry.
   */
  async handleRoleplayEnd({
    trackItemProgressId,
    score,
    callDuration = 0,
    learnerTookPart = true,
  }: {
    trackItemProgressId: string;
    score?: number;
    callDuration: number;
    /**
     * Whether the learner said anything in the session. An assessment only
     * counts as submitted if they did — the same rule the start gate applies.
     */
    learnerTookPart?: boolean;
  }): Promise<CompleteItemResult> {
    const progress = await this.trackItemProgressRepository.findOne({
      where: { id: trackItemProgressId },
    });
    if (!progress) {
      this.logger.error(
        `Track item progress not found: ${trackItemProgressId}`,
      );
      return NOOP_RESULT;
    }
    const item = await this.trackItemRepository.findOne({
      where: { id: progress.trackItemId },
    });
    const assessment =
      !!item?.completionCriteria?.assessmentMode && learnerTookPart;
    const submitted = assessment
      ? {
          meta: {
            ...(progress.meta ?? {}),
            assessmentSubmittedAt: new Date().toISOString(),
          },
        }
      : {};

    if (progress.status === SessionItemStatus.COMPLETED) {
      // A passed assessment a trainer reopened: the new attempt is submitted
      // too, but it never un-completes the item or replaces its score.
      if (assessment) {
        await this.trackItemProgressRepository.update(progress.id, submitted);
      }
      return { ...NOOP_RESULT, completed: true };
    }

    // In assessment mode the ended attempt is final whatever its outcome, so
    // the score is kept here too — completeItem only writes it on a pass.
    await this.trackItemProgressRepository.update(progress.id, {
      attemptCount: progress.attemptCount + 1,
      ...(assessment ? { score: score ?? undefined, ...submitted } : {}),
    });

    if (!item) {
      this.logger.error(`Track item not found: ${progress.trackItemId}`);
      return NOOP_RESULT;
    }

    const callDurationInSeconds = (callDuration ?? 0) / 1000;
    const minDurationSeconds =
      item.completionCriteria?.minDurationSeconds ??
      this.configService.simulationPath
        ?.simulationPathItemMinDurationForCompletion ??
      0;
    const attemptEnded = (outcome: TrackRoleplayAttemptEndedEvent['outcome']) =>
      this.emitSafely(TRACK_EVENTS.ROLEPLAY_ATTEMPT_ENDED, {
        userId: progress.userId,
        trackEnrollmentId: progress.trackEnrollmentId,
        trackItemId: progress.trackItemId,
        trackItemProgressId,
        outcome,
        score: score ?? null,
        callDurationMs: callDuration ?? 0,
      } satisfies TrackRoleplayAttemptEndedEvent);

    if (callDurationInSeconds < minDurationSeconds) {
      this.logger.info(
        `Track roleplay too short (${callDurationInSeconds}s < ${minDurationSeconds}s) for progress ${trackItemProgressId}`,
      );
      attemptEnded('too_short');
      return NOOP_RESULT;
    }

    const minScore = item.completionCriteria?.minScore;
    if (!meetsMinimumScore(score, minScore)) {
      this.logger.info(
        `Track roleplay score ${score} below minScore ${minScore} for progress ${trackItemProgressId}`,
      );
      attemptEnded('below_score');
      return NOOP_RESULT;
    }

    const result = await this.completeItem(trackItemProgressId, { score });
    attemptEnded('completed');
    return result;
  }

  /**
   * Trainer action: give a learner back their one attempt at an assessment
   * roleplay. Only touches a learner in the caller's own organisation (the
   * enrollment carries the tenant). Earlier sessions, scores and reports are
   * kept; they simply stop counting against the gate.
   */
  async reopenRoleplayAssessment(
    trackItemId: string,
    userId: number,
    tenantId: string,
  ): Promise<{ success: true }> {
    const item = await this.trackItemRepository.findOne({
      where: { id: trackItemId },
    });
    if (
      !item ||
      item.type !== TrackItemType.ROLEPLAY ||
      !item.completionCriteria?.assessmentMode
    ) {
      throw new NotFoundException('Assessment not found');
    }
    const progress = await this.trackItemProgressRepository.findOne({
      where: { trackItemId, userId },
    });
    const enrollment = progress
      ? await this.dataSource
          .getRepository(TrackEnrollment)
          .findOne({ where: { id: progress.trackEnrollmentId } })
      : null;
    // Same answer for "no such learner" and "not your organisation", so the
    // endpoint cannot be used to probe other tenants.
    if (!progress || !enrollment || enrollment.tenantId !== tenantId) {
      throw new NotFoundException('Learner progress not found');
    }
    const meta = { ...(progress.meta ?? {}) };
    delete meta.assessmentSubmittedAt;
    await this.trackItemProgressRepository.update(progress.id, {
      meta: { ...meta, assessmentReopenedAt: new Date().toISOString() },
    });
    this.logger.info(
      `Reopened assessment attempt on track item ${trackItemId} for user ${userId}`,
    );
    return { success: true };
  }

  /** A quiz attempt's result, for listeners (the Ally guide). */
  emitQuizGraded(event: TrackQuizGradedEvent): void {
    this.emitSafely(TRACK_EVENTS.QUIZ_GRADED, event);
  }

  private emitSafely(name: string, payload: unknown): void {
    try {
      this.eventEmitter.emit(name, payload);
    } catch (error) {
      this.logger.error(`Failed to emit ${name}: ${error}`);
    }
  }

  /**
   * A case session finished its last roleplay (emitted from
   * case-session.service). Complete every non-completed track item progress
   * row linked to that case session — the same case can sit in several
   * tracks.
   */
  @OnEvent(CASE_SESSION_COMPLETED_EVENT)
  async handleCaseSessionCompleted(
    event: CaseSessionCompletedEvent,
  ): Promise<void> {
    try {
      const progressRows = await this.trackItemProgressRepository.find({
        where: {
          caseSessionId: event.caseSessionId,
          status: Not(SessionItemStatus.COMPLETED),
        },
      });
      for (const progress of progressRows) {
        await this.completeItem(progress.id, {});
      }
      if (progressRows.length > 0) {
        this.logger.info(
          `Case session ${event.caseSessionId} completed ${progressRows.length} track item(s)`,
        );
      }
    } catch (error) {
      // Track progression must never break the case flow.
      this.logger.error(
        `Failed to propagate case session ${event.caseSessionId} completion to tracks: ${error}`,
      );
    }
  }

  /**
   * Mark a progress row COMPLETED and advance unlock state. Transactional and
   * idempotent.
   */
  async completeItem(
    trackItemProgressId: string,
    { score, meta }: { score?: number; meta?: Partial<TrackItemProgressMeta> },
  ): Promise<CompleteItemResult> {
    // Progress events go out only after the transaction commits: a listener
    // that reads progress back (the Ally guide's spine, badges) must see the
    // completion, and must not hear about one that was rolled back.
    let committedEvents:
      | Parameters<TrackProgressService['emitProgressEvents']>[0]
      | null = null;
    const result = await this.dataSource.transaction(
      async (manager: EntityManager) => {
        const progressRepo = manager.getRepository(TrackItemProgress);
        const enrollmentRepo = manager.getRepository(TrackEnrollment);
        const itemRepo = manager.getRepository(TrackItem);
        const sectionRepo = manager.getRepository(TrackSection);

        const progress = await progressRepo.findOne({
          where: { id: trackItemProgressId },
        });
        if (!progress) {
          this.logger.error(
            `Track item progress not found: ${trackItemProgressId}`,
          );
          return NOOP_RESULT;
        }
        if (progress.status === SessionItemStatus.COMPLETED) {
          return { ...NOOP_RESULT, completed: true };
        }

        const enrollment = await enrollmentRepo.findOne({
          where: { id: progress.trackEnrollmentId },
        });
        if (!enrollment) {
          this.logger.error(
            `Track enrollment not found: ${progress.trackEnrollmentId}`,
          );
          return NOOP_RESULT;
        }

        const item = await itemRepo.findOne({
          where: { id: progress.trackItemId },
        });
        if (!item) {
          this.logger.error(`Track item not found: ${progress.trackItemId}`);
          return NOOP_RESULT;
        }

        const now = new Date();
        await progressRepo.update(progress.id, {
          status: SessionItemStatus.COMPLETED,
          completedAt: now,
          ...(score !== undefined ? { score } : {}),
          ...(meta ? { meta: { ...(progress.meta ?? {}), ...meta } } : {}),
        });

        // Ordered walk of the whole track to find what comes next.
        const [sections, items, progressRows] = await Promise.all([
          sectionRepo.find({
            where: { trackId: item.trackId },
            order: { order: 'ASC' },
          }),
          itemRepo.find({ where: { trackId: item.trackId } }),
          progressRepo.find({
            where: { trackEnrollmentId: enrollment.id },
          }),
        ]);
        const orderedItems = sections.flatMap((section) =>
          items
            .filter((i) => i.trackSectionId === section.id)
            .sort((a, b) => a.order - b.order),
        );
        const progressByItemId = new Map(
          progressRows.map((row) => [row.trackItemId, row]),
        );

        const currentIndex = orderedItems.findIndex((i) => i.id === item.id);
        const nextItem =
          currentIndex >= 0 ? orderedItems[currentIndex + 1] : undefined;

        const unlockedItemIds: string[] = [];
        if (nextItem) {
          const nextProgress = progressByItemId.get(nextItem.id);
          if (
            nextProgress &&
            nextProgress.status === SessionItemStatus.LOCKED
          ) {
            await progressRepo.update(nextProgress.id, {
              status: SessionItemStatus.UNLOCKED,
            });
            unlockedItemIds.push(nextItem.id);
          } else if (!nextProgress) {
            // Defensive backfill — enrollment normally creates all rows upfront.
            const created = await progressRepo.save(
              progressRepo.create({
                trackEnrollmentId: enrollment.id,
                trackItemId: nextItem.id,
                userId: enrollment.userId,
                status: SessionItemStatus.UNLOCKED,
              }),
            );
            progressByItemId.set(nextItem.id, created);
            unlockedItemIds.push(nextItem.id);
          }
        }

        // Section completed = every item in the current section is COMPLETED
        // (counting the row we just flipped).
        const sectionItems = items.filter(
          (i) => i.trackSectionId === item.trackSectionId,
        );
        const sectionCompleted = sectionItems.every((sectionItem) => {
          if (sectionItem.id === item.id) return true;
          return (
            progressByItemId.get(sectionItem.id)?.status ===
            SessionItemStatus.COMPLETED
          );
        });

        const trackCompleted = !nextItem;
        await enrollmentRepo.update(enrollment.id, {
          completedItems: (enrollment.completedItems ?? 0) + 1,
          lastActivityAt: now,
          ...(trackCompleted ? { completedAt: now } : {}),
        });

        committedEvents = {
          enrollment,
          item,
          sectionCompleted,
          trackCompleted,
        };

        return {
          completed: true,
          unlockedItemIds,
          sectionCompleted,
          trackCompleted,
        };
      },
    );
    if (committedEvents) this.emitProgressEvents(committedEvents);
    return result;
  }

  /** Best-effort in-process events — the future badge/analytics seam. */
  private emitProgressEvents({
    enrollment,
    item,
    sectionCompleted,
    trackCompleted,
  }: {
    enrollment: TrackEnrollment;
    item: TrackItem;
    sectionCompleted: boolean;
    trackCompleted: boolean;
  }): void {
    try {
      const base = {
        userId: enrollment.userId,
        tenantId: enrollment.tenantId,
        trackId: item.trackId,
        trackEnrollmentId: enrollment.id,
        trackItemId: item.id,
        trackSectionId: item.trackSectionId,
        itemType: item.type,
      };
      this.eventEmitter.emit(TRACK_EVENTS.ITEM_COMPLETED, base);
      if (sectionCompleted) {
        this.eventEmitter.emit(TRACK_EVENTS.SECTION_COMPLETED, base);
      }
      if (trackCompleted) {
        this.eventEmitter.emit(TRACK_EVENTS.TRACK_COMPLETED, base);
      }
    } catch (error) {
      this.logger.error(`Failed to emit track progress events: ${error}`);
    }
  }
}
