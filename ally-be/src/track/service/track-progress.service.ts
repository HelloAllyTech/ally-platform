import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource, EntityManager, Not } from 'typeorm';
import { SessionItemStatus } from 'src/common/type/common.type';
import { AppConfigService } from 'src/config/config.service';
import { LoggerService } from 'src/logger/logger.service';
import { TrackEnrollment } from '../entity/track-enrollment.entity';
import { TrackItemProgress } from '../entity/track-item-progress.entity';
import { TrackItem } from '../entity/track-item.entity';
import { TrackSection } from '../entity/track-section.entity';
import { TrackTenant } from '../entity/track-tenant.entity';
import { TrackItemProgressRepository } from '../repository/track-item-progress.repository';
import { TrackItemRepository } from '../repository/track-item.repository';
import {
  AssessmentPhase,
  LastCaseAttempt,
  RoleplayAttemptFailureReason,
  RoleplayType,
  TrackItemCompletionCriteria,
  TrackItemProgressMeta,
  TrackItemType,
} from '../type/track.type';
import {
  parseDefaultMinDurationSeconds,
  resolveRoleplayGate,
  RoleplayGate,
  roleplayFailureReasons,
  resolveRoleplayType,
} from '../util/roleplay-gate.util';

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
  /** Kept for listeners that predate failureReasons; too_short wins a tie. */
  outcome: 'completed' | 'too_short' | 'below_score' | 'too_few_turns';
  /** Every gate the attempt missed; empty when it completed the item. */
  failureReasons: RoleplayAttemptFailureReason[];
  score: number | null;
  callDurationMs: number;
}

export const CASE_SESSION_COMPLETED_EVENT = 'case.session.completed';

export interface CaseSessionCompletedEvent {
  caseSessionId: string;
  userId: number;
}

export const CASE_SESSION_ATTEMPT_MISSED_EVENT = 'case.session.attempt_missed';

/** A case roleplay ended without clearing its bar (emitted from case-session). */
export interface CaseSessionAttemptMissedEvent {
  caseSessionId: string;
  failureReasons: RoleplayAttemptFailureReason[];
  score: number | null;
  durationSeconds: number;
  requiredScore: number | null;
  requiredDurationSeconds: number | null;
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
 * handleRoleplayEnd's result. `assessmentAttemptValid` is null for a
 * non-assessment item; otherwise whether this session counted as the
 * learner's one attempt, judged by the rule in force as it ended.
 */
export interface RoleplayEndResult extends CompleteItemResult {
  assessmentAttemptValid: boolean | null;
}

const NOOP_END_RESULT: RoleplayEndResult = {
  ...NOOP_RESULT,
  assessmentAttemptValid: null,
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
      await this.assertPreAssessmentSubmitted(item, progress);
    }
  }

  /**
   * A POST assessment can't start until the learner has submitted its paired
   * PRE, so every post has a baseline. Course order usually guarantees this,
   * but order and pairing are editable on a live course. No paired PRE in the
   * track (deleted, unpaired, or not an assessment any more) → no check.
   */
  private async assertPreAssessmentSubmitted(
    item: TrackItem,
    progress: TrackItemProgress,
  ): Promise<void> {
    const pre = await this.findPairedPreAssessment(
      item,
      progress.trackEnrollmentId,
    );
    if (pre && !pre.submitted) {
      throw new BadRequestException(
        `Complete the pre-assessment "${pre.title}" first.`,
      );
    }
  }

  /**
   * The PRE paired with a POST assessment item, and whether this enrolment
   * has submitted it. Null for anything that isn't a paired POST, or when the
   * PRE is gone or no longer an assessment.
   */
  async findPairedPreAssessment(
    item: Pick<TrackItem, 'id' | 'trackId' | 'completionCriteria'>,
    trackEnrollmentId: string,
  ): Promise<{ title: string; submitted: boolean } | null> {
    const criteria = item.completionCriteria;
    if (
      !criteria?.assessmentMode ||
      criteria.assessmentPhase !== AssessmentPhase.POST ||
      !criteria.assessmentPairKey
    ) {
      return null;
    }
    const [pre]: Array<{ title: string; submittedAt: string | null }> =
      await this.dataSource.query(
        `SELECT ti.title AS "title",
                tip.meta->>'assessmentSubmittedAt' AS "submittedAt"
           FROM track_items ti
           LEFT JOIN track_item_progress tip
             ON tip."trackItemId" = ti.id
            AND tip."trackEnrollmentId" = $3
          WHERE ti."trackId" = $1
            AND ti."deletedAt" IS NULL
            AND ti.id <> $4
            AND (ti."completionCriteria"->>'assessmentMode')::boolean IS TRUE
            AND ti."completionCriteria"->>'assessmentPhase' = 'PRE'
            AND ti."completionCriteria"->>'assessmentPairKey' = $2
          LIMIT 1`,
        [item.trackId, criteria.assessmentPairKey, trackEnrollmentId, item.id],
      );
    return pre ? { title: pre.title, submitted: !!pre.submittedAt } : null;
  }

  /**
   * Assessment-mode gate: one valid attempt per learner. Counts the sessions
   * themselves rather than `attemptCount` (which only moves when a session's
   * end is processed), so a second start while the first is still live is
   * refused too. A session uses the attempt only if it was stamped
   * `assessmentAttemptValid` when it ended — the learner took the item's
   * minimum learner turns under the rule in force then. Shorter attempts,
   * crashes (`eventStatus` ABANDONED) and sessions where the learner never
   * spoke don't count, so they can start again. An ended session whose end
   * hasn't been processed yet (no `learnerTurns`) blocks briefly, so a quick
   * restart can't slip past a valid attempt. Sessions before a trainer's
   * reopen don't count.
   */
  private async assertAssessmentAttemptAvailable(
    progress: TrackItemProgress,
  ): Promise<void> {
    const reopenedAt = progress.meta?.assessmentReopenedAt ?? null;
    const [row]: Array<{ live: number; ended: number; pending: number }> =
      await this.dataSource.query(
        `SELECT COUNT(*) FILTER (WHERE s.status = 'ACTIVE')::int AS "live",
                COUNT(*) FILTER (
                  WHERE s.status = 'ENDED'
                    AND s."assessmentAttemptValid" IS TRUE
                )::int AS "ended",
                COUNT(*) FILTER (
                  WHERE s.status = 'ENDED'
                    AND s."eventStatus" <> 'ABANDONED'
                    AND s."learnerTurns" IS NULL
                    AND s."assessmentAttemptValid" IS NULL
                    AND s."updatedAt" > NOW() - INTERVAL '2 minutes'
                )::int AS "pending"
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
    if ((row?.pending ?? 0) > 0) {
      throw new BadRequestException(
        'Your last attempt is still being saved. Try again in a moment.',
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
   * scenario-path semantics: callDuration arrives in **milliseconds**. Which
   * gates apply — minimum score, minimum duration, both, or neither — is the
   * item's `completionLogic` (see resolveRoleplayGate). A miss is not an
   * error: the item stays UNLOCKED for a retry, and the reasons are kept on
   * the progress row so the learner can be told which bar they missed.
   *
   * An assessment item is judged on learner turns instead (see
   * handleAssessmentEnd). The result says whether this session counted as the
   * learner's assessment attempt, so the caller can stamp it on the session —
   * that stamp, not the item's current rule, is what every later reader uses.
   */
  async handleRoleplayEnd({
    trackItemProgressId,
    scenarioSessionId = null,
    score,
    callDuration = 0,
    learnerTookPart,
    learnerTurns,
  }: {
    trackItemProgressId: string;
    scenarioSessionId?: string | null;
    score?: number;
    callDuration: number;
    /** Legacy signal; `learnerTurns` wins when both are given. */
    learnerTookPart?: boolean;
    /**
     * Runs of consecutive learner messages in the session. An assessment only
     * counts as submitted when this reaches the item's minLearnerTurns.
     */
    learnerTurns?: number;
  }): Promise<RoleplayEndResult> {
    const turns =
      typeof learnerTurns === 'number'
        ? learnerTurns
        : learnerTookPart === false
          ? 0
          : 1;
    const progress = await this.trackItemProgressRepository.findOne({
      where: { id: trackItemProgressId },
    });
    if (!progress) {
      this.logger.error(
        `Track item progress not found: ${trackItemProgressId}`,
      );
      return NOOP_END_RESULT;
    }
    const item = await this.trackItemRepository.findOne({
      where: { id: progress.trackItemId },
    });
    const gate = item ? this.getRoleplayGate(item.completionCriteria) : null;

    if (item && gate?.roleplayType === RoleplayType.ASSESSMENT) {
      return this.handleAssessmentEnd({
        progress,
        gate,
        scenarioSessionId,
        score,
        callDuration,
        turns,
      });
    }

    if (progress.status === SessionItemStatus.COMPLETED) {
      return { ...NOOP_END_RESULT, completed: true };
    }

    const durationSeconds = (callDuration ?? 0) / 1000;
    const failureReasons = gate
      ? roleplayFailureReasons(gate, { score, durationSeconds })
      : [];
    const lastAttemptMeta: Partial<TrackItemProgressMeta> =
      gate && failureReasons.length > 0
        ? {
            lastRoleplayAttempt: {
              failureReasons,
              score: score ?? null,
              durationSeconds: Math.round(durationSeconds),
              requiredScore: gate.minScore,
              requiredDurationSeconds: gate.minDurationSeconds,
              endedAt: new Date().toISOString(),
            },
          }
        : {};

    await this.trackItemProgressRepository.update(progress.id, {
      attemptCount: progress.attemptCount + 1,
      ...(Object.keys(lastAttemptMeta).length > 0
        ? { meta: { ...(progress.meta ?? {}), ...lastAttemptMeta } }
        : {}),
    });

    if (!item || !gate) {
      this.logger.error(`Track item not found: ${progress.trackItemId}`);
      return NOOP_END_RESULT;
    }

    const attemptEnded = this.attemptEndedEmitter(progress, {
      failureReasons,
      score,
      callDuration,
    });

    if (failureReasons.length > 0) {
      this.logger.info(
        `Track roleplay did not complete progress ${trackItemProgressId}: ` +
          `${failureReasons.join(', ')} (logic ${gate.completionLogic}, ` +
          `${durationSeconds}s vs ${gate.minDurationSeconds ?? '-'}s, ` +
          `score ${score ?? '-'} vs ${gate.minScore ?? '-'})`,
      );
      attemptEnded(
        failureReasons.includes(
          RoleplayAttemptFailureReason.INSUFFICIENT_DURATION,
        )
          ? 'too_short'
          : 'below_score',
      );
      return NOOP_END_RESULT;
    }

    const result = await this.completeItem(progress.id, {
      score,
      meta: { lastRoleplayAttempt: undefined },
    });
    attemptEnded('completed');
    return { ...result, assessmentAttemptValid: null };
  }

  /**
   * An assessment roleplay has ended. Three outcomes, by learner turns:
   *  - none: the learner never spoke (denied mic, failed connection). Nothing
   *    is submitted and nothing is shown — it never costs them the attempt.
   *  - fewer than minLearnerTurns: an incomplete start. Not submitted, so the
   *    learner may start again; counted for trainers and explained to the
   *    learner (INSUFFICIENT_TURNS).
   *  - enough: the one valid attempt. Submitted whatever its outcome, its
   *    score kept, and frozen in `assessmentSubmission`. The optional pass
   *    mark then decides whether the item completes; a miss pauses the course
   *    until a trainer reopens the attempt.
   * Duration never gates an assessment.
   */
  private async handleAssessmentEnd({
    progress,
    gate,
    scenarioSessionId,
    score,
    callDuration,
    turns,
  }: {
    progress: TrackItemProgress;
    gate: RoleplayGate;
    scenarioSessionId: string | null;
    score?: number;
    callDuration: number;
    turns: number;
  }): Promise<RoleplayEndResult> {
    const requiredTurns = gate.minLearnerTurns ?? 1;
    const now = new Date().toISOString();
    const meta = progress.meta ?? {};
    const durationSeconds = Math.round((callDuration ?? 0) / 1000);

    if (turns <= 0) {
      await this.trackItemProgressRepository.update(progress.id, {
        attemptCount: progress.attemptCount + 1,
      });
      return NOOP_END_RESULT;
    }

    if (turns < requiredTurns) {
      const failureReasons = [RoleplayAttemptFailureReason.INSUFFICIENT_TURNS];
      await this.trackItemProgressRepository.update(progress.id, {
        attemptCount: progress.attemptCount + 1,
        meta: {
          ...meta,
          assessmentIncompleteStarts:
            (meta.assessmentIncompleteStarts ?? 0) + 1,
          ...(progress.status === SessionItemStatus.COMPLETED
            ? {}
            : {
                lastRoleplayAttempt: {
                  failureReasons,
                  score: score ?? null,
                  durationSeconds,
                  requiredScore: gate.minScore,
                  requiredDurationSeconds: null,
                  learnerTurns: turns,
                  requiredTurns,
                  endedAt: now,
                },
              }),
        },
      });
      this.logger.info(
        `Track assessment attempt too short on progress ${progress.id}: ` +
          `${turns} of ${requiredTurns} learner turns; not submitted`,
      );
      this.attemptEndedEmitter(progress, {
        failureReasons,
        score,
        callDuration,
      })('too_few_turns');
      return {
        ...NOOP_END_RESULT,
        completed: progress.status === SessionItemStatus.COMPLETED,
        assessmentAttemptValid: false,
      };
    }

    const submissionMeta: Partial<TrackItemProgressMeta> = {
      assessmentSubmittedAt: now,
      assessmentSubmission: {
        scenarioSessionId,
        learnerTurns: turns,
        requiredTurns,
        score: score ?? null,
        requiredScore: gate.minScore,
        submittedAt: now,
      },
    };

    if (progress.status === SessionItemStatus.COMPLETED) {
      // A passed assessment a trainer reopened: the new attempt is submitted
      // too, but it never un-completes the item or replaces its score.
      await this.trackItemProgressRepository.update(progress.id, {
        attemptCount: progress.attemptCount + 1,
        meta: { ...meta, ...submissionMeta },
      });
      return {
        ...NOOP_END_RESULT,
        completed: true,
        assessmentAttemptValid: true,
      };
    }

    const failureReasons = roleplayFailureReasons(gate, {
      score,
      durationSeconds,
      learnerTurns: turns,
    });
    const lastAttemptMeta: Partial<TrackItemProgressMeta> =
      failureReasons.length > 0
        ? {
            lastRoleplayAttempt: {
              failureReasons,
              score: score ?? null,
              durationSeconds,
              requiredScore: gate.minScore,
              requiredDurationSeconds: null,
              learnerTurns: turns,
              requiredTurns,
              endedAt: now,
            },
          }
        : {};

    // The ended attempt is final whatever its outcome, so the score is kept
    // here too — completeItem only writes it on a pass.
    await this.trackItemProgressRepository.update(progress.id, {
      attemptCount: progress.attemptCount + 1,
      score: score ?? undefined,
      meta: { ...meta, ...submissionMeta, ...lastAttemptMeta },
    });

    const attemptEnded = this.attemptEndedEmitter(progress, {
      failureReasons,
      score,
      callDuration,
    });
    if (failureReasons.length > 0) {
      this.logger.info(
        `Track assessment submitted below its pass mark on progress ${progress.id}: ` +
          `score ${score ?? '-'} vs ${gate.minScore ?? '-'}`,
      );
      attemptEnded('below_score');
      return { ...NOOP_END_RESULT, assessmentAttemptValid: true };
    }

    const result = await this.completeItem(progress.id, {
      score,
      meta: { lastRoleplayAttempt: undefined },
    });
    attemptEnded('completed');
    return { ...result, assessmentAttemptValid: true };
  }

  private attemptEndedEmitter(
    progress: TrackItemProgress,
    {
      failureReasons,
      score,
      callDuration,
    }: {
      failureReasons: RoleplayAttemptFailureReason[];
      score?: number;
      callDuration: number;
    },
  ) {
    return (outcome: TrackRoleplayAttemptEndedEvent['outcome']) =>
      this.emitSafely(TRACK_EVENTS.ROLEPLAY_ATTEMPT_ENDED, {
        userId: progress.userId,
        trackEnrollmentId: progress.trackEnrollmentId,
        trackItemId: progress.trackItemId,
        trackItemProgressId: progress.id,
        outcome,
        failureReasons,
        score: score ?? null,
        callDurationMs: callDuration ?? 0,
      } satisfies TrackRoleplayAttemptEndedEvent);
  }

  /**
   * A roleplay session has just been created for this track item. A
   * PARTICIPATION item completes here — launching it is the whole
   * requirement — so a learner who ends the call at once has still done it.
   * Every other logic waits for the attempt to end.
   */
  async handleRoleplayLaunch(
    trackItemProgressId: string,
  ): Promise<CompleteItemResult> {
    const progress = await this.trackItemProgressRepository.findOne({
      where: { id: trackItemProgressId },
    });
    if (!progress || progress.status === SessionItemStatus.COMPLETED) {
      return NOOP_RESULT;
    }
    const item = await this.trackItemRepository.findOne({
      where: { id: progress.trackItemId },
    });
    // An assessment is judged when it ends, never on launch — even a legacy
    // row that also carries PARTICIPATION.
    if (
      item?.type !== TrackItemType.ROLEPLAY ||
      resolveRoleplayType(item.completionCriteria) !== RoleplayType.TRIAL
    ) {
      return NOOP_RESULT;
    }
    return this.completeItem(trackItemProgressId, {
      meta: { lastRoleplayAttempt: undefined },
    });
  }

  /** The gates a roleplay item applies, with the platform default filled in. */
  getRoleplayGate(
    criteria: TrackItemCompletionCriteria | null | undefined,
  ): RoleplayGate {
    return resolveRoleplayGate(
      criteria,
      parseDefaultMinDurationSeconds(
        this.configService.simulationPath
          ?.simulationPathItemMinDurationForCompletion,
      ),
    );
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
    // The incomplete-start count is per attempt window; the last submission
    // snapshot stays for pre/post reporting until a new valid attempt replaces it.
    delete meta.assessmentIncompleteStarts;
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
        await this.completeItem(progress.id, {
          meta: { lastCaseAttempt: undefined },
        });
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
   * A case roleplay missed its bar. Record it on every non-completed track
   * progress row linked to that case session, so the next locked item can say
   * why the case is not finished. Best-effort, like the completion listener.
   */
  @OnEvent(CASE_SESSION_ATTEMPT_MISSED_EVENT)
  async handleCaseSessionAttemptMissed(
    event: CaseSessionAttemptMissedEvent,
  ): Promise<void> {
    try {
      const progressRows = await this.trackItemProgressRepository.find({
        where: {
          caseSessionId: event.caseSessionId,
          status: Not(SessionItemStatus.COMPLETED),
        },
      });
      const lastCaseAttempt: LastCaseAttempt = {
        failureReasons: event.failureReasons,
        score: event.score,
        durationSeconds: event.durationSeconds,
        requiredScore: event.requiredScore,
        requiredDurationSeconds: event.requiredDurationSeconds,
        endedAt: new Date().toISOString(),
      };
      for (const progress of progressRows) {
        await this.trackItemProgressRepository.update(progress.id, {
          meta: { ...(progress.meta ?? {}), lastCaseAttempt },
        });
      }
    } catch (error) {
      // Track progression must never break the case flow.
      this.logger.error(
        `Failed to record missed case attempt for case session ${event.caseSessionId}: ${error}`,
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
